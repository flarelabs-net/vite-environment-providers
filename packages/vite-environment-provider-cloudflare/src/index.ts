import { fileURLToPath } from 'node:url';
import { dirname, relative, resolve, normalize } from 'node:path';
import { readFile } from 'node:fs/promises';

import {
  DevEnvironment as ViteDevEnvironment,
  BuildEnvironment,
  createIdResolver,
  type EnvironmentOptions,
} from 'vite';

import { HotChannel, HotPayload, ResolvedConfig, Plugin } from 'vite';

import {
  SourcelessWorkerOptions,
  unstable_getMiniflareWorkerOptions,
} from 'wrangler';

import {
  Miniflare,
  Response as MiniflareResponse,
  type MessageEvent,
  type WebSocket,
} from 'miniflare';

import * as debugDumps from './debug-dumps';
import { collectModuleInfo } from './moduleUtils';
import { readFileSync } from 'node:fs';

export type DevEnvironment = ViteDevEnvironment & {
  metadata: EnvironmentMetadata;
  api: {
    getHandler: ({
      entrypoint,
    }: {
      entrypoint: string;
    }) => Promise<(req: Request) => Response | Promise<Response>>;
  };
};

export type CloudflareEnvironmentOptions = {
  config?: string;
};

const runtimeName = 'workerd';

/**
 * Metadata regarding the environment that consumers can use to get more information about the env when needed
 */
export type EnvironmentMetadata = {
  runtimeName: string;
};

export function cloudflare(
  userOptions: CloudflareEnvironmentOptions = {},
): typeof cloudflareEnvironment {
  return (
    environmentName: string,
    pluginConsumerOptions: CloudflareEnvironmentOptions = {},
  ) => {
    // we deep merge the options from the caller into the user options here, we do this so
    // that consumers of this plugin are able to override/augment/tweak the options if need be
    const pluginOptions = deepMergeOptions(userOptions, pluginConsumerOptions);
    return cloudflareEnvironment(environmentName, pluginOptions);
  };
}

/**
 * Deep merged the a set of options onto another and returns the result of the operation
 * (the function does not modify the argument options themselves)
 * @param target the target/base options object
 * @param source the new options to merge into the target
 * @returns the target options object merged with the options from the source object
 */
function deepMergeOptions(
  target: CloudflareEnvironmentOptions,
  source: CloudflareEnvironmentOptions,
): CloudflareEnvironmentOptions {
  // the "deep merging" right now is very trivial... with a realistic/more complex
  // options structure we'd have to do a real deep merge here
  return {
    config: target.config ?? source.config,
  };
}

const defaultWranglerConfig = 'wrangler.toml';

export function cloudflareEnvironment(
  environmentName: string,
  options: CloudflareEnvironmentOptions = {},
): Plugin[] {
  const resolvedWranglerConfigPath = resolve(
    options.config ?? defaultWranglerConfig,
  );
  options.config = resolvedWranglerConfigPath;

  return [
    {
      name: 'vite-plugin-cloudflare-environment',

      async config() {
        return {
          environments: {
            [environmentName]: createCloudflareEnvironment(options),
          },
        };
      },
      hotUpdate(ctx) {
        if (this.environment.name !== environmentName) {
          return;
        }
        if (ctx.file === resolvedWranglerConfigPath) {
          ctx.server.restart();
        }
      },
    },
  ];
}

export function createCloudflareEnvironment(
  options: CloudflareEnvironmentOptions,
): EnvironmentOptions {
  return {
    // @ts-ignore
    metadata: { runtimeName },
    consumer: 'server',
    webCompatible: true,
    dev: {
      createEnvironment(name, config) {
        return createCloudflareDevEnvironment(name, config, options);
      },
    },
    build: {
      createEnvironment(name, config) {
        return createCloudflareBuildEnvironment(name, config, options);
      },
    },
  };
}

async function createCloudflareBuildEnvironment(
  name: string,
  config: ResolvedConfig,
  _cloudflareOptions: CloudflareEnvironmentOptions,
): Promise<BuildEnvironment> {
  const buildEnv = new BuildEnvironment(name, config);
  // Nothing too special to do here, the default build env is probably ok for now
  return buildEnv;
}

async function createCloudflareDevEnvironment(
  name: string,
  config: ResolvedConfig,
  cloudflareOptions: CloudflareEnvironmentOptions,
): Promise<DevEnvironment> {
  const { bindings: bindingsFromToml, ...optionsFromToml } =
    getOptionsFromWranglerConfig(cloudflareOptions.config!);

  const esmResolveId = createIdResolver(config, {});

  // for `require` calls we want a resolver that prioritized node/cjs modules
  const cjsResolveId = createIdResolver(config, {
    conditions: ['node'],
    mainFields: ['main'],
    webCompatible: false,
    isRequire: true,
    extensions: ['.cjs', '.cts', '.js', '.ts', '.jsx', '.tsx', '.json'],
  });

  const mf = new Miniflare({
    modulesRoot: fileURLToPath(new URL('./', import.meta.url)),
    modules: [
      {
        type: 'ESModule',
        path: fileURLToPath(new URL('worker/index.js', import.meta.url)),
      },
      {
        // we declare the workerd-custom-import as a CommonJS module, thanks to this
        // require is made available in the module and we are able to handle cjs imports, etc...
        type: 'CommonJS',
        path: fileURLToPath(
          new URL('workerd-custom-import.cjs', import.meta.url),
        ),
      },
    ],
    unsafeEvalBinding: 'UNSAFE_EVAL',
    bindings: {
      ...bindingsFromToml,
      ROOT: config.root,
    },
    serviceBindings: {
      __viteFetchModule: async request => {
        const args = await request.json();
        try {
          const result: any = await devEnv.fetchModule(...(args as [any, any]));
          await debugDumps.dump__viteFetchModuleLog(args, result);
          return new MiniflareResponse(JSON.stringify(result));
        } catch (error) {
          console.error('[fetchModule]', args, error);
          throw error;
        }
      },
      __debugDump: debugDumps.__debugDumpBinding,
    },
    unsafeUseModuleFallbackService: true,
    async unsafeModuleFallbackService(request) {
      const resolveMethod = request.headers.get('X-Resolve-Method');
      if (resolveMethod !== 'import' && resolveMethod !== 'require') {
        throw new Error('unrecognized resolvedMethod');
      }

      const url = new URL(request.url);
      const specifier = url.searchParams.get('specifier');
      if (!specifier) {
        throw new Error('no specifier provided');
      }

      const rawSpecifier = url.searchParams.get('rawSpecifier');

      const referrer = url.searchParams.get('referrer');

      await debugDumps.rawLog(`
        🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩
        moduleFallback start:
          resolveMethod = ${resolveMethod}
          rawSpecifier = ${rawSpecifier}
          referrer = ${referrer}
          specifier = ${specifier}
      `);

      const referrerDir = dirname(referrer);

      let fixedSpecifier = specifier;

      if (!/node_modules/.test(referrerDir)) {
        // for app source code strip prefix and prepend /
        fixedSpecifier = '/' + getApproximateSpecifier(specifier, referrerDir);
      } else if (!specifier.endsWith('.js')) {
        // for package imports from other packages strip prefix
        fixedSpecifier = getApproximateSpecifier(specifier, referrerDir);
      }

      fixedSpecifier = rawSpecifier;

      try {
        const resolveId =
          resolveMethod === 'import' ? esmResolveId : cjsResolveId;

        await debugDumps.rawLog(`
          pre resolveId:
            resolveMethod = ${resolveMethod}
            rawSpecifier = ${rawSpecifier}
            referred = ${referrer}
        `);

        let resolvedId = await resolveId(devEnv, fixedSpecifier, referrer);

        // on windows resolveId doesn't seem to resolve well with relative imports, so if the
        // rawSpecifier starts with ./ or ../ let's just resolve it simply with node:path's resolve
        if (
          process.platform === 'win32' &&
          (rawSpecifier.startsWith('./') || rawSpecifier.startsWith('../'))
        ) {
          resolvedId = normalize(
            resolve(dirname(referrer.replace(/^\//, '')), rawSpecifier),
          ).replace(/\\/g, '/');
        }

        await debugDumps.rawLog(`
          post resolveId:
            resolvedId = ${resolvedId}
        `);

        if (!resolvedId) {
          await debugDumps.rawLog(`
            RETURNING 404 response (no resolvedId)
          `);
          return new MiniflareResponse(null, { status: 404 });
        }

        if (resolvedId.includes('?'))
          resolvedId = resolvedId.slice(0, resolvedId.lastIndexOf('?'));

        // on windows absolute paths start with a letter and a colon, but we need assume that they start with `/`
        // when absolute to match the workerd specifiers (is this a bug in workerd?), so if we're on windows and
        // get such a path here we prepend it with a `/` to makes it look like an absolute path
        const resolvedIdWindowsFixed =
          process.platform === 'win32' && resolvedId.match(/^[A-Z]:/)
            ? `/${resolvedId}`
            : resolvedId;

        // we don't want to redirect in the following case:
        // resolvedId =              D:/a/vite-environment-providers/vite-environment-providers/node_modules/.pnpm/@remix-run+server-runtime@2.12.0_typescript@5.4.5/node_modules/@remix-run/server-runtime/dist/index.js
        // resolvedIdWindowsFixed = /D:/a/vite-environment-providers/vite-environment-providers/node_modules/.pnpm/@remix-run+server-runtime@2.12.0_typescript@5.4.5/node_modules/@remix-run/server-runtime/dist/index.js
        // referrer =               /D:/a/vite-environment-providers/vite-environment-providers/node_modules/.pnpm/@remix-run+cloudflare@2.12.0_@cloudflare+workers-types@4.20240815.0_typescript@5.4.5/node_modules/@remix-run/cloudflare/dist/implementations.js
        // specifier =              /D:/a/vite-environment-providers/vite-environment-providers/node_modules/.pnpm/@remix-run+cloudflare@2.12.0_@cloudflare+workers-types@4.20240815.0_typescript@5.4.5/node_modules/@remix-run/cloudflare/dist/@remix-run/D:/a/vite-environment-providers/vite-environment-providers/node_modules/.pnpm/@remix-run+server-runtime@2.12.0_typescript@5.4.5/node_modules/@remix-run/server-runtime/dist/index.js
        // rawSpecifier =           @remix-run/server-runtime

        const weirdWindowsThing =
          referrerDir + '/' + '@remix-run' + resolvedIdWindowsFixed;
        const weirdWindowsThingCheck = specifier === weirdWindowsThing;

        const redirectTo =
          !rawSpecifier.startsWith('./') &&
          !rawSpecifier.startsWith('../') &&
          resolvedIdWindowsFixed !== rawSpecifier &&
          resolvedIdWindowsFixed !== specifier &&
          !weirdWindowsThingCheck
            ? resolvedId
            : undefined;

        if (redirectTo) {
          await debugDumps.rawLog(`
            REDIRECTING TO
              redirectTo = ${redirectTo}

              resolvedId = ${resolvedId}
              resolvedIdWindowsFixed = ${resolvedIdWindowsFixed}
              rawSpecifier = ${rawSpecifier}
              specifier = ${specifier}
              weirdWindowsThing = ${weirdWindowsThing}
          `);
          return new MiniflareResponse(null, {
            headers: { location: resolvedId },
            status: 301,
          });
        }

        await debugDumps.rawLog(`
          pre readFileSync:
            resolvedId = ${resolvedId}
        `);

        // and we read the code from the resolved file
        // @ts-ignore
        const code: string | null = readFileSync(resolvedId, 'utf8');
        // .catch(
        //   (e) => ,
        // );

        // await debugDumps.rawLog(`
        //   post readFileSync:
        //     code = ${code}
        // `);

        const notFound = !code;

        if (notFound) {
          await debugDumps.rawLog(`
            RETURNING 404 response (failed to read code)
          `);
          return new MiniflareResponse(null, { status: 404 });
        }

        const moduleInfo = await collectModuleInfo(code, resolvedId);

        const mod = moduleInfo.isCommonJS
          ? {
              commonJsModule: code,
              namedExports: moduleInfo.namedExports,
            }
          : {
              esModule: code,
            };

        await debugDumps.rawLog(`
              returning module
                name = specifier.replace(/^\//, '')
                isCommonJs = ${moduleInfo.isCommonJS}
            `);

        return new MiniflareResponse(
          JSON.stringify({
            name: specifier.replace(/^\//, ''),
            ...mod,
          }),
        );
      } catch (e) {
        throw e;
      }
    },
    ...optionsFromToml,
  });

  const resp = await mf.dispatchFetch('http:0.0.0.0/__init-module-runner', {
    headers: {
      upgrade: 'websocket',
    },
  });
  if (!resp.ok) {
    throw new Error('Error: failed to initialize the module runner!');
  }

  const webSocket = resp.webSocket;

  if (!webSocket) {
    console.error(
      '\x1b[33m⚠️ failed to create a websocket for HMR (hmr disabled)\x1b[0m',
    );
  }

  const hot = webSocket ? createHotChannel(webSocket!) : false;

  const devEnv = new ViteDevEnvironment(name, config, {
    hot,
  }) as DevEnvironment;

  let entrypointSet = false;
  devEnv.api = {
    async getHandler({ entrypoint }) {
      if (!entrypointSet) {
        const resp = await mf.dispatchFetch('http:0.0.0.0/__set-entrypoint', {
          headers: [['x-vite-workerd-entrypoint', entrypoint]],
        });
        if (resp.ok) {
          entrypointSet = resp.ok;
        } else {
          throw new Error(
            'failed to set entrypoint (the error should be logged in the terminal)',
          );
        }
      }

      return async (req: Request) => {
        // TODO: ideally we should pass the request itself with close to no tweaks needed... this needs to be investigated
        return await mf.dispatchFetch(req.url, {
          method: req.method,
          body: req.body,
          duplex: 'half',
          headers: [
            // note: we disable encoding since this causes issues when the miniflare response
            //       gets piped into the node one
            ['accept-encoding', 'identity'],
            ...req.headers,
          ],
        });
      };
    },
  };

  return devEnv;
}
function createHotChannel(webSocket: WebSocket): HotChannel {
  webSocket.accept();

  const listenersMap = new Map<string, Set<Function>>();
  let hotDispose: () => void;

  return {
    send(...args) {
      let payload: HotPayload;

      if (typeof args[0] === 'string') {
        payload = {
          type: 'custom',
          event: args[0],
          data: args[1],
        };
      } else {
        payload = args[0];
      }

      webSocket.send(JSON.stringify(payload));
    },
    on(event, listener) {
      if (!listenersMap.get(event)) {
        listenersMap.set(event, new Set());
      }

      listenersMap.get(event).add(listener);
    },
    off(event, listener) {
      listenersMap.get(event)?.delete(listener);
    },
    listen() {
      function eventListener(event: MessageEvent) {
        const payload = JSON.parse(event.data.toString());

        if (!listenersMap.get(payload.event)) {
          listenersMap.set(payload.event, new Set());
        }

        for (const fn of listenersMap.get(payload.event)) {
          fn(payload.data);
        }
      }

      webSocket.addEventListener('message', eventListener);

      hotDispose = () => {
        webSocket.removeEventListener('message', eventListener);
      };
    },
    close() {
      hotDispose?.();
      hotDispose = undefined;
    },
  };
}

function getOptionsFromWranglerConfig(configPath: string) {
  let configOptions: SourcelessWorkerOptions;
  try {
    const { workerOptions } = unstable_getMiniflareWorkerOptions(configPath);
    configOptions = workerOptions;
  } catch (e) {
    console.warn(`WARNING: unable to read config file at "${configPath}"`);
    return {};
  }

  const {
    bindings,
    textBlobBindings,
    dataBlobBindings,
    wasmBindings,
    kvNamespaces,
    r2Buckets,
    d1Databases,
    compatibilityDate,
    compatibilityFlags,
  } = configOptions;

  return {
    bindings,
    textBlobBindings,
    dataBlobBindings,
    wasmBindings,
    kvNamespaces,
    r2Buckets,
    d1Databases,
    compatibilityDate,
    compatibilityFlags,
  };
}

function getApproximateSpecifier(target: string, referrerDir: string): string {
  let result = '';
  if (/^(node|cloudflare|workerd):/.test(target)) result = target;
  result = relative(referrerDir, target);
  return result;
}

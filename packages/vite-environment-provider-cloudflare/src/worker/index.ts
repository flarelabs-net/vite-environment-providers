import { ModuleRunner } from 'vite/module-runner';

type Env = {
  ROOT: string;
  UNSAFE_EVAL: {
    eval: (code: string, filename?: string) => any;
  };
  __viteFetchModule: {
    fetch: (request: Request) => Promise<Response>;
  };
  __debugDump: {
    fetch: (request: Request) => Promise<Response>;
  };
  root: string;
};

// node modules using process.env don't find process in the global scope for some reason...
// so let's define it here ¯\_(ツ)_/¯
globalThis.process = { env: {} };

let entrypoint: any;
let moduleRunner: ModuleRunner;
let hmrWebSocket: WebSocket;

export default {
  async fetch(req: Request, env: Env, ctx: any) {
    const url = new URL(req.url);

    if (url.pathname === '/__init-module-runner') {
      const pair = new WebSocketPair();

      (pair[0] as any).accept();
      hmrWebSocket = pair[0];
      moduleRunner = await getModuleRunner(env);
      return new Response(null, { status: 101, webSocket: pair[1] });
    }

    if (url.pathname === '/__set-entrypoint') {
      const viteWorkerdEntrypoint = req.headers.get(
        'x-vite-workerd-entrypoint',
      );
      try {
        entrypoint = await moduleRunner.import(viteWorkerdEntrypoint!);
      } catch (error) {
        console.error(error);
        return new Response(null, {
          status: 500,
        });
      }
      return new Response('entrypoint successfully set');
    }

    // here we filter out the extra bindings that we use for the environment
    // integration, so that user code doesn't get access to them
    const { ROOT, UNSAFE_EVAL, __viteFetchModule, __debugDump, ...userEnv } =
      env;

    return entrypoint.default.fetch(req, userEnv, ctx);
  },
};

let _moduleRunner: ModuleRunner | undefined;

async function getModuleRunner(env: Env) {
  if (_moduleRunner) return _moduleRunner;

  // we store the custom import file path in a variable to skip esbuild's import resolution
  const workerdReqImport = '../workerd-custom-import.cjs';
  const { default: workerdCustomImport } = await (import(
    workerdReqImport
  ) as Promise<{ default: (...args: unknown[]) => Promise<unknown> }>);

  _moduleRunner = new ModuleRunner(
    {
      root: env.ROOT,
      transport: {
        fetchModule: async (...args) => {
          const moduleId = args[0];
          if (moduleId.startsWith('cloudflare:')) {
            return {
              externalize: moduleId,
              type: 'builtin',
            };
          }

          const response = await env.__viteFetchModule.fetch(
            new Request('http://localhost', {
              method: 'POST',
              body: JSON.stringify(args),
            }),
          );
          const result = response.json();
          return result as any;
        },
      },
      hmr: {
        connection: {
          isReady: () => true,
          onUpdate(callback) {
            hmrWebSocket.addEventListener('message', event => {
              callback(JSON.parse(event.data));
            });
          },
          send(message) {
            hmrWebSocket.send(message);
          },
        },
      },
    },
    {
      runInlinedModule: async (context, transformed, id) => {
        const codeDefinition = `'use strict';async (${Object.keys(context).join(
          ',',
        )})=>{{`;
        const code = `${codeDefinition}${transformed}\n}}`;
        await env.__debugDump.fetch(
          new Request('http://0.0.0.0/runInlineModule', {
            method: 'POST',
            body: JSON.stringify({ id, code }),
          }),
        );
        const fn = env.UNSAFE_EVAL.eval(code, id);
        await fn(...Object.values(context));
        Object.freeze(context.__vite_ssr_exports__);
      },
      async runExternalModule(filepath) {
        await env.__debugDump.fetch(
          new Request('http://0.0.0.0/runExternalModule', {
            method: 'POST',
            body: JSON.stringify({ filepath }),
          }),
        );
        // strip the file:// prefix if present
        // Note: I _think_ that the module fallback service is going to strip this for us
        //       in the future, so this will very likely become unnecessary
        filepath = filepath.replace(/^file:\/\//, '');
        return workerdCustomImport(filepath);
      },
    },
  );
  return _moduleRunner;
}

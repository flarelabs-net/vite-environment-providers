import {
  DevEnvironment as ViteDevEnvironment,
  BuildEnvironment,
  type HotChannel,
  type HotPayload,
  type ResolvedConfig,
  type Plugin,
  type EnvironmentOptions,
} from 'vite';

import EventEmitter from 'node:events';

import { runInContext, createContext } from 'node:vm';

export type NodeVMEnvironmentProviderOptions = {};

const runtimeName = 'node:vm';

/**
 * Metadata regarding the environment that consumers can use to get more information about the env when needed
 */
export type EnvironmentMetadata = {
  runtimeName: string;
};

export function nodeVm(
  userOptions?: NodeVMEnvironmentProviderOptions,
): typeof nodeVMEnvironment {
  return (
    environmentName: string,
    pluginConsumerOptions?: NodeVMEnvironmentProviderOptions,
  ) => {
    // we deep merge the options from the caller into the user options here, we do this so
    // that consumers of this plugin are able to override/augment/tweak the options if need be
    const pluginOptions = deepMergeOptions(userOptions, pluginConsumerOptions);
    return nodeVMEnvironment(environmentName, pluginOptions);
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
  target: NodeVMEnvironmentProviderOptions,
  source: NodeVMEnvironmentProviderOptions,
): NodeVMEnvironmentProviderOptions {
  // nothing really to do here... but this exemplifies that options would need to be merged at this point
  return {};
}

export function nodeVMEnvironment(
  environmentName: string,
  _options: NodeVMEnvironmentProviderOptions = {},
): Plugin[] {
  return [
    {
      name: 'node:vm-environment-plugin',

      async config() {
        // we could use the provided options here...

        return {
          environments: {
            [environmentName]: createNodeVmEnvironment(),
          },
        };
      },
    },
  ];
}

export function createNodeVmEnvironment(): EnvironmentOptions {
  return {
    // @ts-ignore
    metadata: { runtimeName },
    consumer: 'server',
    dev: {
      createEnvironment(name, config) {
        return createNodeVmDevEnvironment(name, config);
      },
    },
    build: {
      createEnvironment(name, config) {
        return createNodeVmBuildEnvironment(name, config);
      },
    },
  };
}

async function createNodeVmBuildEnvironment(
  name: string,
  config: ResolvedConfig,
): Promise<BuildEnvironment> {
  const buildEnv = new BuildEnvironment(name, config);
  // Nothing too special to do here, the default build env is totally fine here
  return buildEnv;
}

async function createNodeVmDevEnvironment(
  name: string,
  config: any,
): Promise<DevEnvironment> {
  const eventEmitter = new EventEmitter();

  const hot = createSimpleHotChannel(eventEmitter);

  const devEnv = new ViteDevEnvironment(name, config, { hot });

  const vmContext = createContext({
    config,
    console: {
      ...console,
      log: (...args: any[]) => {
        console.log('\nlog from node VM ========');
        console.log(...args);
        console.log('=========================\n');
      },
    },
    devEnv,
    Request,
    setTimeout,
    Response,
    URL,
    Headers,
    eventEmitter,
  });

  const script = `
    let _moduleRunner;
    async function getModuleRunner() {
      if (_moduleRunner) return _moduleRunner;
      const { ModuleRunner, ESModulesEvaluator } = await import("vite/module-runner");
      _moduleRunner = new ModuleRunner(
          {
            root: config.root,
            transport: {
              fetchModule: async (...args) => devEnv.fetchModule(...args),
            },
            hmr: {
              connection: {
                isReady: () => true,
                onUpdate(callback) {
                  eventEmitter.on("message", (event) => {
                    callback(JSON.parse(event));
                  });
                },
                send(message) {
                  eventEmitter.emit("message", message);
                },
              },
            },
          },
          new ESModulesEvaluator()
      );
      return _moduleRunner;
    }

    devEnv.api = {
      async getHandler({ entrypoint }) {
        const moduleRunner = await getModuleRunner();
        const entry = await moduleRunner.import(entrypoint);
        return entry.default;
      }
    }
  `;

  runInContext(script, vmContext, {
    // hack to get dynamic imports to work in node vms
    importModuleDynamically: specifier => {
      return import(specifier) as any;
    },
  });

  return devEnv as DevEnvironment;
}

function createSimpleHotChannel(eventEmitter: EventEmitter): HotChannel {
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

      eventEmitter.emit('message', JSON.stringify(payload));
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
      function eventListener(data: string) {
        const payload = JSON.parse(data);

        if (!listenersMap.get(payload.event)) {
          listenersMap.set(payload.event, new Set());
        }

        for (const fn of listenersMap.get(payload.event)) {
          fn(payload.data);
        }
      }

      eventEmitter.on('message', eventListener);

      hotDispose = () => {
        eventEmitter.off('message', eventListener);
      };
    },
    close() {
      hotDispose?.();
      hotDispose = undefined;
    },
  };
}

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

import {
  DevEnvironment as ViteDevEnvironment,
  RemoteEnvironmentTransport,
  BuildEnvironment,
  type HotChannel,
  type HotPayload,
  type ResolvedConfig,
  type Plugin,
  type EnvironmentOptions,
} from 'vite';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {
  createEventSender,
  createEventReceiver,
  type ChildEvent,
  type ParentEvent,
  type EventSender,
  type EventReceiver,
} from './events';

const runtimeName = 'node:process';

export function nodeProcessEnvironment(environmentName: string): Plugin[] {
  return [
    {
      name: 'node:process-environment-plugin',

      async config() {
        return {
          environments: {
            [environmentName]: createNodeProcessEnvironment(),
          },
        };
      },
    },
  ];
}

function createNodeProcessEnvironment(): EnvironmentOptions {
  return {
    // @ts-ignore
    metadata: { runtimeName },
    consumer: 'server',
    dev: {
      createEnvironment(name, config) {
        return createNodeProcessDevEnvironment(name, config);
      },
    },
    build: {
      createEnvironment(
        name: string,
        config: ResolvedConfig,
      ): Promise<BuildEnvironment> {
        return createNodeProcessBuildEnvironment(name, config);
      },
    },
  };
}

async function createNodeProcessBuildEnvironment(
  name: string,
  config: ResolvedConfig,
): Promise<BuildEnvironment> {
  const buildEnv = new BuildEnvironment(name, config);

  return buildEnv;
}

async function createNodeProcessDevEnvironment(
  name: string,
  config: ResolvedConfig,
): Promise<DevEnvironment> {
  const childProcessPath = fileURLToPath(
    new URL('child-process/index.js', import.meta.url),
  );
  const childProcess = spawn('node', [childProcessPath]);

  const sendParentEvent = createEventSender<ParentEvent>(event => {
    childProcess.stdin.write(event);
  });
  const childEventReceiver = createEventReceiver<ChildEvent>(
    listen => {
      childProcess.stdout.on('data', listen);
    },
    input => {
      console.log(input);
    },
  );

  const devEnv = new ViteDevEnvironment(name, config, {
    runner: {
      transport: new RemoteEnvironmentTransport({
        send: data => {
          sendParentEvent('transport', data);
        },
        onMessage: listener => {
          childEventReceiver.addListener(event => {
            if (event.type === 'transport') {
              listener(event.data);
            }
          });
        },
      }),
    },
    hot: createSimpleHotChannel(sendParentEvent, childEventReceiver),
  }) as DevEnvironment;

  let port: number;

  devEnv.api = {
    async getHandler({ entrypoint }) {
      if (!port) {
        port = await new Promise(resolve => {
          function initializedListener(event: { type: ChildEvent; data: any }) {
            if (event.type === 'initialized') {
              childEventReceiver.removeListener(initializedListener);
              resolve(event.data.port);
            }
          }

          childEventReceiver.addListener(initializedListener);
          sendParentEvent('initialize', { root: config.root, entrypoint });
        });
      }

      return async (request: Request) => {
        const { url: originalUrl, ...rest } = request;
        const url = new URL(originalUrl);
        url.port = port.toString();

        return fetch(url, rest as RequestInit);
      };
    },
  };

  return devEnv;
}

function createSimpleHotChannel(
  sendEvent: EventSender<ParentEvent>,
  eventReceiver: EventReceiver<ChildEvent>,
): HotChannel {
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

      sendEvent('hmr', payload);
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
      function eventListener(event: { type: ChildEvent; data: any }) {
        const payload = event.data;

        if (event.type === 'hmr') {
          if (!listenersMap.get(payload.event)) {
            listenersMap.set(payload.event, new Set());
          }

          for (const fn of listenersMap.get(payload.event)) {
            fn(payload.data);
          }
        }
      }

      eventReceiver.addListener(eventListener);

      hotDispose = () => {
        eventReceiver.removeListener(eventListener);
      };
    },
    close() {
      hotDispose?.();
      hotDispose = undefined;
    },
  };
}

type EnvironmentMetadata = {
  runtimeName: string;
};

type DevEnvironment = ViteDevEnvironment & {
  metadata: EnvironmentMetadata;
  api: {
    getHandler: ({
      entrypoint,
    }: {
      entrypoint: string;
    }) => Promise<(req: Request) => Response | Promise<Response>>;
  };
};

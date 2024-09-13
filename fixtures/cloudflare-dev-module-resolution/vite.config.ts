import { defineConfig, type ViteDevServer } from 'vite';
import {
  cloudflareEnvironment,
  type DevEnvironment,
} from '@flarelabs-net/vite-environment-provider-cloudflare';
import type * as http from 'node:http';

const ssrEnvName = 'ssr-env';

export default defineConfig({
  appType: 'custom',
  ssr: {
    target: 'webworker',
  },
  optimizeDeps: {
    include: [],
  },
  plugins: [
    ...cloudflareEnvironment(ssrEnvName),
    {
      name: 'cloudflare-dev-module-resolution-fixture',
      async configureServer(server: ViteDevServer) {
        const devEnv = server.environments[ssrEnvName] as DevEnvironment;

        let handler = await devEnv!.api.getHandler({
          entrypoint: './entry-workerd.ts',
        });

        return async () => {
          server.middlewares.use(
            async (req: http.IncomingMessage, res: http.ServerResponse) => {
              const url = `http://localhost${req.url ?? '/'}`;
              const nativeReq = new Request(url);
              const resp = await handler(nativeReq);
              res.end(await resp.text());
            },
          );
        };
      },
    },
  ],
});

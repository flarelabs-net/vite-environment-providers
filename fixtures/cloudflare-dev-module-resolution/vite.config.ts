import { defineConfig, type ViteDevServer } from 'vite';
import {
  cloudflareEnvironment,
  type DevEnvironment,
} from '@flarelabs-net/vite-environment-provider-cloudflare';

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
      async configureServer(server) {
        const devEnv = server.environments[ssrEnvName] as DevEnvironment;
        
        if (!devEnv) {
          throw new Error('Dev environment not found');
        }

        let handler = await devEnv.api.getHandler({
          entrypoint: './entry-workerd.ts',
        });

        return async () => {
          server.middlewares.use(
            async (req, res) => {
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

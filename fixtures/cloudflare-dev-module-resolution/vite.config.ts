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
  environments: {
    [ssrEnvName]: {
      resolve: {
        // We're testing module resolution for external modules, so let's treat everything as external
        // (if we were not to do this all the packages in cloudflare-dev-module-resolution/packages
        // wouldn't be treated as such)
        external: true,
      },
    },
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
          server.middlewares.use(async (req, res) => {
            const url = `http://localhost${req.url ?? '/'}`;
            const nativeReq = new Request(url);
            const resp = await handler(nativeReq);
            res.end(await resp.text());
          });
        };
      },
    },
  ],
});

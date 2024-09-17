import { createServer } from 'vite';
import { beforeAll, describe, expect, test } from 'vitest';

import config from './vite.config';

describe('Cloudflare dev module resolution', () => {
  let jsonOutput: Record<string, unknown> = {};

  beforeAll(async () => {
    jsonOutput = (await fetchJsonFromViteDevServer()) ?? {};
  });

  test('can successfully import "React"', () => {
    expect(jsonOutput['typeof React']).toEqual('object');
    expect(jsonOutput['typeof React.cloneElement']).toEqual('function');
    expect(jsonOutput['reactVersionsMatch']).toEqual(true);
  });

  test('can successfully import utilities from "@remix-run/cloudflare"', () => {
    expect(jsonOutput['typeof remix cloudflare json({})']).toEqual('object');
    expect(jsonOutput['remixRunCloudflareCookieName']).toEqual(
      'my-remix-run-cloudflare-cookie',
    );
  });
});

async function fetchJsonFromViteDevServer(): Promise<null | Record<
  string,
  unknown
>> {
  const viteServer = await createServer({
    ...config,
  });

  await viteServer.listen();

  const addressInfo = viteServer.httpServer?.address();

  if (!addressInfo) {
    throw new Error("addressInfo not found");
  }

  const address =
    typeof addressInfo === 'string'
      ? addressInfo
      : `http://localhost:${addressInfo.port}`;
  const resp = await fetch(address);
  await viteServer.close();
  return await resp.json();
}

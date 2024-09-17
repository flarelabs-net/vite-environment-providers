import { createServer } from 'vite';
import { beforeAll, describe, expect, test } from 'vitest';

import config from './vite.config';

describe('Cloudflare dev module resolution', () => {
  let output: unknown;

  beforeAll(async () => {
    output = await fetchOutputFromViteDevServer();
  });
  test('can successfully import "React"', () => {
    expect(output?.['typeof React']).toEqual('object');
    expect(output?.['typeof React.cloneElement']).toEqual('function');
    expect(output?.['reactVersionsMatch']).toEqual(true);
  });
  test('can successfully import utilities from "@remix-run/cloudflare"', () => {
    expect(output?.['typeof remix cloudflare json({})']).toEqual('object');
    expect(output?.['remixRunCloudflareCookieName']).toEqual(
      'my-remix-run-cloudflare-cookie',
    );
  });

  test('can successfully use the discord-api-types/v10 package', () => {
    expect(output?.['[discord-api-types/v10] Utils.isLinkButton({})']).toEqual(
      false,
    );
    expect(
      output?.['[discord-api-types/v10] RPCErrorCodes.InvalidUser'],
    ).toEqual(4010);
  });

  test('can successfully use the slash-create package (which `require`s its package.json)', () => {
    expect(output?.['slash-create VERSION']).toMatch(/^6\./);
  });
});

async function fetchOutputFromViteDevServer(): Promise<unknown> {
  const viteServer = await createServer({
    ...config,
  });

  await viteServer.listen();

  const addressInfo = viteServer.httpServer?.address();

  if (!addressInfo) {
    throw new Error('addressInfo not found');
  }

  const address =
    typeof addressInfo === 'string'
      ? addressInfo
      : `http://localhost:${addressInfo.port}`;
  const resp = await fetch(address);
  await viteServer.close();
  return await resp.json();
}

import { createServer } from 'vite';
import { describe, expect, test } from 'vitest';

import config from './vite.config';

describe('Cloudflare dev module resolution', () => {
  test('can successfully import from "react"', async () => {
    const output = await fetchOutputFromViteDevServer('/react');

    expect(output?.['(react) typeof React']).toEqual('object');
    expect(output?.['(react) typeof React.cloneElement']).toEqual('function');
    expect(output?.['(react) reactVersionsMatch']).toEqual(true);
  });

  test('can successfully import utilities from "@remix-run/cloudflare"', async () => {
    const output = await fetchOutputFromViteDevServer('/remix');

    expect(output?.['(remix) typeof cloudflare json({})']).toEqual('object');
    expect(output?.['(remix) remixRunCloudflareCookieName']).toEqual(
      'my-remix-run-cloudflare-cookie',
    );
  });

  test('can successfully import from "discord-api-types/v10"', async () => {
    const output = await fetchOutputFromViteDevServer('/discord-api-types');

    expect(output?.['(discord-api-types/v10) Utils.isLinkButton({})']).toEqual(
      false,
    );
    expect(
      output?.['(discord-api-types/v10) RPCErrorCodes.InvalidUser'],
    ).toEqual(4010);
  });

  test('can successfully import from "slash-create" (which `require`s its package.json)', async () => {
    const output = await fetchOutputFromViteDevServer('/slash-create');

    expect(output?.['(slash-create) VERSION']).toMatch(/^6\./);
  });
});

async function fetchOutputFromViteDevServer(path: string): Promise<unknown> {
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
      : `http://localhost:${addressInfo.port}${path}`;
  const resp = await fetch(address);
  await viteServer.close();
  return await resp.json();
}

import { createServer } from 'vite';

import config from './vite.config';

export async function fetchOutputFromViteDevServer(
  path: string,
): Promise<unknown> {
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
  try {
    return await resp.json();
  } catch (e) {
    console.error(e);
    return undefined;
  }
}

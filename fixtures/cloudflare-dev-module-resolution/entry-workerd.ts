export default {
  async fetch(_request: Request, env: any) {
    return Response.json({
      ...(await getReactValues()),
      ...(await getRemixRunCloudflareValues()),
      ...(await getDiscordApiTypesValues()),
    });
  },
};

async function getReactValues() {
  try {
    const { default: React, version: ReactVersion } = await import('react');
    return {
      'typeof React': typeof React,
      'typeof React.cloneElement': typeof React.cloneElement,
      reactVersionsMatch: React.version === ReactVersion,
    };
  } catch {
    return {};
  }
}

async function getRemixRunCloudflareValues() {
  try {
    const { json, createCookie } = await import('@remix-run/cloudflare');
    return {
      'typeof remix cloudflare json({})': typeof json({}),
      remixRunCloudflareCookieName: createCookie(
        'my-remix-run-cloudflare-cookie',
      ).name,
    };
  } catch {
    return {};
  }
}

async function getDiscordApiTypesValues() {
  try {
    const { RPCErrorCodes, Utils } = await import('discord-api-types/v10');

    // resolving discord-api-types/v10 (package which uses `require()`s without extensions
    // can be problematic, see: https://github.com/dario-piotrowicz/vitest-pool-workers-ext-repro)
    return {
      '[discord-api-types/v10] Utils.isLinkButton({})': Utils.isLinkButton(
        {} as any,
      ),
      '[discord-api-types/v10] RPCErrorCodes.InvalidUser':
        RPCErrorCodes.InvalidUser,
    };
  } catch {
    return {};
  }
}

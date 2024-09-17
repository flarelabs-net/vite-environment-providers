export default {
  async fetch(_request: Request, env: any) {
    return Response.json({
      ...(await getReactValues()),
      ...(await getRemixRunCloudflareValues()),
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

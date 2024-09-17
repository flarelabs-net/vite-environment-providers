const allowedPaths = new Set([
  '/react',
  '/remix',
  '/discord-api-types',
  '/slash-create',
]);

export default {
  async fetch(request: Request, env: any) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (allowedPaths.has(path)) {
      const mod = await import(/* @vite-ignore */ `./src${path}`);
      return Response.json(mod.default);
    }

    return new Response('path not found', { status: 404 });
  },
};

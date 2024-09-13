import React, { version as ReactVersion } from 'react';
import { json, createCookie } from '@remix-run/cloudflare';

export default {
  async fetch(_request: Request, env: any) {
    return Response.json({
      // resolving React imports
      'typeof React': typeof React,
      'typeof React.cloneElement': typeof React.cloneElement,
      reactVersionsMatch: React.version === ReactVersion,

      // resolving imports from @remix-run/cloudflare
      'type of remix cloudflare json({})': typeof json({}),
      remixRunCloudflareCookieName: createCookie(
        'my-remix-run-cloudflare-cookie',
      ).name,
    });
  },
};

import { describe, expect, test } from 'vitest';

import { fetchOutputFromViteDevServer } from './utils';

describe('basic module resolution', () => {
  test('`require` js/cjs files with specifying their file extension', async () => {
    const output = await fetchOutputFromViteDevServer('/require-ext');

    expect(output).toEqual({
      '(requires/ext) helloWorld': 'hello (.js) world (.cjs)',
      '(requires/ext) hello.cjs (wrong-extension)': null,
      '(requires/ext) world.js (wrong-extension)': null,
    });
  });

  test('`require` js/cjs files without specifying their file extension', async () => {
    const output = await fetchOutputFromViteDevServer('/require-no-ext');

    expect(output).toEqual({
      '(requires/no-ext) helloWorld': 'hello (.js) world (.cjs)',
    });
  });

  test('`require` json files', async () => {
    const output = await fetchOutputFromViteDevServer('/require-json');

    expect(output).toEqual({
      '(requires/json) package name':
        '@cloudflare-dev-module-resolution/requires',
      '(requires/json) package version': '1.0.0',
    });
  });
});

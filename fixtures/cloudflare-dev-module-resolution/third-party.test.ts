import { describe, expect, test } from 'vitest';

import { fetchOutputFromViteDevServer } from './utils';

/**
 *  These tests check that module resolution works as intended for various third party npm packages (these tests are more
 *  realistic but less helpful than the other ones (these can be considered integration tests whilst the other unit tests)).
 *
 *  These are packages that involve non-trivial module resolutions (and that in the past we had issues with), they have no
 *  special meaning to us.
 */
describe('third party packages resolutions', () => {
  test('react', async () => {
    const output = await fetchOutputFromViteDevServer('/third-party/react');

    expect(output).toEqual({
      '(react) reactVersionsMatch': true,
      '(react) typeof React': 'object',
      '(react) typeof React.cloneElement': 'function',
    });
  });

  test('@remix-run/cloudflare', async () => {
    const output = await fetchOutputFromViteDevServer('/third-party/remix');

    expect(output).toEqual({
      '(remix) remixRunCloudflareCookieName': 'my-remix-run-cloudflare-cookie',
      '(remix) typeof cloudflare json({})': 'object',
    });
  });

  test('discord-api-types/v10', async () => {
    const output = await fetchOutputFromViteDevServer(
      '/third-party/discord-api-types',
    );

    expect(output).toEqual({
      '(discord-api-types/v10) RPCErrorCodes.InvalidUser': 4010,
      '(discord-api-types/v10) Utils.isLinkButton({})': false,
    });
  });

  test('slash-create', async () => {
    const output = await fetchOutputFromViteDevServer(
      '/third-party/slash-create',
    );

    expect(output).toEqual({
      '(slash-create/web) VERSION': '6.2.1',
      '(slash-create/web) myCollection.random()': 54321,
      '(slash-create/web) slashCreatorInstance is instance of SlashCreator':
        true,
    });
  });
});

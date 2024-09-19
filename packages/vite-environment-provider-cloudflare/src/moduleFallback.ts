import { dirname, relative } from 'node:path';

import { Request, Response } from 'miniflare';

import { collectModuleInfo } from './moduleUtils';
import { readFile, stat } from 'node:fs/promises';
import { URL } from 'url';

export type ResolveIdFunction = (
  id: string,
  importer?: string,
  options?: {
    resolveMethod: 'require' | 'import';
  },
) => Promise<string>;

export function getModuleFallbackCallback(resolveId: ResolveIdFunction) {
  return async (request: Request): Promise<Response> => {
    const { resolveMethod, referrer, specifier, rawSpecifier } =
      extractModuleFallbackValues(request);

    const referrerDir = dirname(referrer);

    let fixedSpecifier = specifier;

    if (!/node_modules/.test(referrerDir)) {
      // for app source code strip prefix and prepend /
      fixedSpecifier = '/' + getApproximateSpecifier(specifier, referrerDir);
    } else if (!specifier.endsWith('.js')) {
      // for package imports from other packages strip prefix
      fixedSpecifier = getApproximateSpecifier(specifier, referrerDir);
    }

    fixedSpecifier = rawSpecifier;

    let resolvedId = await resolveId(
      fixedSpecifier,
      await withJsFileExtension(referrer),
      {
        resolveMethod,
      },
    );

    if (!resolvedId) {
      return new Response(null, { status: 404 });
    }

    if (resolvedId.includes('?'))
      resolvedId = resolvedId.slice(0, resolvedId.lastIndexOf('?'));

    const redirectTo =
      !rawSpecifier.startsWith('./') &&
      !rawSpecifier.startsWith('../') &&
      resolvedId !== rawSpecifier &&
      resolvedId !== specifier
        ? resolvedId
        : undefined;

    if (redirectTo) {
      // workerd always expects a leading `/` in absolute locations (like in mac and linux) windows absolute
      // locations don't start with `/`, so in order not to confuse workerd we need to add one here before redirecting
      const locationPrefix = `${process.platform === 'win32' ? '/' : ''}`;
      const location = `${locationPrefix}${redirectTo}`;
      return new Response(null, {
        headers: { location },
        status: 301,
      });
    }

    let code: string;

    try {
      code = await readFile(resolvedId, 'utf8');
    } catch {
      return new Response(`Failed to read file ${resolvedId}`, {
        status: 404,
      });
    }

    const moduleInfo = await collectModuleInfo(code, resolvedId);

    let mod = {};

    switch (moduleInfo.moduleType) {
      case 'cjs':
        mod = {
          commonJsModule: code,
          namedExports: moduleInfo.namedExports,
        };
        break;
      case 'esm':
        mod = {
          esModule: code,
        };
        break;
      case 'json':
        mod = {
          json: code,
        };
        break;
    }

    return new Response(
      JSON.stringify({
        // The name of the module has to never include a leading `/` (not even on mac/linux) so let's remove it
        // (PS: I don't get this... is this a workerd bug?)
        // (source: https://github.com/cloudflare/workerd/blob/442762b03/src/workerd/server/server.c%2B%2B#L2838-L2840)
        name: specifier.replace(/^\//, ''),
        ...mod,
      }),
    );
  };
}

/**
 * Extracts the various module fallback values from the provided request
 *
 * As part of this extraction, the paths are adjusted for windows systems (in which absolute paths should not have leading `/`s)
 *
 * @param request the request the module fallback service received
 * @returns all the extracted (adjusted) values that the fallback service request holds
 */
function extractModuleFallbackValues(request: Request): {
  resolveMethod: 'import' | 'require';
  referrer: string;
  specifier: string;
  rawSpecifier: string;
} {
  const resolveMethod = request.headers.get('X-Resolve-Method');
  if (resolveMethod !== 'import' && resolveMethod !== 'require') {
    throw new Error('unrecognized resolvedMethod');
  }

  const url = new URL(request.url);

  const extractPath = (
    key: 'referrer' | 'specifier' | 'rawSpecifier',
    isRaw: boolean = false,
  ): string => {
    const originalValue = url.searchParams.get(key);
    if (!originalValue) {
      throw new Error(`no ${key} provided`);
    }

    // workerd always adds a `/` to the absolute paths (raw values excluded) that is fine in OSes like mac and linux
    // where absolute paths do start with `/` as well. But it is not ok in windows where absolute paths don't start
    // with `/`, so for windows we need to remove the extra leading `/`
    const value =
      isRaw || process.platform !== 'win32'
        ? originalValue
        : originalValue.replace(/^\//, '');

    return value;
  };

  return {
    resolveMethod,
    referrer: extractPath('referrer'),
    specifier: extractPath('specifier'),
    rawSpecifier: extractPath('rawSpecifier', true),
  };
}

function getApproximateSpecifier(target: string, referrerDir: string): string {
  let result = '';
  if (/^(node|cloudflare|workerd):/.test(target)) result = target;
  result = relative(referrerDir, target);
  return result;
}

/**
 * In the module fallback service we can easily end up with referrers without a javascript (any) file extension.
 *
 * This happens every time a module, resolved without a file extension imports something (in this latter import
 * the specifier is the original module path without the file extension).
 *
 * So when we have a specifier we actually need to add back the file extension if it is missing (because that's needed
 * for relative module resolution to properly work).
 *
 * This function does just that, tries the various possible javascript file extensions and if with one it finds the file
 * on the filesystem then it returns such path (PS: note that even if there were two files with the same exact location and
 * name but different extensions we could be picking up the wrong one here, but that's not a concern since the concern here
 * if just to obtain a real/existent filesystem path here).
 *
 * @param path a path to a javascript file, potentially without a file extension
 * @returns the input path with a js file extension, unless no such file was actually found on the filesystem, in that
 *          case the function returns the exact same path it received (something must have gone wrong somewhere and there
 *          is not much we can do about it here)
 */
async function withJsFileExtension(path: string): Promise<string> {
  const jsFileExtensions = ['.js', '.jsx', '.cjs', '.mjs'];

  const pathHasJsExtension = jsFileExtensions.some(extension =>
    path.endsWith(extension),
  );

  if (pathHasJsExtension) {
    return path;
  }

  for (const extension of jsFileExtensions) {
    try {
      const pathWithExtension = `${path}${extension}`;
      const fileStat = await stat(pathWithExtension);
      if (fileStat.isFile()) {
        return pathWithExtension;
      }
    } catch {}
  }

  return path;
}

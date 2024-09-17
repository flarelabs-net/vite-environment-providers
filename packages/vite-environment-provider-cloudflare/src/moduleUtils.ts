import { init as initCjsModuleLexer, parse } from 'cjs-module-lexer';
import { dirname, resolve } from 'node:path';
import { readFile, stat } from 'node:fs/promises';

export async function collectModuleInfo(
  moduleCode: string,
  moduleFilePath: string,
): Promise<CjsModuleInfo | EsmModuleInfo | JsonModuleInfo> {
  if (moduleFilePath.endsWith('.json')) {
    return { moduleType: 'json' };
  }

  if (!isCommonJS(moduleCode)) {
    return { moduleType: 'esm' };
  }

  await initCjsModuleLexer();

  const namedExportsSet = new Set<string>();

  const cjsLexerResult = parse(moduleCode);
  for (const namedExport of cjsLexerResult.exports) {
    namedExportsSet.add(namedExport);
  }
  for (const reExport of cjsLexerResult.reexports) {
    const reExportsPath = resolve(dirname(moduleFilePath), reExport);

    const reExportsPathHasExtension = ['.cjs', '.js'].some(ext =>
      reExportsPath.endsWith(ext),
    );

    const extensionsToTry = reExportsPathHasExtension ? [''] : ['.cjs', '.js'];

    let moduleWasResolved = false;

    for (const extension of extensionsToTry) {
      const path = `${reExportsPath}${extension}`;
      let isFile = false;
      try {
        const reExportsFileStat = await stat(path);
        isFile = reExportsFileStat.isFile();
      } catch {}

      if (isFile) {
        moduleWasResolved = true;

        const reExportsCode = await readFile(path, 'utf8');
        const reExportsInfo = await collectModuleInfo(reExportsCode, path);

        if (reExportsInfo.moduleType === 'cjs') {
          for (const namedExport of reExportsInfo.namedExports) {
            namedExportsSet.add(namedExport);
          }
        }
      }
    }

    if (!moduleWasResolved) {
      throw new Error(
        "Error: Found cjs re-export that doesn't point to a relative path",
      );
    }
  }

  const namedExports = [...namedExportsSet].filter(
    namedExport => namedExport !== 'default',
  );

  return {
    moduleType: 'cjs',
    namedExports,
  };
}

type CjsModuleInfo = {
  moduleType: 'cjs';
  namedExports: string[];
};

type EsmModuleInfo = {
  moduleType: 'esm';
};

type JsonModuleInfo = {
  moduleType: 'json';
};

function isCommonJS(code: string): boolean {
  const hasRequireCalls = /\brequire\s*\(\s*['"`][^'"`]+['"`]\s*\)/.test(code);
  if (hasRequireCalls) {
    return true;
  }

  // the code has exports such as `exports.aaa = ...`
  const hasDotCjsExports =
    /\bmodule\.exports|exports\.[a-zA-Z_$][0-9a-zA-Z_$]*\s*=/.test(code);
  if (hasDotCjsExports) {
    return true;
  }

  // the code has exports such as `exports["aaa"] = ...`
  const hasBracketsCjsExports =
    /\bmodule\.exports|exports\[(['"])[a-zA-Z_$][0-9a-zA-Z_$]*\1\]\s*=/.test(
      code,
    );
  if (hasBracketsCjsExports) {
    return true;
  }

  // the code has exports such as `Object.defineProperty(exports, "aaa", ...)`
  const hasDefinePropertyOnExports =
    /Object\.defineProperty\(\s*exports,\s*(['"]).*?\1\s*,.*?\)/.test(code);
  if (hasDefinePropertyOnExports) {
    return true;
  }

  return false;
}

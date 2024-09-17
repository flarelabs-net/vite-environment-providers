import { dirname, resolve } from 'node:path';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { getImportCounterStr, runDir, debugDumpsEnabled } from './shared';

const moduleFallbackRunDir = resolve(`${runDir}/moduleFallback`);
const moduleFallbackLogsFilePath = resolve(`${moduleFallbackRunDir}/logs.txt`);

if (debugDumpsEnabled) {
  await mkdir(moduleFallbackRunDir);
  await writeFile(moduleFallbackLogsFilePath, '');
}

export async function dumpModuleFallbackServiceLog(
  results: {
    resolveMethod: string;
    referrer: string;
    specifier: string;
    rawSpecifier: string;
    fixedSpecifier: string;
    resolvedId: string;
  } & (
    | {
        redirectTo: string;
      }
    | {
        code: string;
        isCommonJS: boolean;
      }
    | {
        notFound: true;
      }
  ),
) {
  if (!debugDumpsEnabled) return;

  await appendFile(
    moduleFallbackLogsFilePath,
    `\n\n${await getImportCounterStr('moduleFallback', results.resolvedId)}:\n${Object.keys(
      results,
    )
      .filter(key => key !== 'code')
      .filter(key => results[key] !== undefined)
      .map(value => `        ${value}: ${results[value]}`)
      .join('\n')}\n\n`,
  );

  if (results.resolvedId && !results['notFound']) {
    const filePath = resolve(
      `${moduleFallbackRunDir}/resolved/${results.resolvedId}`,
    );
    try {
      // windows here fails with ENOENT: no such file or directory (even though we're setting recursive to true...)
      // so let's try catch these operations
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, 'code' in results ? results.code : '');
    } catch {}
  }
}

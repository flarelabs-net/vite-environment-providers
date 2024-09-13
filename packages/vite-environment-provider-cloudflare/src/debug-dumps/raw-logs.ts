import { appendFile, writeFile } from 'node:fs/promises';
import { runDir, debugDumpsEnabled } from './shared';

const __rawLogsFilePath = `${runDir}/raw-logs.txt`;

if (debugDumpsEnabled) {
  await writeFile(__rawLogsFilePath, '');
}

let idx = 0;

export async function rawLog(toLog: unknown) {
  if (!debugDumpsEnabled) return;

  const separator = new Array(3)
    .fill(null)
    .map(() => '='.repeat(50))
    .join('\n');

  await appendFile(
    __rawLogsFilePath,
    `\n\n\n__rawLog(${idx++})\n${separator}\n\n\n${toLog}\n\n\n${separator}\n\n\n`,
  );
}

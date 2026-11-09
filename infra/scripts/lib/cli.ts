import { join } from 'node:path';
import { parseArgs, type ParseArgsConfig } from 'node:util';

import { REPO_ROOT } from './docker';
import { fromInvocationDir } from './env';

export function step(message: string): void {
  console.log(`[stagehand] ${message}`);
}

export function warn(message: string): void {
  console.warn(`[stagehand] WARNING: ${message}`);
}

type Options = NonNullable<ParseArgsConfig['options']>;

/**
 * Parses args shared by every command (`--env <file>`, default infra/.env) plus the command's
 * own options. Not `--env-file`: that is a Node.js flag, and tsx hands it to Node.
 */
export function parseCommandArgs(options: Options): {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
  envFile: string;
} {
  const parsed = parseArgs({
    options: { env: { type: 'string' }, ...options },
    allowPositionals: true,
    strict: true,
  });
  const values = parsed.values as Record<string, string | boolean | undefined>;
  const envFileArg = values['env'];
  const envFile =
    typeof envFileArg === 'string'
      ? fromInvocationDir(envFileArg)
      : join(REPO_ROOT, 'infra', '.env');
  return { values, positionals: parsed.positionals, envFile };
}

/** Runs a command's main function, printing errors cleanly and setting the exit code. */
export function main(fn: () => Promise<void>): void {
  fn().catch((error: unknown) => {
    console.error(
      `\n[stagehand] FAILED: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}

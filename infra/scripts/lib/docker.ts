import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { Readable, Writable } from 'node:stream';

/** Repo root: this file is infra/scripts/lib/docker.ts. */
export const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');
export const COMPOSE_FILE = resolve(REPO_ROOT, 'infra', 'docker-compose.yml');

export class CommandError extends Error {
  override name = 'CommandError';

  constructor(
    readonly command: string,
    readonly code: number | null,
    readonly stderr: string,
  ) {
    super(`${command} failed (exit ${String(code)})${stderr ? `:\n${stderr.trim()}` : ''}`);
  }
}

export interface RunOptions {
  /** Stream into the process's stdin. */
  stdin?: Readable;
  /** Send stdout here instead of capturing it (for large outputs like dumps). */
  stdout?: Writable;
  /** Don't throw on a non-zero exit. */
  allowFailure?: boolean;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs a program with arguments (never through a shell). */
export function run(program: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, args, {
      stdio: [options.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const { stdout: out, stderr: err } = child;
    if (out === null || err === null) {
      reject(new Error(`Could not capture output of ${program}`));
      return;
    }

    if (options.stdout) out.pipe(options.stdout, { end: false });
    else out.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    err.on('data', (chunk: Buffer) => (stderr += chunk.toString()));

    if (options.stdin && child.stdin) {
      options.stdin.on('error', (error) => {
        child.kill();
        reject(error);
      });
      child.stdin.on('error', () => {
        // The process exited early (e.g. pg_restore failed); its exit code reports why.
      });
      options.stdin.pipe(child.stdin);
    }

    child.on('error', (error) => {
      reject(
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? new Error(
              `${program} not found on PATH. Is it installed (and is the terminal restarted)?`,
            )
          : error,
      );
    });
    child.on('close', (code) => {
      const label = [program, ...args.slice(0, 6)].join(' ');
      if (code !== 0 && !options.allowFailure) reject(new CommandError(label, code, stderr));
      else resolvePromise({ code, stdout, stderr });
    });
  });
}

/** `docker compose` for the production stack, with the given env file. */
export function compose(envFile: string, args: string[], options?: RunOptions): Promise<RunResult> {
  return run('docker', ['compose', '-f', COMPOSE_FILE, '--env-file', envFile, ...args], options);
}

export async function dockerAvailable(): Promise<boolean> {
  const result = await run('docker', ['info', '--format', '{{.ServerVersion}}'], {
    allowFailure: true,
  }).catch(() => null);
  return result?.code === 0;
}

/** Services of the stack that are currently running. */
export async function runningServices(envFile: string): Promise<string[]> {
  const { stdout } = await compose(envFile, ['ps', '--status', 'running', '--services']);
  return stdout.split(/\r?\n/).filter(Boolean);
}

/** The image the stack's postgres service uses, from the compose file itself. */
export async function postgresImage(envFile: string): Promise<string> {
  const { stdout } = await compose(envFile, ['config', '--format', 'json']);
  const config = JSON.parse(stdout) as { services?: Record<string, { image?: string }> };
  const image = config.services?.['postgres']?.image;
  if (!image) throw new Error('Could not find the postgres image in infra/docker-compose.yml');
  return image;
}

/** The Compose project name (volume names are prefixed with it). */
export async function projectName(envFile: string): Promise<string> {
  const { stdout } = await compose(envFile, ['config', '--format', 'json']);
  return (JSON.parse(stdout) as { name: string }).name;
}

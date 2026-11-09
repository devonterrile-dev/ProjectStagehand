import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { parseEnv } from 'node:util';

export interface BackupSettings {
  /** Where `.stbak` files and restore-drill.log live. */
  backupDir: string;
  passphrase: string;
  /** How many backups to keep (newest first). */
  keep: number;
  postgres: { user: string; db: string };
}

export class SettingsError extends Error {
  override name = 'SettingsError';
}

const MIN_PASSPHRASE = 12;

/** Resolves a user-supplied path against the directory pnpm was invoked from. */
export function fromInvocationDir(path: string): string {
  return isAbsolute(path) ? path : resolve(process.env['INIT_CWD'] ?? process.cwd(), path);
}

export function readEnvFile(path: string): { raw: string; values: Record<string, string> } {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new SettingsError(`Can't read env file ${path}`);
  }
  const values = Object.fromEntries(
    Object.entries(parseEnv(raw)).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  return { raw, values };
}

/**
 * Backup settings from the stack's env file. Process environment variables win, so CI can
 * point BACKUP_DIR at a temp directory without editing the file.
 */
export function backupSettings(values: Record<string, string>): BackupSettings {
  // Empty strings count as unset (`BACKUP_PASSPHRASE=` in a fresh env file).
  const nonEmpty = (value: string | undefined) =>
    value === undefined || value === '' ? undefined : value;
  const get = (key: string) => nonEmpty(process.env[key]) ?? nonEmpty(values[key]);

  const backupDir = get('BACKUP_DIR');
  const passphrase = get('BACKUP_PASSPHRASE');
  const keepRaw = get('BACKUP_KEEP') ?? '30';
  const user = values['POSTGRES_USER'];
  const db = values['POSTGRES_DB'];

  const problems: string[] = [];
  if (!backupDir) problems.push('BACKUP_DIR is not set');
  if (!passphrase) problems.push('BACKUP_PASSPHRASE is not set');
  else if (passphrase.length < MIN_PASSPHRASE)
    problems.push(`BACKUP_PASSPHRASE must be at least ${String(MIN_PASSPHRASE)} characters`);
  const keep = Number(keepRaw);
  if (!Number.isInteger(keep) || keep < 1) problems.push('BACKUP_KEEP must be a whole number ≥ 1');
  if (!user || !db) problems.push('POSTGRES_USER and POSTGRES_DB must be set');

  if (problems.length > 0 || !backupDir || !passphrase || !user || !db) {
    throw new SettingsError(`Backup settings are incomplete:\n  - ${problems.join('\n  - ')}`);
  }
  return { backupDir: fromInvocationDir(backupDir), passphrase, keep, postgres: { user, db } };
}

/**
 * The env file as stored inside a backup: everything except BACKUP_PASSPHRASE (the backup is
 * encrypted with it, so storing it inside would be pointless, and a restored env file
 * shouldn't carry it around).
 */
export function envForBackup(raw: string): string {
  return raw
    .split(/\r?\n/)
    .filter((line) => !/^\s*(export\s+)?BACKUP_PASSPHRASE\s*=/.test(line))
    .join('\n');
}

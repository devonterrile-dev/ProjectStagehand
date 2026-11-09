import { afterEach, describe, expect, it, vi } from 'vitest';

import { backupSettings, envForBackup, SettingsError } from './env';
import { backupFileName, backupsToPrune, isBackupFileName, sortBackups } from './retention';

describe('envForBackup', () => {
  it('removes only the BACKUP_PASSPHRASE line', () => {
    const raw = [
      '# comment',
      'POSTGRES_PASSWORD=secret',
      'BACKUP_PASSPHRASE=hunter2hunter2',
      '  export BACKUP_PASSPHRASE = other',
      'BACKUP_DIR=D:\\StagehandBackups',
      'NOT_BACKUP_PASSPHRASE=keep-me',
    ].join('\r\n');

    expect(envForBackup(raw)).toBe(
      [
        '# comment',
        'POSTGRES_PASSWORD=secret',
        'BACKUP_DIR=D:\\StagehandBackups',
        'NOT_BACKUP_PASSPHRASE=keep-me',
      ].join('\n'),
    );
  });
});

describe('backupSettings', () => {
  const base = {
    BACKUP_DIR: 'D:\\StagehandBackups',
    BACKUP_PASSPHRASE: 'a-long-enough-passphrase',
    POSTGRES_USER: 'stagehand',
    POSTGRES_DB: 'stagehand',
  };

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads settings with a default retention of 30', () => {
    expect(backupSettings(base)).toMatchObject({
      passphrase: 'a-long-enough-passphrase',
      keep: 30,
      postgres: { user: 'stagehand', db: 'stagehand' },
    });
  });

  it('lets the process environment override the file (CI)', () => {
    vi.stubEnv('BACKUP_DIR', '/tmp/ci-backups');
    vi.stubEnv('BACKUP_KEEP', '3');

    expect(backupSettings(base)).toMatchObject({ backupDir: '/tmp/ci-backups', keep: 3 });
  });

  it('lists every problem at once', () => {
    const run = () => backupSettings({ BACKUP_PASSPHRASE: 'short', BACKUP_KEEP: '0' });

    expect(run).toThrow(SettingsError);
    expect(run).toThrow(/BACKUP_DIR is not set/);
    expect(run).toThrow(/at least 12 characters/);
    expect(run).toThrow(/BACKUP_KEEP/);
    expect(run).toThrow(/POSTGRES_USER/);
  });
});

describe('backup names and retention', () => {
  it('names backups by UTC time', () => {
    expect(backupFileName(new Date('2026-11-09T01:30:05.123Z'))).toBe(
      'stagehand-20261109-013005Z.stbak',
    );
  });

  it('recognises only backup files', () => {
    expect(isBackupFileName('stagehand-20261109-013005Z.stbak')).toBe(true);
    expect(isBackupFileName('stagehand-20261109-013005Z.stbak.partial')).toBe(false);
    expect(isBackupFileName('restore-drill.log')).toBe(false);
    expect(isBackupFileName('notes-20261109-013005Z.stbak')).toBe(false);
  });

  it('sorts newest first and prunes beyond the limit, ignoring other files', () => {
    const names = [
      'stagehand-20261101-090000Z.stbak',
      'restore-drill.log',
      'stagehand-20261109-013005Z.stbak',
      'stagehand-20261105-200000Z.stbak',
      'my-important-file.txt',
      'stagehand-20261103-120000Z.stbak.partial',
    ];

    expect(sortBackups(names)).toEqual([
      'stagehand-20261109-013005Z.stbak',
      'stagehand-20261105-200000Z.stbak',
      'stagehand-20261101-090000Z.stbak',
    ]);
    expect(backupsToPrune(names, 2)).toEqual(['stagehand-20261101-090000Z.stbak']);
    expect(backupsToPrune(names, 30)).toEqual([]);
  });
});

/** stagehand-20261109-013000Z.stbak (UTC). The pattern is the only thing retention deletes. */
const BACKUP_NAME = /^stagehand-(\d{8})-(\d{6})Z\.stbak$/;

export function backupFileName(date: Date): string {
  const iso = date.toISOString(); // 2026-11-09T01:30:00.000Z
  const day = iso.slice(0, 10).replaceAll('-', '');
  const time = iso.slice(11, 19).replaceAll(':', '');
  return `stagehand-${day}-${time}Z.stbak`;
}

export function isBackupFileName(name: string): boolean {
  return BACKUP_NAME.test(name);
}

/** Backup file names, newest first. Names sort chronologically because they're fixed-width UTC. */
export function sortBackups(names: string[]): string[] {
  return names.filter(isBackupFileName).sort().reverse();
}

/** Which backups to delete so that only the newest `keep` remain. Never returns other files. */
export function backupsToPrune(names: string[], keep: number): string[] {
  return sortBackups(names).slice(keep);
}

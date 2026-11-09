/** The name Stagehand shows for a user: their custom display name, else their Discord name. */
export function shownName(user: { name: string; displayName?: string | null | undefined }): string {
  return user.displayName ?? user.name;
}

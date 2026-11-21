/** How many names a refused delete gives before "and N more". */
const NAMED = 5;

/** "Warrior, Fireball, Ward and 3 more", or "Vex and Ash", or "Vex". */
export function namesOf(names: readonly string[], total = names.length): string {
  const shown = names.slice(0, NAMED);
  const more = total - shown.length;
  if (more > 0) return `${shown.join(', ')} and ${String(more)} more`;
  if (shown.length === 1) return shown[0] ?? '';
  return `${shown.slice(0, -1).join(', ')} and ${shown.at(-1) ?? ''}`;
}

/** "Vex's sheet", or "the sheets of Vex, Ash and 2 more". */
export function sheetsOf(names: readonly string[]): string {
  return names.length === 1 ? `${names[0] ?? ''}'s sheet` : `the sheets of ${namesOf(names)}`;
}

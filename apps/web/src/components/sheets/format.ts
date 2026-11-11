/** A trait modifier or bonus as players write it: "+2", "0", "−1". */
export function formatModifier(n: number): string {
  if (n > 0) return `+${String(n)}`;
  if (n < 0) return `−${String(-n)}`;
  return '0';
}

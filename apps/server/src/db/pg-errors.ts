/** Postgres error codes the data layer turns into answers, however drizzle wraps them. */

function codeOf(error: unknown): unknown {
  const wrapped = error as { code?: unknown; cause?: { code?: unknown } } | null;
  return wrapped?.cause?.code ?? wrapped?.code;
}

/** True for Postgres's unique_violation. */
export function isUniqueViolation(error: unknown): boolean {
  return codeOf(error) === '23505';
}

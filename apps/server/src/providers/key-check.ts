/**
 * What checking a GM's provider key before storing it found (D-26, D-40). Every provider's
 * `checkKey` answers one of these, so the credential routes treat them alike.
 *
 * - `ok`: the provider accepted the key.
 * - `rejected`: the provider says the key is invalid (401).
 * - `forbidden`: the key is valid but may not do what Stagehand needs (403, or an OpenRouter
 *   management key, which can't generate anything).
 * - `rate_limited`: the provider is rate limiting the key right now (429).
 * - `unreachable`: no answer, a timeout, or a provider-side error.
 */
export type KeyCheckResult = 'ok' | 'rejected' | 'forbidden' | 'rate_limited' | 'unreachable';

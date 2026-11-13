import { z } from 'zod';

/**
 * A GM's own AI provider keys (F1.7 Anthropic, F2.2 OpenRouter; governance §14, D-26). Keys
 * go from the browser to the server once, when saved, and never come back: responses carry
 * only the last four characters.
 */
export const PROVIDERS = ['anthropic', 'openrouter'] as const;
export const providerSchema = z.enum(PROVIDERS);
export type Provider = z.infer<typeof providerSchema>;

export const PROVIDER_KEY_MAX = 256;
export const PROVIDER_KEY_LAST_FOUR = 4;

/**
 * An Anthropic API key as pasted: trimmed, `sk-ant-` followed by letters, digits, `-` and
 * `_`. Admin keys can't call the Messages API, so they get their own message. No message
 * repeats the input.
 */
export const anthropicApiKeySchema = z
  .string({ error: 'Paste your Anthropic API key' })
  .trim()
  .min(1, { error: 'Paste your Anthropic API key', abort: true })
  .max(PROVIDER_KEY_MAX, { error: 'That is too long to be an Anthropic API key', abort: true })
  .refine((key) => !key.startsWith('sk-ant-admin'), {
    error: "That's an Admin API key. Use a regular API key from the Anthropic Console",
    abort: true,
  })
  .regex(
    /^sk-ant-[A-Za-z0-9_-]{20,}$/,
    "That doesn't look like an Anthropic API key. It should start with sk-ant-",
  );

/** `PUT /api/me/credentials/anthropic`. */
export const saveAnthropicKeyRequestSchema = z.strictObject({
  apiKey: anthropicApiKeySchema,
});
export type SaveAnthropicKeyRequest = z.infer<typeof saveAnthropicKeyRequestSchema>;

/**
 * An OpenRouter API key as pasted (F2.2, D-40): trimmed, `sk-or-` followed by letters, digits,
 * `-` and `_` (today's keys are `sk-or-v1-` and 64 hex digits). Whether it's a management key
 * only OpenRouter can say, so the server's check catches those. No message repeats the input.
 */
export const openRouterApiKeySchema = z
  .string({ error: 'Paste your OpenRouter API key' })
  .trim()
  .min(1, { error: 'Paste your OpenRouter API key', abort: true })
  .max(PROVIDER_KEY_MAX, { error: 'That is too long to be an OpenRouter API key', abort: true })
  .regex(
    /^sk-or-[A-Za-z0-9_-]{20,}$/,
    "That doesn't look like an OpenRouter API key. It should start with sk-or-",
  );

/** `PUT /api/me/credentials/openrouter`. */
export const saveOpenRouterKeyRequestSchema = z.strictObject({
  apiKey: openRouterApiKeySchema,
});
export type SaveOpenRouterKeyRequest = z.infer<typeof saveOpenRouterKeyRequestSchema>;

/** Each provider's key format, for the form and for `PUT /api/me/credentials/:provider`. */
export const providerKeySchemas = {
  anthropic: anthropicApiKeySchema,
  openrouter: openRouterApiKeySchema,
} as const satisfies Record<Provider, z.ZodType<string>>;

/** `PUT /api/me/credentials/:provider`, by provider. */
export const saveProviderKeyRequestSchemas = {
  anthropic: saveAnthropicKeyRequestSchema,
  openrouter: saveOpenRouterKeyRequestSchema,
} as const satisfies Record<Provider, z.ZodType<{ apiKey: string }>>;

/** What the browser may know about a stored key. Parsing strips every other field. */
export const providerCredentialSchema = z.object({
  provider: providerSchema,
  lastFour: z.string().length(PROVIDER_KEY_LAST_FOUR),
  /** When the current key was saved (replacing a key resets it). */
  createdAt: z.iso.datetime({ offset: true }),
});
export type ProviderCredential = z.infer<typeof providerCredentialSchema>;

/** `GET /api/me/credentials`. */
export const providerCredentialsResponseSchema = z.object({
  credentials: z.array(providerCredentialSchema),
});
export type ProviderCredentialsResponse = z.infer<typeof providerCredentialsResponseSchema>;

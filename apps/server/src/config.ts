import { z } from 'zod';

const postgresUrl = z
  .url({ protocol: /^postgres(ql)?$/, error: 'must be a postgres:// or postgresql:// URL' })
  .optional();

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: postgresUrl,
    WEB_DIST_DIR: z.string().min(1).optional(),
    PUBLIC_URL: z
      .url({ protocol: /^https?$/, error: 'must be an http(s) URL' })
      .transform((value) => new URL(value).origin)
      .optional(),
    BETTER_AUTH_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),
    DISCORD_CLIENT_ID: z.string().min(1).optional(),
    DISCORD_CLIENT_SECRET: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    // Only unit tests may run without a database or auth (they build the app without them).
    if (env.NODE_ENV === 'test') return;
    for (const key of [
      'DATABASE_URL',
      'PUBLIC_URL',
      'BETTER_AUTH_SECRET',
      'DISCORD_CLIENT_ID',
      'DISCORD_CLIENT_SECRET',
    ] as const) {
      if (env[key] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `is required when NODE_ENV=${env.NODE_ENV}`,
        });
      }
    }
  });

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  databaseUrl: string | undefined;
  webDistDir: string | undefined;
  /** Origin users reach the app at (no trailing slash), e.g. http://localhost:5173. */
  publicUrl: string | undefined;
  /** Present outside unit tests. */
  auth:
    | {
        secret: string;
        discordClientId: string;
        discordClientSecret: string;
      }
    | undefined;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/**
 * Reads and validates server configuration from environment variables.
 * Throws a single ConfigError listing every problem, so the server fails fast at startup.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Treat empty strings (e.g. `FOO=` in an env file) as unset.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const result = envSchema.safeParse(cleaned);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(env)'}: ${issue.message}`)
      .join('\n');
    throw new ConfigError(`Invalid server configuration:\n${problems}`);
  }

  const parsed = result.data;
  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    logLevel: parsed.LOG_LEVEL,
    databaseUrl: parsed.DATABASE_URL,
    webDistDir: parsed.WEB_DIST_DIR,
    publicUrl: parsed.PUBLIC_URL,
    auth:
      parsed.BETTER_AUTH_SECRET !== undefined &&
      parsed.DISCORD_CLIENT_ID !== undefined &&
      parsed.DISCORD_CLIENT_SECRET !== undefined
        ? {
            secret: parsed.BETTER_AUTH_SECRET,
            discordClientId: parsed.DISCORD_CLIENT_ID,
            discordClientSecret: parsed.DISCORD_CLIENT_SECRET,
          }
        : undefined,
  };
}

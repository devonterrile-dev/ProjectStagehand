import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from './config';

/** The minimum a dev or production server needs. */
const REQUIRED = {
  DATABASE_URL: 'postgres://stagehand:stagehand@127.0.0.1:5432/stagehand_dev',
  PUBLIC_URL: 'http://localhost:5173',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  DISCORD_CLIENT_ID: 'client-id',
  DISCORD_CLIENT_SECRET: 'client-secret',
  CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64url'),
};

function captureError(fn: () => unknown): ConfigError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected a ConfigError');
}

describe('loadConfig', () => {
  it('applies defaults when only the required values are set', () => {
    expect(loadConfig(REQUIRED)).toEqual({
      nodeEnv: 'development',
      host: '0.0.0.0',
      port: 3000,
      logLevel: 'info',
      databaseUrl: REQUIRED.DATABASE_URL,
      webDistDir: undefined,
      promptsDir: undefined,
      styleBibleDir: undefined,
      assetsDir: undefined,
      publicUrl: 'http://localhost:5173',
      trustProxy: false,
      credentialsKey: Buffer.alloc(32, 7),
      auth: {
        secret: REQUIRED.BETTER_AUTH_SECRET,
        discordClientId: 'client-id',
        discordClientSecret: 'client-secret',
      },
    });
  });

  it('reads TRUST_PROXY as an explicit boolean', () => {
    expect(loadConfig({ ...REQUIRED, TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    expect(loadConfig({ ...REQUIRED, TRUST_PROXY: 'false' }).trustProxy).toBe(false);
    expect(() => loadConfig({ ...REQUIRED, TRUST_PROXY: 'yes' })).toThrow(
      'TRUST_PROXY: must be "true" or "false"',
    );
  });

  it('reads and coerces provided values', () => {
    const config = loadConfig({
      ...REQUIRED,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: '8080',
      LOG_LEVEL: 'debug',
      DATABASE_URL: 'postgres://user:pass@postgres:5432/stagehand',
      WEB_DIST_DIR: '/app/web',
      PROMPTS_DIR: '/app/prompts',
      STYLE_BIBLE_DIR: '/app/style-bible',
      ASSETS_DIR: '/app/data/assets',
      PUBLIC_URL: 'https://stagehand.example',
    });

    expect(config).toMatchObject({
      nodeEnv: 'production',
      host: '127.0.0.1',
      port: 8080,
      logLevel: 'debug',
      databaseUrl: 'postgres://user:pass@postgres:5432/stagehand',
      webDistDir: '/app/web',
      promptsDir: '/app/prompts',
      styleBibleDir: '/app/style-bible',
      assetsDir: '/app/data/assets',
      publicUrl: 'https://stagehand.example',
    });
  });

  it('requires ASSETS_DIR in production only', () => {
    expect(() => loadConfig({ ...REQUIRED, NODE_ENV: 'production' })).toThrow(
      'ASSETS_DIR: is required when NODE_ENV=production',
    );
    expect(loadConfig(REQUIRED).assetsDir).toBeUndefined();
  });

  it('normalises PUBLIC_URL to an origin', () => {
    expect(loadConfig({ ...REQUIRED, PUBLIC_URL: 'https://stagehand.example/' }).publicUrl).toBe(
      'https://stagehand.example',
    );
  });

  it('accepts the postgresql:// scheme', () => {
    expect(loadConfig({ ...REQUIRED, DATABASE_URL: 'postgresql://localhost/db' }).databaseUrl).toBe(
      'postgresql://localhost/db',
    );
  });

  it('treats empty strings as unset', () => {
    expect(loadConfig({ NODE_ENV: 'test', PORT: '', DATABASE_URL: '' })).toMatchObject({
      port: 3000,
      databaseUrl: undefined,
    });
  });

  it.each(Object.keys(REQUIRED))('requires %s in production', (key) => {
    const env = Object.fromEntries(
      Object.entries({ ...REQUIRED, NODE_ENV: 'production' }).filter(([name]) => name !== key),
    );

    expect(() => loadConfig(env)).toThrow(`${key}: is required when NODE_ENV=production`);
  });

  it('requires the same values in development, the default', () => {
    const message = captureError(() => loadConfig({})).message;

    for (const key of Object.keys(REQUIRED)) {
      expect(message).toContain(`${key}: is required when NODE_ENV=development`);
    }
  });

  it('allows missing database and auth settings only in test', () => {
    expect(loadConfig({ NODE_ENV: 'test' })).toMatchObject({
      databaseUrl: undefined,
      publicUrl: undefined,
      auth: undefined,
    });
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => loadConfig({ ...REQUIRED, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects a non-http PUBLIC_URL and a short BETTER_AUTH_SECRET', () => {
    const message = captureError(() =>
      loadConfig({ ...REQUIRED, PUBLIC_URL: 'ftp://example.com', BETTER_AUTH_SECRET: 'short' }),
    ).message;

    expect(message).toContain('PUBLIC_URL');
    expect(message).toContain('BETTER_AUTH_SECRET: must be at least 32 characters');
  });

  it('decodes CREDENTIALS_ENCRYPTION_KEY and insists on 32 bytes', () => {
    const key = Buffer.alloc(32, 9);
    expect(
      loadConfig({ ...REQUIRED, CREDENTIALS_ENCRYPTION_KEY: key.toString('base64url') })
        .credentialsKey,
    ).toEqual(key);
    expect(() =>
      loadConfig({
        ...REQUIRED,
        CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64url'),
      }),
    ).toThrow('CREDENTIALS_ENCRYPTION_KEY: must decode to exactly 32 bytes');
    expect(() => loadConfig({ ...REQUIRED, CREDENTIALS_ENCRYPTION_KEY: 'not base64url!' })).toThrow(
      'CREDENTIALS_ENCRYPTION_KEY: must be base64url',
    );
  });

  it('rejects an out-of-range or non-numeric PORT', () => {
    expect(() => loadConfig({ ...REQUIRED, PORT: '70000' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...REQUIRED, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('lists every problem in one error', () => {
    const message = captureError(() =>
      loadConfig({ PORT: 'abc', LOG_LEVEL: 'loud', NODE_ENV: 'staging' }),
    ).message;

    expect(message).toContain('PORT');
    expect(message).toContain('LOG_LEVEL');
    expect(message).toContain('NODE_ENV');
  });
});

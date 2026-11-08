import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from './config';

describe('loadConfig', () => {
  const DEV_DB = 'postgres://stagehand:stagehand@127.0.0.1:5432/stagehand_dev';

  it('applies defaults when only DATABASE_URL is set', () => {
    expect(loadConfig({ DATABASE_URL: DEV_DB })).toEqual({
      nodeEnv: 'development',
      host: '0.0.0.0',
      port: 3000,
      logLevel: 'info',
      databaseUrl: DEV_DB,
      webDistDir: undefined,
    });
  });

  it('reads and coerces provided values', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: '8080',
      LOG_LEVEL: 'debug',
      DATABASE_URL: 'postgres://user:pass@postgres:5432/stagehand',
      WEB_DIST_DIR: '/app/web',
    });

    expect(config).toEqual({
      nodeEnv: 'production',
      host: '127.0.0.1',
      port: 8080,
      logLevel: 'debug',
      databaseUrl: 'postgres://user:pass@postgres:5432/stagehand',
      webDistDir: '/app/web',
    });
  });

  it('accepts the postgresql:// scheme', () => {
    expect(
      loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://localhost/db' }).databaseUrl,
    ).toBe('postgresql://localhost/db');
  });

  it('treats empty strings as unset', () => {
    expect(loadConfig({ NODE_ENV: 'test', PORT: '', DATABASE_URL: '' })).toMatchObject({
      port: 3000,
      databaseUrl: undefined,
    });
  });

  it('requires DATABASE_URL in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(
      /DATABASE_URL: is required when NODE_ENV=production/,
    );
  });

  it('requires DATABASE_URL in development, the default', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL: is required when NODE_ENV=development/);
  });

  it('allows a missing DATABASE_URL only in test', () => {
    expect(loadConfig({ NODE_ENV: 'test' }).databaseUrl).toBeUndefined();
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => loadConfig({ DATABASE_URL: 'mysql://localhost/db' })).toThrow(/DATABASE_URL/);
  });

  it('rejects an out-of-range or non-numeric PORT', () => {
    expect(() => loadConfig({ PORT: '70000' })).toThrow(ConfigError);
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/PORT/);
  });

  it('lists every problem in one error', () => {
    const error: unknown = (() => {
      try {
        loadConfig({ PORT: 'abc', LOG_LEVEL: 'loud', NODE_ENV: 'staging' });
      } catch (caught) {
        return caught;
      }
      return undefined;
    })();

    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as ConfigError).message;
    expect(message).toContain('PORT');
    expect(message).toContain('LOG_LEVEL');
    expect(message).toContain('NODE_ENV');
  });
});

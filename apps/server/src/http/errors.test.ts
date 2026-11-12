import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { httpError, registerErrorHandler, reportError } from './errors';

/** Shaped like Drizzle's error for a failed query: the parameters are in the message. */
function queryError(): Error {
  const cause = Object.assign(new Error('duplicate key value violates "records_pkey"'), {
    code: '23505',
    constraint: 'records_pkey',
    table: 'records',
    detail: 'Key (id)=(secret-id) already exists.',
  });
  class DrizzleQueryError extends Error {}
  return Object.assign(
    new DrizzleQueryError('Failed query: insert into "records" …\nparams: The GM\'s secret notes'),
    { cause },
  );
}

describe('reportError', () => {
  it('sends and logs our own errors in their own words', () => {
    const report = reportError(httpError(409, 'Campaign is archived'));

    expect(report.statusCode).toBe(409);
    expect(report.body).toEqual({
      statusCode: 409,
      error: 'Conflict',
      message: 'Campaign is archived',
    });
    expect(report.logMessage).toBe('Campaign is archived');
    expect(report.log).toEqual({ type: 'Error', statusCode: 409 });
  });

  it('never repeats a failed query, in the response or the log', () => {
    const report = reportError(queryError());

    expect(report.statusCode).toBe(500);
    expect(report.body).toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Something went wrong on our side. Try again.',
    });
    expect(report.logMessage).toBe('request failed');
    expect(report.log).toMatchObject({
      type: 'DrizzleQueryError',
      statusCode: 500,
      dbCode: '23505',
      dbConstraint: 'records_pkey',
      dbTable: 'records',
    });
    const everything = JSON.stringify(report);
    expect(everything).not.toContain('secret');
    expect(everything).not.toContain('Failed query');
    // Where it was thrown is still there to debug with.
    expect(report.log['stack']).toMatch(/^\s+at /);
  });

  it("keeps a refused request's code and words for the caller, but logs only the code", () => {
    const parse = Object.assign(new Error('Unexpected token \'s\', "secret no"... is not valid'), {
      statusCode: 400,
      code: 'FST_ERR_CTP_INVALID_JSON_BODY',
    });

    const report = reportError(parse);

    expect(report.body).toMatchObject({ statusCode: 400, code: 'FST_ERR_CTP_INVALID_JSON_BODY' });
    expect(report.body.message).toContain('is not valid');
    expect(JSON.stringify([report.log, report.logMessage])).not.toContain('secret');
    expect(report.log).toEqual({
      type: 'Error',
      statusCode: 400,
      code: 'FST_ERR_CTP_INVALID_JSON_BODY',
    });
  });

  it('treats anything else as a fault of ours', () => {
    for (const thrown of [new TypeError('x is undefined'), 'a string', null, { statusCode: 200 }]) {
      const report = reportError(thrown);
      expect(report.statusCode).toBe(500);
      expect(report.body.message).toBe('Something went wrong on our side. Try again.');
    }
  });
});

describe('registerErrorHandler', () => {
  it('answers thrown errors through reportError', async () => {
    const app = Fastify();
    registerErrorHandler(app);
    app.get('/refused', () => {
      throw httpError(403, 'Only the GM can do that');
    });
    app.get('/broken', () => {
      throw queryError();
    });

    const refused = await app.inject({ method: 'GET', url: '/refused' });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toEqual({
      statusCode: 403,
      error: 'Forbidden',
      message: 'Only the GM can do that',
    });

    const broken = await app.inject({ method: 'GET', url: '/broken' });
    expect(broken.statusCode).toBe(500);
    expect(broken.body).not.toContain('secret');
    await app.close();
  });
});

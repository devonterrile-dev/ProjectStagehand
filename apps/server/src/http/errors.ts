import { STATUS_CODES } from 'node:http';

import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodError } from 'zod';

/**
 * 400 with one `{ path, message }` per Zod issue. The web client shows `issues[0].message`.
 */
export function sendValidationError(reply: FastifyReply, error: ZodError): FastifyReply {
  return reply.code(400).send({
    error: 'Bad Request',
    issues: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  });
}

/** Marks an error whose message we wrote ourselves, so it is safe to log and to send. */
const OURS = Symbol('stagehand.httpError');

/**
 * An error Fastify answers with its `statusCode`, as `{ statusCode, error, message }`
 * (e.g. `{ statusCode: 403, error: 'Forbidden', message: 'Only the GM can do that' }`).
 * For guards that run deep inside a handler.
 */
export function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode, [OURS]: true });
}

const INTERNAL_MESSAGE = 'Something went wrong on our side. Try again.';

interface ErrorReport {
  statusCode: number;
  /** The response body. */
  body: { statusCode: number; code?: string; error: string; message: string };
  /** What goes in the log line. Never the error's own message unless we wrote it. */
  log: Record<string, unknown>;
  /** The log line's text. */
  logMessage: string;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/**
 * Turns a thrown error into a response and a log entry (§14).
 *
 * An error from a failed database query carries the query's parameters in its message and
 * its stack: whatever the GM was saving. So only errors made by `httpError` are logged and
 * sent with their own words. Anything else is logged as its type, its codes (Fastify's, and
 * Postgres's error code, constraint and table) and, for a server fault, where it was thrown;
 * and a server fault is answered with a fixed message, never with SQL.
 */
export function reportError(error: unknown): ErrorReport {
  const fields = (typeof error === 'object' && error !== null ? error : {}) as Record<
    PropertyKey,
    unknown
  >;
  const given = fields['statusCode'];
  const statusCode =
    typeof given === 'number' && Number.isInteger(given) && given >= 400 && given <= 599
      ? given
      : 500;
  const ours = fields[OURS] === true;
  const message = error instanceof Error ? error.message : '';
  const code = text(fields['code']);
  const cause = (
    typeof fields['cause'] === 'object' && fields['cause'] !== null ? fields['cause'] : {}
  ) as Record<string, unknown>;

  const log: Record<string, unknown> = {
    type: error instanceof Error ? error.constructor.name : typeof error,
    statusCode,
  };
  if (code !== undefined) log['code'] = code;
  for (const key of ['code', 'constraint', 'table', 'column'] as const) {
    const value = text(cause[key]);
    if (value !== undefined) log[`db${key[0]?.toUpperCase() ?? ''}${key.slice(1)}`] = value;
  }
  if (statusCode >= 500 && error instanceof Error) {
    // The frames only: the first lines of a stack repeat the message.
    log['stack'] = (error.stack ?? '')
      .split('\n')
      .filter((line) => line.trimStart().startsWith('at '))
      .join('\n');
  }

  const serverFault = statusCode >= 500 && !ours;
  return {
    statusCode,
    body: {
      statusCode,
      ...(code === undefined || serverFault ? {} : { code }),
      error: STATUS_CODES[statusCode] ?? 'Error',
      // A refused request is answered in the error's words: they describe the caller's own
      // request. A fault of ours is not.
      message: serverFault ? INTERNAL_MESSAGE : message,
    },
    log,
    logMessage: ours ? message : statusCode >= 500 ? 'request failed' : 'request refused',
  };
}

/** Answers and logs every error a route throws through `reportError`. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: unknown, request, reply) => {
    const report = reportError(error);
    if (report.statusCode >= 500) request.log.error({ err: report.log }, report.logMessage);
    else request.log.info({ err: report.log }, report.logMessage);
    return reply.code(report.statusCode).send(report.body);
  });
}

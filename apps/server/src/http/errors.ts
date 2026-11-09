import type { FastifyReply } from 'fastify';
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

/**
 * An error Fastify answers with its `statusCode`, as `{ statusCode, error, message }`
 * (e.g. `{ statusCode: 403, error: 'Forbidden', message: 'Only the GM can do that' }`).
 * For guards that run deep inside a handler.
 */
export function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

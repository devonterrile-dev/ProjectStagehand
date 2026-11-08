import { z } from 'zod';

/** Response body of the server's `GET /health` route. */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

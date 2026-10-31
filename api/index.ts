/**
 * Vercel serverless entry point.
 *
 * `../server` builds the Express app and starts its startup sequence, which
 * hydrates the persistent stores from PostgreSQL. On serverless we must not
 * bind a listener, so `server.ts` returns early when VERCEL is set and we
 * simply await the hydration before handing over to Express.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { app, ready } from '../server.js';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await ready;
  return (app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(req, res);
}

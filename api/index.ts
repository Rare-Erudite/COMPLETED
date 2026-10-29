/**
 * Vercel serverless entry point.
 *
 * `../server` constructs the Express app and kicks off the startup sequence,
 * which hydrates the persistent stores from PostgreSQL. On serverless we must
 * not bind a listener, so `server.ts` returns before `httpServer.listen()` when
 * VERCEL is set; this handler simply awaits hydration and then hands the
 * request to Express.
 *
 * `ready` resolves even when the API half failed to boot (the SPA must stay
 * up), so the contract is: await `ready`, then delegate. Endpoints that need
 * storage return 503 themselves via the `/api` gate in server.ts.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { app, ready } from '../server.js';

type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await ready;
  return (app as unknown as RequestHandler)(req, res);
}

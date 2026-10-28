import type { ConnectionOptions } from 'node:tls';

/**
 * TLS options for a PostgreSQL connection string.
 *
 * Why this exists
 * ---------------
 * `pg`'s connection-string parser (pg-connection-string v2) maps
 * `sslmode=require` to `verify-full`, i.e. it demands a fully verifiable chain
 * against Node's bundled CA store. libpq — and therefore `psql` — treats
 * `require` as "encrypt, but do not verify the chain". Supabase's pooler
 * presents a chain rooted at "Supabase Root 2021 CA", which is not in Node's
 * bundled store, so the same URL that works in `psql` fails in Node with
 * "self-signed certificate in certificate chain".
 *
 * We keep the connection encrypted (matching libpq's `require` semantics) and
 * skip chain verification only for hosts we have explicitly decided to trust
 * that way. Everything else keeps full verification.
 *
 * Set RARE_DB_SSL_STRICT=true to force full verification (e.g. once the
 * Supabase root CA has been added to the runtime trust store).
 */
export function resolvePgSsl(connectionString: string | undefined): ConnectionOptions | undefined {
  if (!connectionString) return undefined;

  let host = '';
  try {
    host = new URL(connectionString).hostname.toLowerCase();
  } catch {
    return undefined;
  }

  const strict = process.env.RARE_DB_SSL_STRICT === 'true';
  const isSupabasePooler = host.endsWith('.supabase.com') || host.endsWith('.supabase.co');
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';

  if (isLocal) return undefined;
  if (isSupabasePooler && !strict) return { rejectUnauthorized: false };
  return undefined;
}

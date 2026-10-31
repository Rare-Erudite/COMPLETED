import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
import { resolvePgSsl } from '../src/server/storage/pgSsl.js';

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  throw new Error('DATABASE_URL is required to apply PostgreSQL migrations.');
}

const migrationDirectory = path.resolve(process.cwd(), 'database', 'migrations');
const pool = new Pool({
  connectionString,
  ssl: resolvePgSsl(connectionString),
  connectionTimeoutMillis: 10_000,
  max: 1,
});

async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', ['rare-schema-migrations']);
    await client.query(`
      CREATE TABLE IF NOT EXISTS rare_schema_migrations (
        version TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const files = (await fs.readdir(migrationDirectory))
      .filter((file) => /^\d{8}_[a-z0-9_-]+\.sql$/i.test(file))
      .sort();

    for (const file of files) {
      const sql = await fs.readFile(path.join(migrationDirectory, file), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      await client.query('BEGIN');
      try {
        const applied = await client.query<{ checksum: string }>(
          'SELECT checksum FROM rare_schema_migrations WHERE version = $1 FOR UPDATE', [file],
        );
        if (applied.rows[0]) {
          if (applied.rows[0].checksum !== checksum) {
            throw new Error(`Applied migration ${file} was changed; add a new migration instead.`);
          }
          await client.query('COMMIT');
          console.log(`Already applied: ${file}`);
          continue;
        }

        await client.query(sql);
        await client.query(
          'INSERT INTO rare_schema_migrations (version, checksum) VALUES ($1, $2)', [file, checksum],
        );
        await client.query('COMMIT');
        console.log(`Applied: ${file}`);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    }
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', ['rare-schema-migrations']);
    } finally {
      client.release();
    }
  }
}

try {
  await runMigrations();
} catch (error) {
  // Avoid dumping connection settings or provider/database payloads to logs.
  console.error('[Database migrations] Failed:', error instanceof Error ? error.message : 'Unknown database migration error.');
  process.exitCode = 1;
} finally {
  await pool.end();
}

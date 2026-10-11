import { Pool } from 'pg';

export interface StoredSnapshotFile {
  relativePath: string;
  content: Buffer;
}

export class PersistentJsonStore {
  private readonly pool: Pool;
  private readonly pendingWrites = new Map<string, Promise<void>>();

  constructor(connectionString = process.env.DATABASE_URL) {
    if (!connectionString) {
      throw new Error('DATABASE_URL is required for PostgreSQL persistence.');
    }

    this.pool = new Pool({
      connectionString,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      max: 10,
    });
  }

  async checkConnection(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async getOrSeed<T>(key: string, initialValue: T): Promise<T> {
    const existing = await this.pool.query<{ payload: T }>(
      'SELECT payload FROM rare_persistent_documents WHERE document_key = $1',
      [key],
    );
    if (existing.rows.length > 0) return existing.rows[0].payload;

    const inserted = await this.pool.query<{ payload: T }>(
      `INSERT INTO rare_persistent_documents (document_key, payload)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (document_key) DO NOTHING
       RETURNING payload`,
      [key, JSON.stringify(initialValue)],
    );
    if (inserted.rows.length > 0) return inserted.rows[0].payload;

    const raced = await this.pool.query<{ payload: T }>(
      'SELECT payload FROM rare_persistent_documents WHERE document_key = $1',
      [key],
    );
    if (raced.rows.length === 0) {
      throw new Error(`Could not initialize persistent document "${key}".`);
    }
    return raced.rows[0].payload;
  }

  setDocument(key: string, value: unknown): void {
    const payload = JSON.stringify(value);
    this.enqueue(key, async () => {
      await this.pool.query(
        `INSERT INTO rare_persistent_documents (document_key, payload, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (document_key)
         DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
        [key, payload],
      );
    });
  }

  async loadSnapshotFiles(checkpointId: string): Promise<StoredSnapshotFile[]> {
    const result = await this.pool.query<{ relative_path: string; content: Buffer }>(
      `SELECT relative_path, content
       FROM rare_checkpoint_files
       WHERE checkpoint_id = $1
       ORDER BY relative_path`,
      [checkpointId],
    );
    return result.rows.map((row) => ({
      relativePath: row.relative_path,
      content: row.content,
    }));
  }

  setSnapshotFiles(checkpointId: string, files: StoredSnapshotFile[]): void {
    const snapshot = files.map((file) => ({
      relativePath: file.relativePath,
      content: Buffer.from(file.content),
    }));

    this.enqueue(`checkpoint-files:${checkpointId}`, async () => {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'DELETE FROM rare_checkpoint_files WHERE checkpoint_id = $1',
          [checkpointId],
        );
        for (const file of snapshot) {
          await client.query(
            `INSERT INTO rare_checkpoint_files (checkpoint_id, relative_path, content)
             VALUES ($1, $2, $3)`,
            [checkpointId, file.relativePath, file.content],
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    });
  }

  async flush(): Promise<void> {
    while (this.pendingWrites.size > 0) {
      const writes = [...this.pendingWrites.entries()];
      const results = await Promise.allSettled(writes.map(([, write]) => write));

      for (const [key, write] of writes) {
        if (this.pendingWrites.get(key) === write) this.pendingWrites.delete(key);
      }

      const failure = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (failure) throw failure.reason;
    }
  }

  async close(): Promise<void> {
    try {
      await this.flush();
    } finally {
      await this.pool.end();
    }
  }

  private enqueue(key: string, write: () => Promise<void>): void {
    const previous = this.pendingWrites.get(key);
    const next = (previous ? previous.catch(() => undefined) : Promise.resolve())
      .then(write);
    this.pendingWrites.set(key, next);
  }
}

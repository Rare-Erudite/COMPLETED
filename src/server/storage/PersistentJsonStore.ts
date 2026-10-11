import { Pool } from 'pg';

export interface StoredSnapshotFile {
  relativePath: string;
  content: Buffer;
}

export class PersistentJsonStore {
  private readonly pool: Pool | null = null;
  private readonly pendingWrites = new Map<string, Promise<void>>();
  private readonly memoryDocs = new Map<string, any>();
  private readonly memoryFiles = new Map<string, StoredSnapshotFile[]>();

  constructor(connectionString = process.env.DATABASE_URL) {
    if (!connectionString) {
      console.warn('[AI Studio] DATABASE_URL not set — using in-memory mock store');
      this.pool = null;
      return;
    }

    try {
      this.pool = new Pool({
        connectionString,
        connectionTimeoutMillis: 10_000,
        idleTimeoutMillis: 30_000,
        max: 10,
      });
    } catch (err) {
      console.warn('[AI Studio] Failed to initialize PostgreSQL pool — fallback to in-memory mock:', err);
      this.pool = null;
    }
  }

  async checkConnection(): Promise<void> {
    if (!this.pool) return;
    try {
      await this.pool.query('SELECT 1');
    } catch {
      console.warn('[AI Studio] PostgreSQL query failed — continuing with in-memory fallback');
    }
  }

  async getOrSeed<T>(key: string, initialValue: T): Promise<T> {
    if (!this.pool) {
      if (!this.memoryDocs.has(key)) {
        this.memoryDocs.set(key, initialValue);
      }
      return this.memoryDocs.get(key);
    }
    try {
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
    } catch (err) {
      console.warn(`[AI Studio] Database read error for "${key}" — using in-memory store`);
      if (!this.memoryDocs.has(key)) {
        this.memoryDocs.set(key, initialValue);
      }
      return this.memoryDocs.get(key);
    }
  }

  setDocument(key: string, value: unknown): void {
    this.memoryDocs.set(key, value);
    if (!this.pool) return;
    const payload = JSON.stringify(value);
    this.enqueue(key, async () => {
      try {
        await this.pool!.query(
          `INSERT INTO rare_persistent_documents (document_key, payload, updated_at)
           VALUES ($1, $2::jsonb, now())
           ON CONFLICT (document_key)
           DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
          [key, payload],
        );
      } catch (err) {
        console.warn(`[AI Studio] Database write error for "${key}" — stored in-memory:`, err);
      }
    });
  }

  async loadSnapshotFiles(checkpointId: string): Promise<StoredSnapshotFile[]> {
    if (!this.pool) {
      return this.memoryFiles.get(checkpointId) || [];
    }
    try {
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
    } catch (err) {
      console.warn(`[AI Studio] Database loadSnapshotFiles error for "${checkpointId}" — using in-memory:`, err);
      return this.memoryFiles.get(checkpointId) || [];
    }
  }

  setSnapshotFiles(checkpointId: string, files: StoredSnapshotFile[]): void {
    const snapshot = files.map((file) => ({
      relativePath: file.relativePath,
      content: Buffer.from(file.content),
    }));
    this.memoryFiles.set(checkpointId, snapshot);
    if (!this.pool) return;

    this.enqueue(`checkpoint-files:${checkpointId}`, async () => {
      let client;
      try {
        client = await this.pool!.connect();
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
        if (client) await client.query('ROLLBACK').catch(() => {});
        console.warn(`[AI Studio] Database snapshot write failed — preserved in-memory:`, error);
      } finally {
        if (client) client.release();
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
      if (this.pool) {
        await this.pool.end().catch(() => {});
      }
    }
  }

  private enqueue(key: string, write: () => Promise<void>): void {
    const previous = this.pendingWrites.get(key);
    const next = (previous ? previous.catch(() => undefined) : Promise.resolve())
      .then(write);
    this.pendingWrites.set(key, next);
  }
}

import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

export interface StoredSnapshotFile {
  relativePath: string;
  content: Buffer;
}

export class PersistentJsonStore {
  private readonly pool: Pool | null = null;
  private readonly pendingWrites = new Map<string, Promise<void>>();
  private readonly memoryDocs = new Map<string, any>();
  private readonly memoryFiles = new Map<string, StoredSnapshotFile[]>();
  private readonly fallbackPath = path.resolve(
    process.env.RARE_APP_ROOT || process.cwd(),
    '.rare',
    'state',
    'persistent-documents.json',
  );
  private databaseStatus: { configured: boolean; reachable: boolean; schemaReady: boolean; error?: string };

  constructor(connectionString = process.env.DATABASE_URL) {
    this.loadFallbackDocuments();
    this.databaseStatus = {
      configured: Boolean(connectionString),
      reachable: false,
      schemaReady: false,
    };
    if (!connectionString) {
      console.warn('[AI Studio] DATABASE_URL not set — using local durable JSON storage');
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
    if (!this.pool) {
      this.databaseStatus = { configured: false, reachable: false, schemaReady: false };
      return;
    }
    try {
      await this.pool.query('SELECT 1');
      const result = await this.pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`,
        [[
          'rare_persistent_documents',
          'rare_checkpoint_files',
          'projects',
          'project_tasks',
          'agent_events',
          'artifacts',
          'rare_sessions',
        ]],
      );
      const available = new Set(result.rows.map((row) => row.table_name));
      const required = ['rare_persistent_documents', 'rare_checkpoint_files', 'projects', 'project_tasks', 'agent_events', 'artifacts', 'rare_sessions'];
      const missing = required.filter((table) => !available.has(table));
      this.databaseStatus = {
        configured: true,
        reachable: true,
        schemaReady: missing.length === 0,
        error: missing.length > 0 ? `Database schema is missing: ${missing.join(', ')}` : undefined,
      };
      if (missing.length > 0) console.warn(`[AI Studio] Database schema is incomplete: ${missing.join(', ')}`);
    } catch (error) {
      this.databaseStatus = {
        configured: true,
        reachable: false,
        schemaReady: false,
        error: error instanceof Error ? error.message : 'Database connection failed',
      };
      console.warn('[AI Studio] PostgreSQL is unavailable — continuing with local durable JSON storage');
    }
  }

  getStatus(): { configured: boolean; reachable: boolean; schemaReady: boolean; error?: string; mode: string } {
    return {
      ...this.databaseStatus,
      mode: this.pool && this.databaseStatus.reachable && this.databaseStatus.schemaReady
        ? 'postgresql'
        : 'local-json',
    };
  }

  async getOrSeed<T>(key: string, initialValue: T): Promise<T> {
    if (!this.pool) {
      if (!this.memoryDocs.has(key)) {
        this.memoryDocs.set(key, initialValue);
        this.saveFallbackDocuments();
      }
      return this.memoryDocs.get(key);
    }
    try {
      const existing = await this.pool.query<{ payload: T }>(
        'SELECT payload FROM rare_persistent_documents WHERE document_key = $1',
        [key],
      );
      if (existing.rows.length > 0) return existing.rows[0].payload;

      const fallbackValue = this.memoryDocs.has(key) ? this.memoryDocs.get(key) : initialValue;

      const inserted = await this.pool.query<{ payload: T }>(
        `INSERT INTO rare_persistent_documents (document_key, payload)
         VALUES ($1, $2::jsonb)
         ON CONFLICT (document_key) DO NOTHING
         RETURNING payload`,
        [key, JSON.stringify(fallbackValue)],
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
      this.saveFallbackDocuments();
      return this.memoryDocs.get(key);
    }
  }

  setDocument(key: string, value: unknown): void {
    this.memoryDocs.set(key, value);
    this.saveFallbackDocuments();
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
        this.databaseStatus = {
          ...this.databaseStatus,
          schemaReady: false,
          error: err instanceof Error ? err.message : 'Database write failed',
        };
        console.warn(`[AI Studio] Database write error for "${key}" — stored in-memory:`, err);
      }
    });
  }

  async persistProjectRun(run: Record<string, any>): Promise<void> {
    if (!this.pool || !this.databaseStatus.schemaReady) return;
    let client;
    try {
      client = await this.pool.connect();
      await client.query('BEGIN');
      const userId = run.userId || 'usr_system_legacy';
      await client.query(
        `INSERT INTO projects (id, user_id, title, target_domain, objective, status, created_at, updated_at, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
         ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, title = EXCLUDED.title, target_domain = EXCLUDED.target_domain,
           objective = EXCLUDED.objective, status = EXCLUDED.status, updated_at = EXCLUDED.updated_at,
           payload = EXCLUDED.payload`,
        [run.id, userId, run.title, run.targetDomain, run.objective, run.status, run.createdAt, run.updatedAt, JSON.stringify(run)],
      );
      for (const agent of run.agents || []) {
        await client.query(
          `INSERT INTO project_tasks (id, project_id, title, assigned_role, status, details, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
           ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, assigned_role = EXCLUDED.assigned_role,
             status = EXCLUDED.status, details = EXCLUDED.details, updated_at = EXCLUDED.updated_at`,
          [`${run.id}:${agent.id}`, run.id, agent.currentTask || agent.title, agent.role, agent.status, JSON.stringify(agent), run.createdAt, run.updatedAt],
        );
      }
      for (const event of run.events || []) {
        await client.query(
          `INSERT INTO agent_events (id, project_id, agent_id, agent_name, level, message, tool_called, file_affected, created_at, payload)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
           ON CONFLICT (id) DO UPDATE SET level = EXCLUDED.level, message = EXCLUDED.message,
             tool_called = EXCLUDED.tool_called, file_affected = EXCLUDED.file_affected,
             created_at = EXCLUDED.created_at, payload = EXCLUDED.payload`,
          [event.id, run.id, event.agentId, event.agentName, event.level, event.message, event.toolCalled || null, event.fileAffected || null, event.createdAt || run.updatedAt, JSON.stringify(event)],
        );
      }
      for (const artifact of run.artifacts || []) {
        await client.query(
          `INSERT INTO artifacts (id, project_id, name, media_type, size_bytes, storage_path, created_at, payload)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, media_type = EXCLUDED.media_type,
             size_bytes = EXCLUDED.size_bytes, storage_path = EXCLUDED.storage_path,
             created_at = EXCLUDED.created_at, payload = EXCLUDED.payload`,
          [artifact.id || `${run.id}:${artifact.path}`, run.id, artifact.name, artifact.type, Number(artifact.sizeBytes) || 0, artifact.path, run.updatedAt, JSON.stringify(artifact)],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      this.databaseStatus = {
        ...this.databaseStatus,
        schemaReady: false,
        error: error instanceof Error ? error.message : 'Relational project persistence failed',
      };
      console.warn(`[AI Studio] Could not persist project run "${run.id}" relationally:`, error);
    } finally {
      client?.release();
    }
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

  async saveSession(sessionId: string, userId: string, payload: any, expiresAtIso: string): Promise<void> {
    if (!this.pool || !this.databaseStatus.schemaReady) return;
    try {
      await this.pool.query(
        `INSERT INTO rare_sessions (session_id, user_id, payload, expires_at, created_at)
         VALUES ($1, $2, $3::jsonb, $4::timestamptz, now())
         ON CONFLICT (session_id) DO UPDATE SET
           payload = EXCLUDED.payload, expires_at = EXCLUDED.expires_at`,
        [sessionId, userId, JSON.stringify(payload), expiresAtIso],
      );
    } catch (err) {
      console.warn(`[AI Studio] Database write error for session "${sessionId}":`, err);
    }
  }

  async removeSession(sessionId: string): Promise<void> {
    if (!this.pool || !this.databaseStatus.schemaReady) return;
    try {
      await this.pool.query('DELETE FROM rare_sessions WHERE session_id = $1', [sessionId]);
    } catch (err) {
      console.warn(`[AI Studio] Database delete error for session "${sessionId}":`, err);
    }
  }

  async loadSessions(): Promise<Array<{ session_id: string; user_id: string; payload: any; expires_at: string }>> {
    if (!this.pool || !this.databaseStatus.schemaReady) return [];
    try {
      const result = await this.pool.query<{ session_id: string; user_id: string; payload: any; expires_at: string }>(
        'SELECT session_id, user_id, payload, expires_at FROM rare_sessions WHERE expires_at > now()',
      );
      return result.rows;
    } catch (err) {
      console.warn('[AI Studio] Database loadSessions error:', err);
      return [];
    }
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

  private loadFallbackDocuments(): void {
    try {
      const records = JSON.parse(fs.readFileSync(this.fallbackPath, 'utf8')) as Record<string, unknown>;
      for (const [key, value] of Object.entries(records)) this.memoryDocs.set(key, value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[AI Studio] Could not read local durable JSON state:', error);
      }
    }
  }

  private saveFallbackDocuments(): void {
    try {
      fs.mkdirSync(path.dirname(this.fallbackPath), { recursive: true });
      const temporaryPath = `${this.fallbackPath}.tmp`;
      fs.writeFileSync(temporaryPath, JSON.stringify(Object.fromEntries(this.memoryDocs), null, 2), 'utf8');
      fs.renameSync(temporaryPath, this.fallbackPath);
    } catch (error) {
      console.warn('[AI Studio] Could not persist local durable JSON state:', error);
    }
  }
}

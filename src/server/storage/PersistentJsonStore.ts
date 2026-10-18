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
    private readonly localAuthUsers = new Map<string, StoredAuthUser>();
  private readonly localAuthSessions = new Map<string, StoredAuthSession>();
  private readonly fallbackPath = path.resolve(
    process.env.RARE_APP_ROOT || process.cwd(),
    '.rare',
    'state',
    'persistent-documents.json',
  );
  private databaseStatus: { configured: boolean; reachable: boolean; schemaReady: boolean; error?: string };

  constructor(connectionString = process.env.DATABASE_URL) {
    this.loadFallbackDocuments();
        const savedAuthUsers = this.memoryDocs.get('rare_auth_users');
    if (Array.isArray(savedAuthUsers)) {
      for (const user of savedAuthUsers as StoredAuthUser[]) {
        if (user && typeof user.id === 'string') {
          this.localAuthUsers.set(user.id, user);
        }
      }
    }

    const savedAuthSessions = this.memoryDocs.get('rare_auth_sessions');
    if (Array.isArray(savedAuthSessions)) {
      for (const entry of savedAuthSessions) {
        if (
          Array.isArray(entry) &&
          entry.length === 2 &&
          typeof entry[0] === 'string' &&
          entry[1] &&
          typeof entry[1].ownerId === 'string'
        ) {
          this.localAuthSessions.set(entry[0], entry[1]);
        }
      }
    }
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
          'rare_users',
          'rare_sessions',
        ]],
      );
      const available = new Set(result.rows.map((row) => row.table_name));
            const required = [
        'rare_persistent_documents',
        'rare_checkpoint_files',
        'projects',
        'project_tasks',
        'agent_events',
        'artifacts',
        'rare_users',
        'rare_sessions',
      ];
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
  /**
   * Authentication and session data must use PostgreSQL in production.
   * Local persistence is permitted only when explicitly enabled in
   * development and never when --production is present.
   */
  public requireReadyPostgres(): Pool | null {
    const isProduction =
      process.env.NODE_ENV === 'production' ||
      process.argv.includes('--production');

    if (
      this.pool &&
      this.databaseStatus.reachable &&
      this.databaseStatus.schemaReady
    ) {
      return this.pool;
    }

    const allowLocalFallback =
      !isProduction &&
      !process.argv.includes('--production') &&
      process.env.RARE_ALLOW_LOCAL_STORAGE_FALLBACK === 'true';

    if (allowLocalFallback) {
      return null;
    }

    throw new Error(
      'Authentication storage requires a reachable PostgreSQL database ' +
      'with rare_users and rare_sessions installed. ' +
      (this.databaseStatus.error || '')
    );
  }

  private saveLocalAuthState(): void {
    this.memoryDocs.set(
      'rare_auth_users',
      Array.from(this.localAuthUsers.values())
    );
    this.memoryDocs.set(
      'rare_auth_sessions',
      Array.from(this.localAuthSessions.entries())
    );
    this.saveFallbackDocuments();
  }

  private toStoredAuthUser(row: AuthUserRow): StoredAuthUser {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      passwordHash: row.passwordHash,
      provider: row.provider,
      role: row.role,
      createdAt: new Date(row.createdAt).toISOString(),
    };
  }

  public async getAuthUserByEmail(
    email: string
  ): Promise<StoredAuthUser | null> {
    const normalizedEmail = email.trim().toLowerCase();
    const pool = this.requireReadyPostgres();

    if (!pool) {
      for (const user of this.localAuthUsers.values()) {
        if (user.email?.toLowerCase() === normalizedEmail) {
          return { ...user };
        }
      }
      return null;
    }

    const result = await pool.query<AuthUserRow>(
      `SELECT
         id,
         name,
         email,
         phone,
         password_hash AS "passwordHash",
         provider,
         role,
         created_at AS "createdAt"
       FROM rare_users
       WHERE lower(email) = $1
       LIMIT 1`,
      [normalizedEmail]
    );

    return result.rows[0]
      ? this.toStoredAuthUser(result.rows[0])
      : null;
  }

  public async getAuthUserByPhone(
    phone: string
  ): Promise<StoredAuthUser | null> {
    const normalizedPhone = phone.trim();
    const pool = this.requireReadyPostgres();

    if (!pool) {
      for (const user of this.localAuthUsers.values()) {
        if (user.phone === normalizedPhone) {
          return { ...user };
        }
      }
      return null;
    }

    const result = await pool.query<AuthUserRow>(
      `SELECT
         id,
         name,
         email,
         phone,
         password_hash AS "passwordHash",
         provider,
         role,
         created_at AS "createdAt"
       FROM rare_users
       WHERE phone = $1
       LIMIT 1`,
      [normalizedPhone]
    );

    return result.rows[0]
      ? this.toStoredAuthUser(result.rows[0])
      : null;
  }

  public async getAuthUserById(
    id: string
  ): Promise<StoredAuthUser | null> {
    const pool = this.requireReadyPostgres();

    if (!pool) {
      const user = this.localAuthUsers.get(id);
      return user ? { ...user } : null;
    }

    const result = await pool.query<AuthUserRow>(
      `SELECT
         id,
         name,
         email,
         phone,
         password_hash AS "passwordHash",
         provider,
         role,
         created_at AS "createdAt"
       FROM rare_users
       WHERE id = $1
       LIMIT 1`,
      [id]
    );

    return result.rows[0]
      ? this.toStoredAuthUser(result.rows[0])
      : null;
  }

  public async createAuthUser(
    user: StoredAuthUser
  ): Promise<StoredAuthUser> {
    const pool = this.requireReadyPostgres();

    if (!pool) {
      const emailExists = user.email
        ? await this.getAuthUserByEmail(user.email)
        : null;
      const phoneExists = user.phone
        ? await this.getAuthUserByPhone(user.phone)
        : null;

      if (emailExists || phoneExists) {
        const error = new Error('An account with this identity already exists.');
        (error as NodeJS.ErrnoException).code = '23505';
        throw error;
      }

      this.localAuthUsers.set(user.id, { ...user });
      this.saveLocalAuthState();
      return { ...user };
    }

    const result = await pool.query<AuthUserRow>(
      `INSERT INTO rare_users (
         id,
         name,
         email,
         phone,
         password_hash,
         provider,
         role,
         created_at,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       RETURNING
         id,
         name,
         email,
         phone,
         password_hash AS "passwordHash",
         provider,
         role,
         created_at AS "createdAt"`,
      [
        user.id,
        user.name,
        user.email,
        user.phone,
        user.passwordHash,
        user.provider,
        user.role,
        user.createdAt,
      ]
    );

    return this.toStoredAuthUser(result.rows[0]);
  }

  /**
   * A verified OAuth login may update a user's display name, but it must
   * never overwrite an existing password, account role, or provider.
   */
  public async upsertVerifiedOAuthUser(input: {
    id: string;
    name: string;
    email: string;
    provider: 'google' | 'outlook';
    createdAt: string;
  }): Promise<StoredAuthUser> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const pool = this.requireReadyPostgres();

    if (!pool) {
      const existing = await this.getAuthUserByEmail(normalizedEmail);
      if (existing) {
        existing.name = input.name || existing.name;
        this.localAuthUsers.set(existing.id, existing);
        this.saveLocalAuthState();
        return { ...existing };
      }

      return this.createAuthUser({
        id: input.id,
        name: input.name,
        email: normalizedEmail,
        phone: null,
        passwordHash: null,
        provider: input.provider,
        role: 'user',
        createdAt: input.createdAt,
      });
    }

    const result = await pool.query<AuthUserRow>(
      `INSERT INTO rare_users (
         id,
         name,
         email,
         phone,
         password_hash,
         provider,
         role,
         created_at,
         updated_at
       )
       VALUES ($1, $2, $3, NULL, NULL, $4, 'user', $5, now())
       ON CONFLICT (email)
       DO UPDATE SET
         name = EXCLUDED.name,
         updated_at = now()
       RETURNING
         id,
         name,
         email,
         phone,
         password_hash AS "passwordHash",
         provider,
         role,
         created_at AS "createdAt"`,
      [
        input.id,
        input.name,
        normalizedEmail,
        input.provider,
        input.createdAt,
      ]
    );

    return this.toStoredAuthUser(result.rows[0]);
  }

  /**
   * Import legacy accounts without overwriting existing PostgreSQL accounts.
   */
  public async importLegacyAuthUserIfAbsent(
    user: StoredAuthUser
  ): Promise<void> {
    const pool = this.requireReadyPostgres();

    if (!pool) {
      const existing = user.email
        ? await this.getAuthUserByEmail(user.email)
        : user.phone
          ? await this.getAuthUserByPhone(user.phone)
          : null;

      if (!existing) {
        this.localAuthUsers.set(user.id, { ...user });
        this.saveLocalAuthState();
      }
      return;
    }

    await pool.query(
      `INSERT INTO rare_users (
         id,
         name,
         email,
         phone,
         password_hash,
         provider,
         role,
         created_at,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT DO NOTHING`,
      [
        user.id,
        user.name,
        user.email,
        user.phone,
        user.passwordHash,
        user.provider,
        user.role,
        user.createdAt,
      ]
    );
  }

  public async updateAuthUserPasswordHash(
    userId: string,
    passwordHash: string
  ): Promise<void> {
    const pool = this.requireReadyPostgres();

    if (!pool) {
      const user = this.localAuthUsers.get(userId);
      if (!user) throw new Error('Authentication account not found.');
      user.passwordHash = passwordHash;
      this.localAuthUsers.set(userId, user);
      this.saveLocalAuthState();
      return;
    }

    const result = await pool.query(
      `UPDATE rare_users
       SET password_hash = $2, updated_at = now()
       WHERE id = $1`,
      [userId, passwordHash]
    );

    if (result.rowCount !== 1) {
      throw new Error('Authentication account could not be updated.');
    }
  }

  public async createAuthSession(
    tokenHash: string,
    ownerId: string,
    accountId: string | null,
    expiresAt: number
  ): Promise<void> {
    const pool = this.requireReadyPostgres();

    const session: StoredAuthSession = {
      ownerId,
      accountId,
      expiresAt,
    };

    if (!pool) {
      this.localAuthSessions.set(tokenHash, session);
      this.saveLocalAuthState();
      return;
    }

    await pool.query(
      `INSERT INTO rare_sessions (
         token_hash,
         owner_id,
         account_id,
         expires_at
       )
       VALUES ($1, $2, $3, $4)`,
      [
        tokenHash,
        ownerId,
        accountId,
        new Date(expiresAt),
      ]
    );
  }

  public async getAuthSession(
    tokenHash: string
  ): Promise<StoredAuthSession | null> {
    const pool = this.requireReadyPostgres();

    if (!pool) {
      const session = this.localAuthSessions.get(tokenHash);
      return session ? { ...session } : null;
    }

    const result = await pool.query<{
      ownerId: string;
      accountId: string | null;
      expiresAt: number | string;
    }>(
      `SELECT
         owner_id AS "ownerId",
         account_id AS "accountId",
         (EXTRACT(EPOCH FROM expires_at) * 1000)::bigint AS "expiresAt"
       FROM rare_sessions
       WHERE token_hash = $1
         AND revoked_at IS NULL
       LIMIT 1`,
      [tokenHash]
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      ownerId: row.ownerId,
      accountId: row.accountId,
      expiresAt: Number(row.expiresAt),
    };
  }

  public async deleteAuthSession(tokenHash: string): Promise<void> {
    const pool = this.requireReadyPostgres();

    if (!pool) {
      if (this.localAuthSessions.delete(tokenHash)) {
        this.saveLocalAuthState();
      }
      return;
    }

    await pool.query(
      'DELETE FROM rare_sessions WHERE token_hash = $1',
      [tokenHash]
    );
  }
  async persistProjectRun(run: Record<string, any>): Promise<void> {
    if (!this.pool || !this.databaseStatus.schemaReady) return;
    let client;
    try {
      client = await this.pool.connect();
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO projects (id, title, target_domain, objective, status, created_at, updated_at, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, target_domain = EXCLUDED.target_domain,
           objective = EXCLUDED.objective, status = EXCLUDED.status, updated_at = EXCLUDED.updated_at,
           payload = EXCLUDED.payload`,
        [run.id, run.title, run.targetDomain, run.objective, run.status, run.createdAt, run.updatedAt, JSON.stringify(run)],
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

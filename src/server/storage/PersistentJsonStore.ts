import { Pool } from 'pg';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Directory used for the file-backed JSON fallback store.
 *
 * Order of precedence:
 *  1. RARE_APP_ROOT — explicit operator choice, always honoured.
 *  2. Vercel's writable temp directory — the deployment filesystem is read-only
 *     except for os.tmpdir(), so writing next to process.cwd() would fail with
 *     EROFS/EACCES and turn every request into a 500.
 *  3. process.cwd() — normal self-hosted behaviour, unchanged.
 */
function resolveWritableAppRoot(): string {
  const configured = process.env.RARE_APP_ROOT?.trim();
  if (configured) return configured;
  if (process.env.VERCEL) return os.tmpdir();
  return process.cwd();
}

/**
 * True only when the operator has EXPLICITLY opted in to ephemeral local storage.
 *
 * Deliberately independent of NODE_ENV: managed platforms (Vercel, Render, Fly)
 * always set NODE_ENV=production, so gating on it would make the documented
 * RARE_ALLOW_LOCAL_STORAGE_FALLBACK flag impossible to use there. The default
 * remains fail-closed — without this flag, a missing database still throws.
 *
 * The `--production` CLI flag stays an absolute block: it is an explicit request
 * for a production-grade process and must never fall back to local storage.
 */
export function isLocalStorageFallbackExplicitlyAllowed(): boolean {
  if (process.argv.includes('--production')) return false;
  return process.env.RARE_ALLOW_LOCAL_STORAGE_FALLBACK === 'true';
}

/** Emit the production opt-in warning once per process, not once per request. */
let localFallbackWarningEmitted = false;

export interface StoredSnapshotFile {
  relativePath: string;
  content: Buffer;
}
export type StoredAuthProvider =
  | 'google'
  | 'outlook'
  | 'email'
  | 'phone';

export type StoredAuthRole = 'developer' | 'user';

export interface StoredAuthUser {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  passwordHash: string | null;
  provider: StoredAuthProvider;
  role: StoredAuthRole;
  createdAt: string;
}

export interface StoredAuthSession {
  ownerId: string;
  accountId: string | null;
  expiresAt: number;
}

interface AuthUserRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  passwordHash: string | null;
  provider: StoredAuthProvider;
  role: StoredAuthRole;
  createdAt: Date | string;
}
export class PersistentJsonStore {
  private readonly pool: Pool | null = null;
  private readonly pendingWrites = new Map<string, Promise<void>>();
  private readonly memoryDocs = new Map<string, any>();
  private readonly memoryFiles = new Map<string, StoredSnapshotFile[]>();
  private readonly localAuthUsers = new Map<string, StoredAuthUser>();
  private readonly localAuthSessions = new Map<string, StoredAuthSession>();
  private readonly localOAuthIdentities = new Map<string, string>();
  private readonly localDeveloperCredentials = new Map<string, string>();
  private readonly localDeveloperGrants = new Map<string, number>();
  private readonly fallbackPath = path.resolve(
    resolveWritableAppRoot(),
    '.rare',
    'state',
    'persistent-documents.json',
  );
  private databaseStatus: { configured: boolean; reachable: boolean; schemaReady: boolean; error?: string };

  constructor(connectionString: string | null | undefined = process.env.DATABASE_URL) {
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
    const savedOAuthIdentities = this.memoryDocs.get('rare_auth_oauth_identities');
    if (Array.isArray(savedOAuthIdentities)) {
      for (const entry of savedOAuthIdentities) {
        if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string') {
          this.localOAuthIdentities.set(entry[0], entry[1]);
        }
      }
    }
    const savedDeveloperCredentials = this.memoryDocs.get('rare_developer_credentials');
    if (Array.isArray(savedDeveloperCredentials)) {
      for (const entry of savedDeveloperCredentials) {
        if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string') {
          this.localDeveloperCredentials.set(entry[0], entry[1]);
        }
      }
    }
    const savedDeveloperGrants = this.memoryDocs.get('rare_developer_grants');
    if (Array.isArray(savedDeveloperGrants)) {
      for (const entry of savedDeveloperGrants) {
        if (Array.isArray(entry) && typeof entry[0] === 'string' && Number.isFinite(entry[1])) {
          this.localDeveloperGrants.set(entry[0], entry[1]);
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
          'rare_oauth_identities',
          'rare_developer_credentials',
          'rare_developer_grants',
          'rare_user_state',
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
        'rare_oauth_identities',
        'rare_developer_credentials',
        'rare_developer_grants',
        'rare_user_state',
      ];
      const missing = required.filter((table) => !available.has(table));
      if (available.has('projects')) {
        const ownerColumn = await this.pool.query(
          "SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'projects' AND column_name = 'owner_id'",
        );
        if (ownerColumn.rowCount !== 1) missing.push('projects.owner_id');
      }
      const rlsTables = ['rare_user_state', 'projects', 'project_tasks', 'agent_events', 'artifacts'];
      const rlsResult = await this.pool.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        'SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relnamespace = current_schema()::regnamespace AND relname = ANY($1::text[])',
        [rlsTables],
      );
      const rlsReady = new Map(rlsResult.rows.map((row) => [row.relname, row.relrowsecurity && row.relforcerowsecurity]));
      for (const table of rlsTables) if (available.has(table) && !rlsReady.get(table)) missing.push(table + '.row_level_security');
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

  /** Read private state under the authenticated owner recorded in the session. */
  public async getOwnedState<T>(ownerId: string, stateKey: string, initialValue: T): Promise<T> {
    this.assertOwnerStateArguments(ownerId, stateKey);
    const pool = this.requireReadyPostgres();
    if (!pool) {
      const key = this.localOwnerStateKey(ownerId, stateKey);
      if (!this.memoryDocs.has(key)) {
        this.memoryDocs.set(key, initialValue);
        this.saveFallbackDocuments();
      }
      return this.memoryDocs.get(key) as T;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('rare.user_id', $1, true)", [ownerId]);
      const result = await client.query<{ payload: T }>(
        'SELECT payload FROM rare_user_state WHERE owner_id = $1 AND state_key = $2',
        [ownerId, stateKey],
      );
      if (result.rows.length > 0) {
        await client.query('COMMIT');
        return result.rows[0].payload;
      }
      const inserted = await client.query<{ payload: T }>(
        `INSERT INTO rare_user_state (owner_id, state_key, payload)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (owner_id, state_key) DO NOTHING
         RETURNING payload`,
        [ownerId, stateKey, JSON.stringify(initialValue)],
      );
      if (inserted.rows.length > 0) {
        await client.query('COMMIT');
        return inserted.rows[0].payload;
      }
      const raced = await client.query<{ payload: T }>(
        'SELECT payload FROM rare_user_state WHERE owner_id = $1 AND state_key = $2',
        [ownerId, stateKey],
      );
      await client.query('COMMIT');
      if (!raced.rows.length) throw new Error('Could not initialize private user state.');
      return raced.rows[0].payload;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Atomically update private state; the owner is never accepted from payload data. */
  public async updateOwnedState<T>(
    ownerId: string,
    stateKey: string,
    initialValue: T,
    update: (current: T) => T,
  ): Promise<T> {
    this.assertOwnerStateArguments(ownerId, stateKey);
    const pool = this.requireReadyPostgres();
    if (!pool) {
      const key = this.localOwnerStateKey(ownerId, stateKey);
      const current = this.memoryDocs.has(key) ? this.memoryDocs.get(key) as T : initialValue;
      const next = update(current);
      this.memoryDocs.set(key, next);
      this.saveFallbackDocuments();
      return next;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('rare.user_id', $1, true)", [ownerId]);
      await client.query(
        `INSERT INTO rare_user_state (owner_id, state_key, payload)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (owner_id, state_key) DO NOTHING`,
        [ownerId, stateKey, JSON.stringify(initialValue)],
      );
      const currentResult = await client.query<{ payload: T }>(
        'SELECT payload FROM rare_user_state WHERE owner_id = $1 AND state_key = $2 FOR UPDATE',
        [ownerId, stateKey],
      );
      if (!currentResult.rows.length) throw new Error('Private user state is unavailable.');
      const next = update(currentResult.rows[0].payload);
      await client.query(
        `UPDATE rare_user_state SET payload = $3::jsonb, updated_at = now()
         WHERE owner_id = $1 AND state_key = $2`,
        [ownerId, stateKey, JSON.stringify(next)],
      );
      await client.query('COMMIT');
      return next;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private assertOwnerStateArguments(ownerId: string, stateKey: string): void {
    if (!ownerId || ownerId.length > 200 || !stateKey || stateKey.length > 120) {
      throw new Error('A valid authenticated owner and private state key are required.');
    }
  }

  private localOwnerStateKey(ownerId: string, stateKey: string): string {
    return `rare_user_state:${ownerId}:${stateKey}`;
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
   *
   * Local persistence is never used *silently*: it requires the operator to set
   * RARE_ALLOW_LOCAL_STORAGE_FALLBACK=true explicitly. The `--production` CLI
   * flag remains an absolute block, because it is an explicit request for a
   * production-grade process. NODE_ENV=production alone no longer vetoes the
   * opt-in, because managed platforms (Vercel, Render, Fly) always set it and
   * would otherwise make the documented flag impossible to use.
   */
  public requireReadyPostgres(): Pool | null {
    if (
      this.pool &&
      this.databaseStatus.reachable &&
      this.databaseStatus.schemaReady
    ) {
      return this.pool;
    }

    const allowLocalFallback = isLocalStorageFallbackExplicitlyAllowed();

    if (allowLocalFallback) {
      if (process.env.NODE_ENV === 'production' && !localFallbackWarningEmitted) {
        localFallbackWarningEmitted = true;
        console.warn(
          '[AI Studio] RARE_ALLOW_LOCAL_STORAGE_FALLBACK=true is active in a ' +
          'production process. Authentication and session data will use ' +
          'ephemeral local storage instead of PostgreSQL. This is an explicit ' +
          'operator opt-in for single-instance demos only; configure ' +
          'DATABASE_URL for durable, multi-instance deployments.'
        );
      }
      return null;
    }

    throw new Error(
      'Authentication storage requires a reachable PostgreSQL database ' +
      'with rare_users and rare_sessions installed. ' +
      'Set DATABASE_URL, or set RARE_ALLOW_LOCAL_STORAGE_FALLBACK=true to ' +
      'explicitly accept ephemeral single-instance local storage. ' +
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
    this.memoryDocs.set('rare_auth_oauth_identities', Array.from(this.localOAuthIdentities.entries()));
    this.memoryDocs.set('rare_developer_credentials', Array.from(this.localDeveloperCredentials.entries()));
    this.memoryDocs.set('rare_developer_grants', Array.from(this.localDeveloperGrants.entries()));
    this.saveFallbackDocuments();
  }

  public async getDeveloperCredential(userId: string): Promise<string | null> {
    if (!userId || userId.length > 200) throw new Error('Developer account ID is required.');
    const pool = this.requireReadyPostgres();
    if (!pool) return this.localDeveloperCredentials.get(userId) ?? null;
    const result = await pool.query<{ secret_hash: string }>(
      'SELECT secret_hash FROM rare_developer_credentials WHERE user_id = $1', [userId],
    );
    return result.rows[0]?.secret_hash ?? null;
  }

  public async setDeveloperCredential(userId: string, secretHash: string): Promise<void> {
    if (!userId || userId.length > 200) throw new Error('Developer account ID is required.');
    if (!secretHash || secretHash.length > 512) throw new Error('Developer credential hash is invalid.');
    const pool = this.requireReadyPostgres();
    if (!pool) {
      this.localDeveloperCredentials.set(userId, secretHash);
      this.saveLocalAuthState();
      return;
    }
    await pool.query(
      `INSERT INTO rare_developer_credentials (user_id, secret_hash, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET secret_hash = EXCLUDED.secret_hash, updated_at = now()`, [userId, secretHash],
    );
  }

  public async grantDeveloperSession(sessionHash: string, expiresAt: number): Promise<void> {
    const pool = this.requireReadyPostgres();
    if (!pool) {
      this.localDeveloperGrants.set(sessionHash, expiresAt);
      this.saveLocalAuthState();
      return;
    }
    await pool.query(
      `INSERT INTO rare_developer_grants (session_hash, expires_at) VALUES ($1, to_timestamp($2 / 1000.0))
       ON CONFLICT (session_hash) DO UPDATE SET expires_at = EXCLUDED.expires_at`, [sessionHash, expiresAt],
    );
  }

  public async getDeveloperGrant(sessionHash: string): Promise<number | null> {
    const pool = this.requireReadyPostgres();
    if (!pool) return this.localDeveloperGrants.get(sessionHash) ?? null;
    const result = await pool.query<{ expires_at: Date | string }>(
      'SELECT expires_at FROM rare_developer_grants WHERE session_hash = $1', [sessionHash],
    );
    const value = result.rows[0]?.expires_at;
    return value ? new Date(value).getTime() : null;
  }

  public async revokeDeveloperGrant(sessionHash: string): Promise<void> {
    const pool = this.requireReadyPostgres();
    if (!pool) {
      this.localDeveloperGrants.delete(sessionHash);
      this.saveLocalAuthState();
      return;
    }
    await pool.query('DELETE FROM rare_developer_grants WHERE session_hash = $1', [sessionHash]);
  }

  public async revokeAllDeveloperGrants(): Promise<void> {
    const pool = this.requireReadyPostgres();
    if (!pool) {
      this.localDeveloperGrants.clear();
      this.saveLocalAuthState();
      return;
    }
    await pool.query('DELETE FROM rare_developer_grants');
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
    emailVerified: boolean;
    provider: 'google' | 'outlook';
    subject: string;
    createdAt: string;
  }): Promise<StoredAuthUser> {
    const normalizedEmail = input.emailVerified && input.email.trim() ? input.email.trim().toLowerCase() : null;
    if (!input.subject || input.subject.length > 512) throw new Error('Verified OAuth subject is invalid.');
    const identityKey = `${input.provider}:${input.subject}`;
    const pool = this.requireReadyPostgres();

    if (!pool) {
      const linkedId = this.localOAuthIdentities.get(identityKey);
      let user = linkedId ? this.localAuthUsers.get(linkedId) || null : normalizedEmail ? await this.getAuthUserByEmail(normalizedEmail) : null;
      if (!user) user = await this.createAuthUser({
          id: input.id, name: input.name, email: normalizedEmail, phone: null,
          passwordHash: null, provider: input.provider, role: 'user', createdAt: input.createdAt,
        });
      if (linkedId && linkedId !== user.id) throw new Error('OAuth identity is already linked to another account.');
      const existingLink = this.localOAuthIdentities.get(identityKey);
      if (existingLink && existingLink !== user.id) throw new Error('OAuth identity is already linked to another account.');
      user.name = input.name || user.name;
      this.localAuthUsers.set(user.id, user);
      this.localOAuthIdentities.set(identityKey, user.id);
      this.saveLocalAuthState();
      return { ...user };
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existingIdentity = await client.query<AuthUserRow>(
        `SELECT u.id, u.name, u.email, u.phone, u.password_hash AS "passwordHash", u.provider, u.role, u.created_at AS "createdAt"
           FROM rare_oauth_identities i JOIN rare_users u ON u.id = i.user_id
          WHERE i.provider = $1 AND i.subject = $2 FOR UPDATE OF u`,
        [input.provider, input.subject],
      );
      if (existingIdentity.rows[0]) {
        const row = existingIdentity.rows[0];
        const name = input.name || row.name;
        await client.query('UPDATE rare_users SET name = $2, updated_at = now() WHERE id = $1', [row.id, name]);
        await client.query('COMMIT');
        return this.toStoredAuthUser({ ...row, name });
      }

      let account = await client.query<AuthUserRow>(
        `SELECT id, name, email, phone, password_hash AS "passwordHash", provider, role, created_at AS "createdAt"
           FROM rare_users WHERE lower(email) = $1 FOR UPDATE`, [normalizedEmail],
      );
      if (!account.rows[0]) {
        account = await client.query<AuthUserRow>(
          `INSERT INTO rare_users (id, name, email, phone, password_hash, provider, role, created_at, updated_at)
           VALUES ($1, $2, $3, NULL, NULL, $4, 'user', $5, now())
           ON CONFLICT (email) DO UPDATE SET updated_at = rare_users.updated_at
           RETURNING id, name, email, phone, password_hash AS "passwordHash", provider, role, created_at AS "createdAt"`,
          [input.id, input.name, normalizedEmail, input.provider, input.createdAt],
        );
      }
      const row = account.rows[0];
      const insert = await client.query<{ user_id: string }>(
        `INSERT INTO rare_oauth_identities (provider, subject, user_id) VALUES ($1, $2, $3)
         ON CONFLICT (provider, subject) DO NOTHING RETURNING user_id`,
        [input.provider, input.subject, row.id],
      );
      const identityOwner = insert.rows[0]?.user_id ?? (await client.query<{ user_id: string }>(
        'SELECT user_id FROM rare_oauth_identities WHERE provider = $1 AND subject = $2', [input.provider, input.subject],
      )).rows[0]?.user_id;
      if (identityOwner !== row.id) throw new Error('OAuth identity is already linked to another account.');
      const name = input.name || row.name;
      if (name !== row.name) await client.query('UPDATE rare_users SET name = $2, updated_at = now() WHERE id = $1', [row.id, name]);
      await client.query('COMMIT');
      return this.toStoredAuthUser({ ...row, name });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
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
    if (!run.ownerId || typeof run.id !== 'string' || !run.id) throw new Error('Project owner and ID are required for persistence.');
    const pool = this.requireReadyPostgres();
    if (!pool) {
      await this.updateOwnedState<Record<string, any>[]>(run.ownerId, 'projects', [], (projects) => {
        const index = projects.findIndex((project) => project.id === run.id);
        if (index < 0) return [run, ...projects];
        const next = [...projects];
        next[index] = run;
        return next;
      });
      return;
    }
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      await client.query("SELECT set_config('rare.user_id', $1, true)", [run.ownerId]);
      const projectWrite = await client.query(
        `INSERT INTO projects (id, owner_id, title, target_domain, objective, status, created_at, updated_at, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, target_domain = EXCLUDED.target_domain,
           objective = EXCLUDED.objective, status = EXCLUDED.status, updated_at = EXCLUDED.updated_at,
           payload = EXCLUDED.payload WHERE projects.owner_id = EXCLUDED.owner_id`,
        [run.id, run.ownerId || null, run.title, run.targetDomain, run.objective, run.status, run.createdAt, run.updatedAt, JSON.stringify(run)],
      );
      if (projectWrite.rowCount !== 1) throw new Error('Project is already owned by another account.');
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
        error: error instanceof Error ? error.message : 'Relational project persistence failed',
      };
      console.error(`[AI Studio] Could not persist project run "${run.id}" relationally.`);
      throw error;
    } finally {
      client?.release();
    }
  }

  public async listProjectRuns(ownerId: string): Promise<Record<string, any>[]> {
    this.assertOwnerStateArguments(ownerId, 'projects');
    const pool = this.requireReadyPostgres();
    if (!pool) return this.getOwnedState<Record<string, any>[]>(ownerId, 'projects', []);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('rare.user_id', $1, true)", [ownerId]);
      const result = await client.query<{ payload: Record<string, any> }>(
        'SELECT payload FROM projects WHERE owner_id = $1 ORDER BY updated_at DESC', [ownerId],
      );
      await client.query('COMMIT');
      return result.rows.map((row) => row.payload);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async getProjectRun(ownerId: string, projectId: string): Promise<Record<string, any> | null> {
    this.assertOwnerStateArguments(ownerId, 'projects');
    if (!projectId || projectId.length > 200) return null;
    const pool = this.requireReadyPostgres();
    if (!pool) {
      const projects = await this.getOwnedState<Record<string, any>[]>(ownerId, 'projects', []);
      return projects.find((project) => project.id === projectId) ?? null;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('rare.user_id', $1, true)", [ownerId]);
      const result = await client.query<{ payload: Record<string, any> }>(
        'SELECT payload FROM projects WHERE id = $1 AND owner_id = $2 LIMIT 1', [projectId, ownerId],
      );
      await client.query('COMMIT');
      return result.rows[0]?.payload ?? null;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
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

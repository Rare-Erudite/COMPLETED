/**
 * BlobStore — out-of-line storage for binary document payloads.
 *
 * Documents used to keep their bytes inline as base64 in the document record.
 * That works for a small image but it is the wrong shape for media: base64
 * inflates by ~33%, the whole document list is one JSON value, and every
 * listing that only needs metadata drags the bytes along with it.
 *
 * This store keeps the bytes out of the record. A document holds a `blobId`
 * and the metadata it needs; the bytes live here, addressed by that id.
 *
 * Two backends, chosen automatically:
 *  - PostgreSQL (`rare_blobs`) when a database is configured. This is the
 *    durable, multi-instance-safe path and the one production uses.
 *  - The local filesystem under `.rare/blobs/` otherwise, so development and
 *    the test suite work with no database at all.
 *
 * Owner isolation is enforced twice: the metadata record lives in the
 * owner-scoped store, and the Postgres table carries `owner_id` on every read
 * and write. A blob id from another account resolves to nothing.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { resolveWritableAppRoot } from './PersistentJsonStore.js';

export interface BlobMetadata {
  blobId: string;
  ownerId: string;
  size: number;
  mimeType: string;
  filename: string;
  sha256: string;
  createdAt: string;
}

export interface BlobReadResult {
  buffer: Buffer;
  metadata: BlobMetadata;
}

/** The subset of PersistentJsonStore this store needs. */
interface BlobStoreDeps {
  /** True when a real PostgreSQL pool is connected. */
  hasDatabase(): boolean;
  /** Run a query against the pool. Throws when no pool is configured. */
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  getOwnedState<T>(ownerId: string, stateKey: string, initialValue: T): Promise<T>;
  updateOwnedState<T>(
    ownerId: string,
    stateKey: string,
    initialValue: T,
    update: (current: T) => T,
  ): Promise<T>;
}

const METADATA_KEY = 'document_blobs';
const MAX_BLOB_BYTES = 64 * 1024 * 1024;

export class BlobStore {
  private readonly deps: BlobStoreDeps;
  private readonly localRoot: string;

  constructor(deps: BlobStoreDeps, localRoot?: string) {
    this.deps = deps;
    this.localRoot = localRoot || path.resolve(resolveWritableAppRoot(), '.rare', 'blobs');
  }

  /** True when this store is backed by PostgreSQL rather than the filesystem. */
  get durable(): boolean {
    return this.deps.hasDatabase();
  }

  /**
   * Store bytes and return their metadata.
   *
   * The id is random rather than content-addressed: two owners uploading the
   * same file must not be able to infer each other's content from a shared id,
   * and a re-upload after a delete must not resurrect the old record.
   */
  async put(
    ownerId: string,
    buffer: Buffer,
    options: { mimeType?: string; filename?: string } = {},
  ): Promise<BlobMetadata> {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error('Cannot store an empty blob.');
    }
    if (buffer.length > MAX_BLOB_BYTES) {
      throw new Error(
        `The file is ${(buffer.length / 1024 / 1024).toFixed(1)} MB; the blob limit is ` +
        `${MAX_BLOB_BYTES / 1024 / 1024} MB.`,
      );
    }

    const blobId = `blob_${crypto.randomUUID()}`;
    const metadata: BlobMetadata = {
      blobId,
      ownerId,
      size: buffer.length,
      mimeType: options.mimeType || 'application/octet-stream',
      filename: options.filename || blobId,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      createdAt: new Date().toISOString(),
    };

    if (this.deps.hasDatabase()) {
      await this.deps.query(
        `INSERT INTO rare_blobs (blob_id, owner_id, content, size, mime_type, filename, sha256, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [blobId, ownerId, buffer, buffer.length, metadata.mimeType, metadata.filename, metadata.sha256, metadata.createdAt],
      );
    } else {
      const target = this.localPath(ownerId, blobId);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const temporary = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, buffer);
      fs.renameSync(temporary, target);
    }

    // The metadata record is owner-scoped, so a blob id alone is not enough to
    // read a file — the reader must also be the owner.
    await this.deps.updateOwnedState<BlobMetadata[]>(ownerId, METADATA_KEY, [], (records) => [
      metadata,
      ...records.filter((record) => record.blobId !== blobId),
    ]);

    return metadata;
  }

  /** Read a blob's bytes. Returns null when it does not exist or is not owned. */
  async get(ownerId: string, blobId: string): Promise<BlobReadResult | null> {
    const metadata = await this.stat(ownerId, blobId);
    if (!metadata) return null;

    if (this.deps.hasDatabase()) {
      const result = await this.deps.query<{ content: Buffer }>(
        'SELECT content FROM rare_blobs WHERE blob_id = $1 AND owner_id = $2 LIMIT 1',
        [blobId, ownerId],
      );
      const row = result.rows[0];
      if (!row) return null;
      const buffer = Buffer.isBuffer(row.content) ? row.content : Buffer.from(row.content);
      if (buffer.length !== metadata.size) {
        throw new Error(
          `Stored blob "${blobId}" is inconsistent: ${buffer.length} bytes present, ${metadata.size} recorded.`,
        );
      }
      return { buffer, metadata };
    }

    const target = this.localPath(ownerId, blobId);
    if (!fs.existsSync(target)) return null;
    const buffer = fs.readFileSync(target);
    if (buffer.length !== metadata.size) {
      throw new Error(
        `Stored blob "${blobId}" is inconsistent: ${buffer.length} bytes present, ${metadata.size} recorded.`,
      );
    }
    return { buffer, metadata };
  }

  /** Metadata only — no bytes read. Returns null when not owned. */
  async stat(ownerId: string, blobId: string): Promise<BlobMetadata | null> {
    const records = await this.deps.getOwnedState<BlobMetadata[]>(ownerId, METADATA_KEY, []);
    return records.find((record) => record.blobId === blobId) || null;
  }

  /** Delete a blob and its metadata. Returns false when it was not owned. */
  async delete(ownerId: string, blobId: string): Promise<boolean> {
    const metadata = await this.stat(ownerId, blobId);
    if (!metadata) return false;

    if (this.deps.hasDatabase()) {
      await this.deps.query('DELETE FROM rare_blobs WHERE blob_id = $1 AND owner_id = $2', [blobId, ownerId]);
    } else {
      const target = this.localPath(ownerId, blobId);
      try {
        fs.rmSync(target, { force: true });
      } catch {
        // A missing file is not an error: the metadata is the source of truth.
      }
    }

    await this.deps.updateOwnedState<BlobMetadata[]>(ownerId, METADATA_KEY, [], (records) =>
      records.filter((record) => record.blobId !== blobId),
    );
    return true;
  }

  /** Total bytes stored for an owner, for quota reporting. */
  async usage(ownerId: string): Promise<{ count: number; bytes: number }> {
    const records = await this.deps.getOwnedState<BlobMetadata[]>(ownerId, METADATA_KEY, []);
    return {
      count: records.length,
      bytes: records.reduce((total, record) => total + (record.size || 0), 0),
    };
  }

  /**
   * Local filesystem path for a blob.
   *
   * The owner id is hashed into the directory name so a raw account id never
   * appears on disk, and the blob id is validated so a crafted id cannot walk
   * out of the root.
   */
  private localPath(ownerId: string, blobId: string): string {
    if (!/^blob_[0-9a-f-]{36}$/i.test(blobId)) {
      throw new Error('Invalid blob id.');
    }
    const ownerDir = crypto.createHash('sha256').update(ownerId).digest('hex').slice(0, 32);
    return path.join(this.localRoot, ownerDir, blobId);
  }
}

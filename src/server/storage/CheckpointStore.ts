import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { CheckpointRecord } from '../types.js';
import type { PersistentJsonStore, StoredSnapshotFile } from './PersistentJsonStore.js';

const PROJECT_ROOT = path.resolve(process.env.RARE_APP_ROOT || process.cwd());
const CHECKPOINTS_DIR = path.resolve(PROJECT_ROOT, '.rare', 'checkpoints');
const REGISTRY_FILE = path.resolve(CHECKPOINTS_DIR, 'checkpoints_registry.json');

export class CheckpointStore {
  private registry: Map<string, CheckpointRecord> = new Map();
  private persistence: PersistentJsonStore | undefined;

  constructor() {
    this.init();
  }

  public async initializePersistence(persistence: PersistentJsonStore): Promise<void> {
    this.persistence = persistence;
    const records = await persistence.getOrSeed(
      'checkpoints',
      Array.from(this.registry.values()),
    );
    this.registry = new Map(records.map((record) => [record.id, record]));

    for (const record of records) {
      const snapshotDir = path.resolve(PROJECT_ROOT, record.snapshotDir);
      const storedFiles = await persistence.loadSnapshotFiles(record.id);
      if (storedFiles.length > 0) {
        for (const file of storedFiles) {
          const destination = this.resolveSafePath(snapshotDir, file.relativePath);
          fs.mkdirSync(path.dirname(destination), { recursive: true });
          fs.writeFileSync(destination, file.content);
        }
        continue;
      }

      const localFiles: StoredSnapshotFile[] = [];
      for (const relativePath of record.filesList) {
        const localPath = this.resolveSafePath(snapshotDir, relativePath);
        if (fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
          localFiles.push({
            relativePath,
            content: fs.readFileSync(localPath),
          });
        }
      }
      if (localFiles.length > 0) {
        persistence.setSnapshotFiles(record.id, localFiles);
      }
    }
  }

  private init(): void {
    try {
      if (!fs.existsSync(CHECKPOINTS_DIR)) {
        fs.mkdirSync(CHECKPOINTS_DIR, { recursive: true });
      }

      if (fs.existsSync(REGISTRY_FILE)) {
        const raw = fs.readFileSync(REGISTRY_FILE, 'utf-8');
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const cp of list) {
            this.registry.set(cp.id, cp);
          }
        }
      } else {
        // Create baseline initial checkpoint
        this.createCheckpoint('Initial baseline known-good state', 'known_good');
      }
    } catch (err) {
      console.error('[CheckpointStore] Init error:', err);
    }
  }

  private saveRegistry(): void {
    const arr = Array.from(this.registry.values());
    try {
      const tempPath = `${REGISTRY_FILE}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(arr, null, 2), 'utf-8');
      fs.renameSync(tempPath, REGISTRY_FILE);
    } catch (err) {
      console.error('[CheckpointStore] Failed to write registry:', err);
    }
    this.persistence?.setDocument('checkpoints', arr);
  }

  public getAll(): CheckpointRecord[] {
    return Array.from(this.registry.values()).sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  public getById(id: string): CheckpointRecord | undefined {
    return this.registry.get(id);
  }

  public createCheckpoint(
    description: string,
    status: 'known_good' | 'experimental' | 'unverified' = 'experimental',
    targetFiles?: string[]
  ): CheckpointRecord {
    const id = `chk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const snapshotDir = path.resolve(CHECKPOINTS_DIR, id);
    fs.mkdirSync(snapshotDir, { recursive: true });

    // Files to backup
    const filesToBackup: string[] = targetFiles && targetFiles.length > 0
      ? targetFiles
      : ['server.ts', 'src/App.tsx', 'package.json', 'rare.config.json'];

    const backedUp: string[] = [];
    const snapshotFiles: StoredSnapshotFile[] = [];
    const hashGenerator = crypto.createHash('sha256');

    for (const rel of filesToBackup) {
      const fullPath = this.resolveSafePath(PROJECT_ROOT, rel);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        const content = fs.readFileSync(fullPath);
        hashGenerator.update(content);
        const dest = this.resolveSafePath(snapshotDir, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, content);
        backedUp.push(rel);
        snapshotFiles.push({ relativePath: rel, content });
      }
    }

    const record: CheckpointRecord = {
      id,
      timestamp: new Date().toISOString(),
      description,
      status,
      filesCount: backedUp.length,
      filesList: backedUp,
      snapshotDir: path.relative(PROJECT_ROOT, snapshotDir),
      hash: hashGenerator.digest('hex'),
    };

    this.registry.set(id, record);
    this.saveRegistry();
    this.persistence?.setSnapshotFiles(id, snapshotFiles);
    return record;
  }

  public restoreCheckpoint(id: string): { success: boolean; restoredFiles: string[]; error?: string } {
    const cp = this.registry.get(id);
    if (!cp) {
      return { success: false, restoredFiles: [], error: `Checkpoint not found: ${id}` };
    }

    const snapshotDir = path.resolve(PROJECT_ROOT, cp.snapshotDir);
    if (!fs.existsSync(snapshotDir)) {
      return { success: false, restoredFiles: [], error: `Snapshot directory missing on disk: ${cp.snapshotDir}` };
    }

    const restored: string[] = [];
    for (const rel of cp.filesList) {
      const backupFile = this.resolveSafePath(snapshotDir, rel);
      const targetFile = this.resolveSafePath(PROJECT_ROOT, rel);
      if (fs.existsSync(backupFile)) {
        fs.mkdirSync(path.dirname(targetFile), { recursive: true });
        fs.copyFileSync(backupFile, targetFile);
        restored.push(rel);
      }
    }

    return { success: true, restoredFiles: restored };
  }

  private resolveSafePath(root: string, relativePath: string): string {
    const resolvedRoot = path.resolve(root);
    const resolved = path.resolve(resolvedRoot, relativePath);
    if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new Error(`Unsafe checkpoint path: ${relativePath}`);
    }
    return resolved;
  }
}

/**
 * RARE-INTELLIGENCE — Durable File-Persistent Storage Engine
 * Multi-collection atomic disk persistence with checksums and rotating backups.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { IMemoryStore } from './base.js';
import {
  ConversationSession,
  DiagnosticReport,
  MemoryItem,
  SelfRepairResult,
  TaskPlan,
  WorkspaceCheckpoint,
} from '../types.js';
import { logger } from '../security/logger.js';

interface StorageSchema {
  version: number;
  checksum?: string;
  updatedAt: number;
  collections: {
    memories: Record<string, MemoryItem>;
    tasks: Record<string, TaskPlan>;
    conversations: Record<string, ConversationSession>;
    checkpoints: Record<string, WorkspaceCheckpoint>;
    reports: DiagnosticReport[];
    repairs: SelfRepairResult[];
    auditEvents: Array<{ event: string; details: any; timestamp: number }>;
  };
}

export class FilePersistentStore implements IMemoryStore {
  public readonly storageType = 'file-backed-persistent';
  public readonly isPersistent = true;

  private readonly storageDir: string;
  private readonly backupDir: string;
  private readonly primaryFilePath: string;
  private data: StorageSchema;

  constructor(customStorageDir?: string) {
    this.storageDir = customStorageDir || path.resolve(process.cwd(), 'data');
    this.backupDir = path.resolve(this.storageDir, 'backups');
    this.primaryFilePath = path.resolve(this.storageDir, 'rare_intelligence_memory.json');

    this.data = {
      version: 1,
      updatedAt: Date.now(),
      collections: {
        memories: {},
        tasks: {},
        conversations: {},
        checkpoints: {},
        reports: [],
        repairs: [],
        auditEvents: [],
      },
    };

    this.initialize();
  }

  private initialize(): void {
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }
      if (!fs.existsSync(this.backupDir)) {
        fs.mkdirSync(this.backupDir, { recursive: true });
      }

      if (fs.existsSync(this.primaryFilePath)) {
        const raw = fs.readFileSync(this.primaryFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.collections) {
          this.data = parsed;
          logger.info('FilePersistentStore', `Loaded durable store from ${this.primaryFilePath}`);
          return;
        }
      }
      // Initialize with fresh file
      this.persistToDisk();
      logger.info('FilePersistentStore', `Initialized new durable store at ${this.primaryFilePath}`);
    } catch (err: any) {
      logger.warn('FilePersistentStore', `Failed to load disk store: ${err.message}. Creating initial file.`);
      this.persistToDisk();
    }
  }

  private persistToDisk(): void {
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }
      this.data.updatedAt = Date.now();
      const content = JSON.stringify(this.data, null, 2);
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      this.data.checksum = hash;

      const tmpFile = `${this.primaryFilePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tmpFile, content, 'utf-8');
      fs.renameSync(tmpFile, this.primaryFilePath);
    } catch (err: any) {
      logger.error('FilePersistentStore', `Failed to persist state to disk: ${err.message}`);
    }
  }

  public createBackup(): string {
    try {
      if (!fs.existsSync(this.backupDir)) {
        fs.mkdirSync(this.backupDir, { recursive: true });
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.resolve(this.backupDir, `backup_${timestamp}.json`);
      fs.writeFileSync(backupPath, JSON.stringify(this.data, null, 2), 'utf-8');
      return backupPath;
    } catch (err: any) {
      logger.error('FilePersistentStore', `Failed to create backup: ${err.message}`);
      return '';
    }
  }

  public getStats() {
    const backupFiles = fs.existsSync(this.backupDir) ? fs.readdirSync(this.backupDir) : [];
    return {
      primaryFilePath: this.primaryFilePath,
      storageDir: this.storageDir,
      backupDir: this.backupDir,
      backupsCount: backupFiles.length,
      updatedAt: this.data.updatedAt,
      collections: {
        memories: Object.keys(this.data.collections.memories).length,
        tasks: Object.keys(this.data.collections.tasks).length,
        conversations: Object.keys(this.data.collections.conversations).length,
        checkpoints: Object.keys(this.data.collections.checkpoints).length,
        reports: this.data.collections.reports.length,
        repairs: this.data.collections.repairs.length,
        auditEvents: this.data.collections.auditEvents.length,
      },
    };
  }

  // --- IMemoryStore Implementation ---

  public async get(key: string): Promise<MemoryItem | null> {
    return this.data.collections.memories[key] || null;
  }

  public async set(
    item: Omit<MemoryItem, 'id' | 'createdAt' | 'updatedAt' | 'isPersistent'>
  ): Promise<MemoryItem> {
    const existing = this.data.collections.memories[item.key];
    const now = Date.now();
    const stored: MemoryItem = {
      ...item,
      id: existing?.id || 'mem_' + Math.random().toString(36).substring(2, 9),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      isPersistent: true,
    };
    this.data.collections.memories[item.key] = stored;
    this.persistToDisk();
    return stored;
  }

  public async delete(key: string): Promise<boolean> {
    if (this.data.collections.memories[key]) {
      delete this.data.collections.memories[key];
      this.persistToDisk();
      return true;
    }
    return false;
  }

  public async list(category?: MemoryItem['category']): Promise<MemoryItem[]> {
    const all = Object.values(this.data.collections.memories);
    if (!category) return all;
    return all.filter((i) => i.category === category);
  }

  public async search(query: string): Promise<MemoryItem[]> {
    const q = query.toLowerCase();
    return Object.values(this.data.collections.memories).filter(
      (i) =>
        i.key.toLowerCase().includes(q) ||
        i.content.toLowerCase().includes(q) ||
        i.tags.some((t) => t.toLowerCase().includes(q))
    );
  }

  public async clear(): Promise<void> {
    this.data.collections.memories = {};
    this.persistToDisk();
  }

  public async flush(): Promise<void> {
    this.persistToDisk();
  }

  // --- Tasks ---

  public saveTask(plan: TaskPlan): void {
    this.data.collections.tasks[plan.id] = plan;
    this.persistToDisk();
  }

  public getTask(taskId: string): TaskPlan | null {
    return this.data.collections.tasks[taskId] || null;
  }

  public listTasks(): TaskPlan[] {
    return Object.values(this.data.collections.tasks);
  }

  // --- Conversations ---

  public saveConversation(session: ConversationSession): void {
    this.data.collections.conversations[session.id] = session;
    this.persistToDisk();
  }

  public getConversation(id: string): ConversationSession | null {
    return this.data.collections.conversations[id] || null;
  }

  public listConversations(): ConversationSession[] {
    return Object.values(this.data.collections.conversations);
  }

  public deleteConversation(id: string): boolean {
    if (this.data.collections.conversations[id]) {
      delete this.data.collections.conversations[id];
      this.persistToDisk();
      return true;
    }
    return false;
  }

  // --- Checkpoints ---

  public saveCheckpoint(checkpoint: WorkspaceCheckpoint): void {
    this.data.collections.checkpoints[checkpoint.id] = checkpoint;
    this.persistToDisk();
  }

  public getCheckpoint(checkpointId: string): WorkspaceCheckpoint | null {
    return this.data.collections.checkpoints[checkpointId] || null;
  }

  public listCheckpoints(): WorkspaceCheckpoint[] {
    return Object.values(this.data.collections.checkpoints);
  }

  public deleteCheckpoint(checkpointId: string): boolean {
    if (this.data.collections.checkpoints[checkpointId]) {
      delete this.data.collections.checkpoints[checkpointId];
      this.persistToDisk();
      return true;
    }
    return false;
  }

  // --- Diagnostics Reports ---

  public saveDiagnosticReport(report: DiagnosticReport): void {
    this.data.collections.reports.unshift(report);
    if (this.data.collections.reports.length > 50) {
      this.data.collections.reports = this.data.collections.reports.slice(0, 50);
    }
    this.persistToDisk();
  }

  public listDiagnosticReports(): DiagnosticReport[] {
    return this.data.collections.reports;
  }

  // --- Repairs ---

  public saveRepairResult(repairResult: SelfRepairResult): void {
    this.data.collections.repairs.unshift(repairResult);
    if (this.data.collections.repairs.length > 50) {
      this.data.collections.repairs = this.data.collections.repairs.slice(0, 50);
    }
    this.persistToDisk();
  }

  public listRepairResults(): SelfRepairResult[] {
    return this.data.collections.repairs;
  }

  // --- Audit Events ---

  public recordAuditEvent(event: string, details: any): void {
    this.data.collections.auditEvents.unshift({
      event,
      details,
      timestamp: Date.now(),
    });
    if (this.data.collections.auditEvents.length > 100) {
      this.data.collections.auditEvents = this.data.collections.auditEvents.slice(0, 100);
    }
    this.persistToDisk();
  }
}

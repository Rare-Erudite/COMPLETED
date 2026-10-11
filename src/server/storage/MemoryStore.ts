import fs from 'fs';
import path from 'path';
import type { PersistentJsonStore } from './PersistentJsonStore.js';
import { MemoryRecord } from '../types.js';

const PROJECT_ROOT = path.resolve(process.env.RARE_APP_ROOT || process.cwd());
const KNOWLEDGE_DIR = path.resolve(PROJECT_ROOT, 'knowledge');
const MEMORIES_FILE = path.resolve(KNOWLEDGE_DIR, 'memories.json');
const CONVERSATIONS_FILE = path.resolve(KNOWLEDGE_DIR, 'conversations.json');

const SEED_MEMORIES: MemoryRecord[] = [
  {
    id: 'mem_seed_01',
    kind: 'preference',
    text: 'Active UI theme is Blue. The system supports 6 custom themes: Blue, White, Dark, Red, Green, and Yellow.',
    tags: ['ui', 'theme', 'preference'],
    importance: 2,
    timestamp: '2026-09-11T12:00:00.000Z',
    source: 'user_stated',
    verifiedByUser: true,
  },
  {
    id: 'mem_seed_02',
    kind: 'technical_constraint',
    text: 'Architecture follows strict 10-step self-development with isolated checkpoints, permission gates, and rollback guarantees.',
    tags: ['architecture', 'self_dev', 'safety'],
    importance: 4,
    timestamp: '2026-09-11T12:00:00.000Z',
    source: 'user_stated',
    verifiedByUser: true,
  },
  {
    id: 'mem_seed_03',
    kind: 'preference',
    text: 'Discussion on custom high-top sneakers: obsidian black and cobalt blue colorway with gum sole, minimalist silhouette, premium breathable leather.',
    tags: ['shoes', 'sneakers', 'fashion', 'design'],
    importance: 3,
    timestamp: '2026-09-11T14:30:00.000Z',
    source: 'user_stated',
    verifiedByUser: true,
  },
  {
    id: 'mem_seed_04',
    kind: 'technical_constraint',
    text: 'Offline first: Base intelligence operates without an external API key. Tool primitives validate file paths and require passkey for core self-modification.',
    tags: ['offline', 'security', 'tools'],
    importance: 5,
    timestamp: '2026-09-11T15:00:00.000Z',
    source: 'user_stated',
    verifiedByUser: true,
  },
];

export class MemoryStore {
  private memories: Map<string, MemoryRecord> = new Map();
  private persistence: PersistentJsonStore | undefined;

  constructor() {
    this.init();
  }

  public async initializePersistence(persistence: PersistentJsonStore): Promise<void> {
    this.persistence = persistence;
    const records = await persistence.getOrSeed('memories', Array.from(this.memories.values()));
    this.memories = new Map(records.map((record) => [record.id, record]));
  }

  private init(): void {
    try {
      if (!fs.existsSync(KNOWLEDGE_DIR)) {
        fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
      }

      if (fs.existsSync(MEMORIES_FILE)) {
        const raw = fs.readFileSync(MEMORIES_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            this.memories.set(item.id, item);
          }
          return;
        }
      }

      // Seed initial verified memories if not yet written
      for (const m of SEED_MEMORIES) {
        this.memories.set(m.id, m);
      }
      this.saveToDisk();
    } catch (err) {
      console.error('[MemoryStore] Initialization error, falling back to seed:', err);
      for (const m of SEED_MEMORIES) {
        this.memories.set(m.id, m);
      }
    }
  }

  private saveToDisk(): void {
    const arr = Array.from(this.memories.values());
    try {
      const tempPath = `${MEMORIES_FILE}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(arr, null, 2), 'utf-8');
      fs.renameSync(tempPath, MEMORIES_FILE);
    } catch (err) {
      console.error('[MemoryStore] Failed to write memories to disk:', err);
    }
    this.persistence?.setDocument('memories', arr);
  }

  public getAll(): MemoryRecord[] {
    return Array.from(this.memories.values()).sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  public getById(id: string): MemoryRecord | undefined {
    return this.memories.get(id);
  }

  public search(query?: string, tags?: string[]): MemoryRecord[] {
    let results = this.getAll();

    if (tags && tags.length > 0) {
      const lowerTags = tags.map((t) => t.toLowerCase());
      results = results.filter((m) =>
        m.tags.some((tag) => lowerTags.includes(tag.toLowerCase()))
      );
    }

    if (query && query.trim()) {
      const q = query.toLowerCase().trim();
      results = results.filter(
        (m) =>
          m.text.toLowerCase().includes(q) ||
          m.tags.some((t) => t.toLowerCase().includes(q)) ||
          m.kind.toLowerCase().includes(q)
      );
    }

    return results;
  }

  public store(record: {
    text: string;
    kind?: MemoryRecord['kind'];
    tags?: string[];
    importance?: number;
    source?: MemoryRecord['source'];
    verifiedByUser?: boolean;
    id?: string;
    timestamp?: string;
  }): MemoryRecord {
    const newRecord: MemoryRecord = {
      id: record.id || `mem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: record.timestamp || new Date().toISOString(),
      kind: record.kind || 'fact',
      text: record.text,
      tags: record.tags || [],
      importance: record.importance ?? 2,
      source: record.source || 'user_stated',
      verifiedByUser: record.verifiedByUser ?? true,
    };

    this.memories.set(newRecord.id, newRecord);
    this.saveToDisk();
    return newRecord;
  }

  public update(id: string, partial: Partial<Omit<MemoryRecord, 'id'>>): MemoryRecord | null {
    const existing = this.memories.get(id);
    if (!existing) return null;

    const updated: MemoryRecord = {
      ...existing,
      ...partial,
    };
    this.memories.set(id, updated);
    this.saveToDisk();
    return updated;
  }

  public delete(id: string): boolean {
    const existed = this.memories.delete(id);
    if (existed) {
      this.saveToDisk();
    }
    return existed;
  }

  public export(): { total: number; exportedAt: string; memories: MemoryRecord[] } {
    const items = this.getAll();
    return {
      total: items.length,
      exportedAt: new Date().toISOString(),
      memories: items,
    };
  }
}

// -----------------------------------------------------------------------------
// Conversation Store with Disk Persistence
// -----------------------------------------------------------------------------
export interface ChatMessageRecord {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  thought?: string;
  actionDetected?: any;
}

export interface ConversationRecord {
  id: string;
  title: string;
  created_at: string;
  messages: ChatMessageRecord[];
  customTitle?: boolean;
  userId?: string;
}

export class ConversationStore {
  private conversations: Map<string, ConversationRecord> = new Map();
  private persistence: PersistentJsonStore | undefined;

  constructor() {
    this.init();
  }

  public async initializePersistence(persistence: PersistentJsonStore): Promise<void> {
    this.persistence = persistence;
    const records = await persistence.getOrSeed(
      'conversation_store',
      Array.from(this.conversations.values()),
    );
    this.conversations = new Map(records.map((record) => [record.id, record]));
  }

  private init(): void {
    try {
      if (!fs.existsSync(KNOWLEDGE_DIR)) {
        fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
      }
      if (fs.existsSync(CONVERSATIONS_FILE)) {
        const raw = fs.readFileSync(CONVERSATIONS_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const c of parsed) {
            this.conversations.set(c.id, c);
          }
          return;
        }
      }

      // Default seed conversation for guest
      const seedConv: ConversationRecord = {
        id: 'conv_main',
        title: 'General Inquiries',
        created_at: new Date(Date.now() - 3600000).toISOString(),
        userId: 'guest',
        messages: [
          {
            id: 'msg_1',
            role: 'assistant',
            content: `Hello! I am RARE — your personal intelligence and development assistant.\n\nWhat would you like to work on today?\n• Projects / Build: Build web, mobile, or desktop software with coordinated specialist agents.\n• Documents: Manage, read, edit, or transcribe audio documents.\n• Research: Investigate technical, academic, or factual topics with verified sources.`,
            timestamp: new Date(Date.now() - 3600000).toISOString(),
          },
        ],
      };
      this.conversations.set(seedConv.id, seedConv);
      this.saveToDisk();
    } catch (err) {
      console.error('[ConversationStore] Init error:', err);
    }
  }

  private saveToDisk(): void {
    const arr = Array.from(this.conversations.values());
    try {
      const tempPath = `${CONVERSATIONS_FILE}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(arr, null, 2), 'utf-8');
      fs.renameSync(tempPath, CONVERSATIONS_FILE);
    } catch (err) {
      console.error('[ConversationStore] Failed to write conversations to disk:', err);
    }
    this.persistence?.setDocument('conversation_store', arr);
  }

  public getAll(userId?: string): ConversationRecord[] {
    const all = Array.from(this.conversations.values());
    const filtered = userId && userId.trim()
      ? all.filter((c) => c.userId === userId || (!c.userId && userId === 'guest'))
      : all;

    return filtered.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  public getById(id: string): ConversationRecord | undefined {
    return this.conversations.get(id);
  }

  public save(conv: ConversationRecord): void {
    this.conversations.set(conv.id, conv);
    this.saveToDisk();
  }

  public delete(id: string): boolean {
    const existed = this.conversations.delete(id);
    if (existed) this.saveToDisk();
    return existed;
  }
}

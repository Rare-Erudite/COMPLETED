import fs from 'fs';
import path from 'path';
import { DevelopmentTrajectory } from '../types.js';
import type { PersistentJsonStore } from './PersistentJsonStore.js';

const PROJECT_ROOT = path.resolve(process.env.RARE_APP_ROOT || process.cwd());
const KNOWLEDGE_DIR = path.resolve(PROJECT_ROOT, 'knowledge');
const TRAJECTORIES_FILE = path.resolve(KNOWLEDGE_DIR, 'trajectories.json');

export class TrajectoryStore {
  private trajectories: Map<string, DevelopmentTrajectory> = new Map();
  private persistence: PersistentJsonStore | undefined;

  constructor() {
    this.init();
  }

  public async initializePersistence(persistence: PersistentJsonStore): Promise<void> {
    this.persistence = persistence;
    const records = await persistence.getOrSeed(
      'trajectories',
      Array.from(this.trajectories.values()),
    );
    this.trajectories = new Map(records.map((record) => [record.id, record]));
  }

  private init(): void {
    try {
      if (!fs.existsSync(KNOWLEDGE_DIR)) {
        fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
      }

      if (fs.existsSync(TRAJECTORIES_FILE)) {
        const raw = fs.readFileSync(TRAJECTORIES_FILE, 'utf-8');
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const item of list) {
            this.trajectories.set(item.id, item);
          }
        }
      }
    } catch (err) {
      console.error('[TrajectoryStore] Init error:', err);
    }
  }

  private saveToDisk(): void {
    const arr = Array.from(this.trajectories.values());
    try {
      const tempPath = `${TRAJECTORIES_FILE}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(arr, null, 2), 'utf-8');
      fs.renameSync(tempPath, TRAJECTORIES_FILE);
    } catch (err) {
      console.error('[TrajectoryStore] Failed to write trajectories:', err);
    }
    this.persistence?.setDocument('trajectories', arr);
  }

  public getAll(): DevelopmentTrajectory[] {
    return Array.from(this.trajectories.values()).sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  public record(t: DevelopmentTrajectory): void {
    this.trajectories.set(t.id, t);
    this.saveToDisk();
  }
}

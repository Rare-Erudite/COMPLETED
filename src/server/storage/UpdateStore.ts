import fs from 'fs';
import path from 'path';
import type { PersistentJsonStore } from './PersistentJsonStore.js';

const PROJECT_ROOT = path.resolve(process.env.RARE_APP_ROOT || process.cwd());
const UPDATES_FILE = path.join(PROJECT_ROOT, 'knowledge', 'updates.json');

export type UpdateChannel = 'public' | 'developer';

export interface AppUpdate {
  id: string;
  version: string;
  releaseDate: string;
  channel: UpdateChannel;
  title: string;
  description: string;
  changelog: string[];
  mandatory?: boolean;
  packageUrl?: string;
  apkSize?: string;
  publishedBy: string;
  targetRoles: ('all' | 'developer')[];
}

export class UpdateStore {
  private filePath: string;
  private updates: AppUpdate[] = [];
  private persistence: PersistentJsonStore | undefined;

  constructor(customPath?: string) {
    this.filePath = customPath || UPDATES_FILE;
    this.init();
  }

  public async initializePersistence(persistence: PersistentJsonStore): Promise<void> {
    this.persistence = persistence;
    this.updates = await persistence.getOrSeed('updates', this.updates);
  }

  private init() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this.updates = JSON.parse(raw);
      } else {
        // Seed initial releases
        this.updates = [
          {
            id: 'upd_100_stable',
            version: '1.0.0',
            releaseDate: new Date(Date.now() - 86400000 * 2).toISOString(),
            channel: 'public',
            title: 'RARE Core Intelligence 1.0 General Release',
            description: 'Official release of RARE with native offline cognitive engine, persistent cross-chat memory, VisionCraft image synthesis, and multi-agent builder.',
            changelog: [
              'Zero external API key requirement for general conversations and reasoning',
              'Integrated 12 autonomous tool primitives with audit logging and sandbox safety',
              'Persistent cross-chat memory and customizable appearance themes',
              'Standalone APK package ready for Android installation and offline sharing',
              'Universal PWA support with WebAPK launcher icon and offline cache'
            ],
            mandatory: false,
            packageUrl: '/api/download/apk',
            apkSize: '24.8 MB',
            publishedBy: 'RARE Core Engineering',
            targetRoles: ['all']
          },
          {
            id: 'upd_110_dev_preview',
            version: '1.1.0-dev',
            releaseDate: new Date(Date.now() - 3600000 * 4).toISOString(),
            channel: 'developer',
            title: 'Developer Preview: Autonomous Self-Development & Live OTA Push',
            description: 'Developer-only early access release featuring privileged self-development engine telemetry, real-time OTA update deployment, and atomic rollback snapshots.',
            changelog: [
              'Privileged Developer Space OTA push system: publish builds to Public or Developer channels',
              'Self-development trajectory dataset inspection and automated verification loops',
              'Fine-grained benchmark evaluation suite across 6 empirical cognitive vectors',
              'Dual-channel distribution router ensuring unreleased features remain restricted to developers'
            ],
            mandatory: false,
            packageUrl: '/api/download/apk',
            apkSize: '25.2 MB',
            publishedBy: 'Self-Development Engine',
            targetRoles: ['developer']
          }
        ];
        this.persist();
      }
    } catch (err) {
      console.warn('[UpdateStore] Init fallback:', err);
      this.updates = [];
    }
  }

  private persist() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.updates, null, 2), 'utf-8');
    } catch (err) {
      console.error('[UpdateStore] Save failed:', err);
    }
    this.persistence?.setDocument('updates', this.updates);
  }

  public getAll(channel?: UpdateChannel): AppUpdate[] {
    if (!channel || channel === 'developer') {
      // Developers can see both developer and public updates
      return [...this.updates].sort((a, b) => new Date(b.releaseDate).getTime() - new Date(a.releaseDate).getTime());
    }
    // Public users only see public updates
    return this.updates
      .filter((u) => u.channel === 'public')
      .sort((a, b) => new Date(b.releaseDate).getTime() - new Date(a.releaseDate).getTime());
  }

  public getLatest(channel: UpdateChannel): AppUpdate | null {
    const list = this.getAll(channel);
    return list.length > 0 ? list[0] : null;
  }

  public checkForUpdate(clientVersion: string, channel: UpdateChannel): {
    hasUpdate: boolean;
    update: AppUpdate | null;
    clientVersion: string;
    latestVersion: string;
    channel: UpdateChannel;
  } {
    const availableUpdates = this.getAll(channel);
    if (availableUpdates.length === 0) {
      return {
        hasUpdate: false,
        update: null,
        clientVersion,
        latestVersion: clientVersion,
        channel,
      };
    }

    const latest = availableUpdates[0];
    const isNewer = this.isVersionNewer(latest.version, clientVersion);

    return {
      hasUpdate: isNewer,
      update: isNewer ? latest : null,
      clientVersion,
      latestVersion: latest.version,
      channel,
    };
  }

  public publish(data: {
    version: string;
    channel: UpdateChannel;
    title: string;
    description: string;
    changelog: string[];
    mandatory?: boolean;
    publishedBy?: string;
  }): AppUpdate {
    const id = `upd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newUpdate: AppUpdate = {
      id,
      version: data.version.trim(),
      releaseDate: new Date().toISOString(),
      channel: data.channel,
      title: data.title.trim(),
      description: data.description.trim(),
      changelog: Array.isArray(data.changelog) && data.changelog.length > 0
        ? data.changelog.map((c) => String(c).trim()).filter(Boolean)
        : ['General performance improvements and system optimizations.'],
      mandatory: Boolean(data.mandatory),
      packageUrl: '/api/download/apk',
      apkSize: '25.0 MB',
      publishedBy: data.publishedBy || 'Developer Space',
      targetRoles: data.channel === 'developer' ? ['developer'] : ['all'],
    };

    // Prepend to top
    this.updates.unshift(newUpdate);
    this.persist();
    return newUpdate;
  }

  public delete(id: string): boolean {
    const idx = this.updates.findIndex((u) => u.id === id);
    if (idx !== -1) {
      this.updates.splice(idx, 1);
      this.persist();
      return true;
    }
    return false;
  }

  private isVersionNewer(candidate: string, current: string): boolean {
    if (candidate === current) return false;
    
    // Normalize versions e.g. "1.1.0" or "v1.1.0" or "1.1.0-dev"
    const parse = (v: string) => {
      const clean = v.replace(/^v/, '');
      const parts = clean.split('-')[0].split('.').map((p) => parseInt(p, 10) || 0);
      const isDev = v.toLowerCase().includes('dev') || v.toLowerCase().includes('beta');
      return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0, isDev };
    };

    const cand = parse(candidate);
    const curr = parse(current);

    if (cand.major !== curr.major) return cand.major > curr.major;
    if (cand.minor !== curr.minor) return cand.minor > curr.minor;
    if (cand.patch !== curr.patch) return cand.patch > curr.patch;

    // If numerical numbers are identical, but candidate has dev/preview and current does not,
    // or candidate is explicitly different string
    return candidate !== current;
  }
}

import fs from 'fs';
import path from 'path';
import type { PersistentJsonStore } from './PersistentJsonStore.js';

import { resolveWritableAppRoot } from './PersistentJsonStore.js';
const PROJECT_ROOT = path.resolve(process.env.RARE_APP_ROOT || resolveWritableAppRoot());
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
  artifactSizeBytes?: number;
  sha256?: string;
  platform?: 'web' | 'android' | 'windows';
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
    const persisted = await persistence.getOrSeed('updates', this.updates);
    const stored = Array.isArray(persisted) ? persisted.filter(isValidStoredUpdate) : [];

    // A persisted release record can be older than the build actually shipped
    // with this deployment. getOrSeed() never overwrites an existing row, so a
    // stale record would keep advertising an old version forever and clients
    // would never be offered the current APK. Prefer whichever side is newer.
    const seeded = this.updates.filter(isValidStoredUpdate);
    const newest = (list: AppUpdate[]): AppUpdate | null =>
      list.length === 0
        ? null
        : list.reduce((a, b) =>
            this.isVersionNewer(b.version, a.version) ? b : a,
          );

    const storedNewest = newest(stored);
    const seededNewest = newest(seeded);

    if (
      seededNewest &&
      (!storedNewest || this.isVersionNewer(seededNewest.version, storedNewest.version))
    ) {
      this.updates = seeded;
      this.persist();
      return;
    }

    this.updates = stored;
  }

  private init() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        this.updates = Array.isArray(parsed) ? parsed.filter(isValidStoredUpdate) : [];
      }
    } catch (err) {
      console.warn('[UpdateStore] Could not load release metadata; starting with no releases.');
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
    const published = this.updates.filter(isValidStoredUpdate);
    if (!channel || channel === 'developer') {
      // Developers can see both developer and public updates
      return [...published].sort((a, b) => new Date(b.releaseDate).getTime() - new Date(a.releaseDate).getTime());
    }
    // Public users only see public updates
    return published
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

  /**
   * Accept either a same-origin path served by this deployment
   * (`/api/download/apk`) or an HTTPS GitHub Releases URL under the RARE
   * repository. A relative path is resolved against the trusted repo, so a
   * release published by a developer can point at the APK this app serves.
   */
  private static readonly TRUSTED_PREFIX = '/Rare-Erudite/COMPLETED/releases/download/';

  private resolvePackageUrl(raw: string): string | null {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    const value = raw.trim();
    // Same-origin API path: only the app's own download endpoint is allowed.
    if (value.startsWith('/')) {
      return /^\/api\/download\/(apk|exe)(\/chunk)?$/.test(value) ? value : null;
    }
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:') return null;
      if (url.username || url.password) return null;
      if (url.hostname !== 'github.com') return null;
      if (!url.pathname.startsWith(UpdateStore.TRUSTED_PREFIX)) return null;
      return url.toString();
    } catch {
      return null;
    }
  }

  public publish(data: {
    version: string;
    channel: UpdateChannel;
    title: string;
    description: string;
    changelog: string[];
    mandatory?: boolean;
    publishedBy?: string;
    packageUrl: string;
    platform: 'web' | 'android' | 'windows';
    artifactSizeBytes: number;
    sha256: string;
  }): AppUpdate {
    const packageUrl = this.resolvePackageUrl(data.packageUrl);
    if (!packageUrl) {
      throw new Error(
        "Release artifacts must be either this deployment's /api/download/apk|exe endpoint or an HTTPS GitHub Releases URL under Rare-Erudite/COMPLETED.",
      );
    }
    if (!Number.isSafeInteger(data.artifactSizeBytes) || data.artifactSizeBytes <= 0) {
      throw new Error('A release must include the verified artifact size in bytes.');
    }
    if (data.artifactSizeBytes > 512 * 1024 * 1024) {
      throw new Error('Release artifacts larger than 512 MiB cannot be verified by this client.');
    }
    if (!/^[a-f0-9]{64}$/i.test(data.sha256)) {
      throw new Error('A release must include the artifact SHA-256 checksum.');
    }
    if (!['web', 'android', 'windows'].includes(data.platform)) {
      throw new Error('A supported release platform is required.');
    }
    if (!data.version.trim() || !data.title.trim() || !data.description.trim()) {
      throw new Error('Release version, title, and description are required.');
    }
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
      packageUrl: packageUrl.toString(),
      platform: data.platform,
      artifactSizeBytes: data.artifactSizeBytes,
      apkSize: `${(data.artifactSizeBytes / (1024 * 1024)).toFixed(2)} MB`,
      sha256: data.sha256.toLowerCase(),
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

function isValidStoredUpdate(value: unknown): value is AppUpdate {
  if (!value || typeof value !== 'object') return false;
  const update = value as Partial<AppUpdate>;
  if (!update.packageUrl || !update.platform || !update.artifactSizeBytes || !update.sha256) return false;
  if (!Number.isSafeInteger(update.artifactSizeBytes) || update.artifactSizeBytes <= 0) return false;
  if (update.artifactSizeBytes > 512 * 1024 * 1024) return false;
  if (!/^[a-f0-9]{64}$/i.test(update.sha256)) return false;
  if (!['web', 'android', 'windows'].includes(update.platform)) return false;
  // Same-origin download path, or a trusted GitHub Releases URL.
  if (update.packageUrl.startsWith('/')) {
    return /^\/api\/download\/(apk|exe)(\/chunk)?$/.test(update.packageUrl);
  }
  try {
    const url = new URL(update.packageUrl);
    return url.protocol === 'https:' &&
      url.hostname === 'github.com' &&
      url.pathname.startsWith('/Rare-Erudite/COMPLETED/releases/download/') &&
      !url.username && !url.password;
  } catch {
    return false;
  }
}

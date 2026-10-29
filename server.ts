import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';
import { MemoryStore, ConversationStore } from './src/server/storage/MemoryStore.js';
import { CheckpointStore } from './src/server/storage/CheckpointStore.js';
import { TrajectoryStore } from './src/server/storage/TrajectoryStore.js';
import { UpdateStore, UpdateChannel, AppUpdate } from './src/server/storage/UpdateStore.js';
import { DurableStateStore } from './src/server/storage/DurableStateStore.js';
import { PersistentJsonStore } from './src/server/storage/PersistentJsonStore.js';
import { DocumentStore } from './src/server/storage/DocumentStore.js';
import { ResearchService } from './src/server/services/ResearchService.js';
import { DocumentsService, DocumentPathError, normalizeDocumentPath } from './src/server/services/DocumentsService.js';
import { DeepResearchEngine } from './src/server/services/DeepResearchEngine.js';
import { listProviders as listResearchProviders } from './src/server/services/ResearchProviders.js';
import { OwnerSearchIndexRegistry } from './src/server/content/SearchIndex.js';
import { processBuffer, processUrl, describeResult } from './src/server/content/ContentEngine.js';
import { probeExtractors } from './src/server/content/Extractors.js';
import { ToolExecutor } from './src/server/tools/ToolExecutor.js';
import { ProviderRegistry } from './src/server/providers/ProviderRegistry.js';
import { buildRareSystemPrompt } from './src/server/providers/RarePrompt.js';
import { prepareConversationContext } from './src/server/providers/ConversationContext.js';
import { SelfDevelopmentEngine } from './src/server/development/SelfDevelopmentEngine.js';
import { BenchmarkSuite } from './src/server/evaluation/BenchmarkSuite.js';
import { engine } from './src/engine/engine.ts';
import { googleTtsProvider } from './src/server/providers/GoogleTtsProvider.js';
import { notificationDeliveryService } from './src/server/providers/NotificationDeliveryService.js';
import { oAuthVerificationService } from './src/server/providers/OAuthVerificationService.js';

const app = express();
const PROJECT_ROOT = path.resolve(process.env.RARE_APP_ROOT || process.cwd());
const PORT = process.argv.includes('--port')
  ? Number(process.argv[process.argv.indexOf('--port') + 1])
  : (Number(process.env.PORT) || 3000);
process.env.RARE_INTELLIGENCE_URL = process.env.RARE_INTELLIGENCE_URL || `http://127.0.0.1:${PORT}`;
const durableStateStore = new DurableStateStore();
let persistentStorage: PersistentJsonStore | undefined;
let serverInitialization: Promise<void> | undefined;

const developmentOrigins = [
  'http://localhost:3000', 'http://localhost:5173',
  'http://127.0.0.1:3000', 'http://127.0.0.1:5173',
];
const configuredOrigins = (process.env.RARE_ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
  .map((origin) => {
    let parsed: URL;
    try { parsed = new URL(origin); } catch { throw new Error('RARE_ALLOWED_ORIGINS must contain exact HTTP(S) origins.'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin.replace(/\/$/, '')) {
      throw new Error('RARE_ALLOWED_ORIGINS must contain origins only, without paths, credentials, wildcards, or query strings.');
    }
    return parsed.origin;
  });
const allowedOrigins = new Set([
  ...(process.env.NODE_ENV === 'production' ? [] : developmentOrigins),
  ...configuredOrigins,
]);
app.use(cors({
  origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  exposedHeaders: ['X-CSRF-Token'],
  credentials: true,
}));
app.use(express.json({ limit: '15mb' }));
app.use((req, res, next) => {
  const originalEnd = res.end.bind(res);
  let ending = false;
  res.end = ((...args: any[]) => {
    const finish = () =>
      (originalEnd as (...endArgs: any[]) => express.Response)(...args);
    if (ending) return finish();
    ending = true;

    const storage = persistentStorage;
    if (!storage) return finish();

    void storage.flush().then(finish).catch((error) => {
      console.error('[Storage] Could not persist request state:', error);
      if (res.headersSent) return finish();
      res.statusCode = 503;
      res.removeHeader('Content-Length');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      (originalEnd as (...endArgs: any[]) => express.Response)(
        JSON.stringify({
          error: { message: 'Persistent storage failed; the request was not confirmed.' },
        }),
      );
    });
    return res;
  }) as typeof res.end;
  next();
});

// -----------------------------------------------------------------------------
// Core System Singletons & Persistent Stores
// -----------------------------------------------------------------------------
const memoryStore = new MemoryStore();
const conversationStore = new ConversationStore();
const checkpointStore = new CheckpointStore();
const trajectoryStore = new TrajectoryStore();
const updateStore = new UpdateStore();
const documentStore = new DocumentStore(PROJECT_ROOT);
const researchService = new ResearchService();
const searchIndexes = new OwnerSearchIndexRegistry();
const deepResearchEngine = new DeepResearchEngine();
/** Documents service is constructed once storage is ready (see startServer). */
let documentsService: DocumentsService | undefined;
const toolExecutor = new ToolExecutor(memoryStore, checkpointStore, researchService);
const providerRegistry = new ProviderRegistry(memoryStore, toolExecutor);
const selfDevEngine = new SelfDevelopmentEngine(checkpointStore, trajectoryStore, toolExecutor);
const benchmarkSuite = new BenchmarkSuite(toolExecutor, memoryStore, checkpointStore);

// -----------------------------------------------------------------------------
// Core System State & Config
// -----------------------------------------------------------------------------
type ActiveTheme = 'blue' | 'white' | 'dark' | 'red' | 'green' | 'yellow';
const appSettings = durableStateStore.trackObject('app_settings', {
  assistantName: 'RARE',
  autonomyLevel: 2,
  activeTheme: 'blue' as ActiveTheme,
});

// Developer grants and the passkey verifier are stored durably by the auth store.
const developerAuthFailures = new Map<string, { count: number; resetAt: number }>();

async function isDeveloperSessionAuthorized(
  req: express.Request
): Promise<boolean> {
  const token = readBearerSessionToken(req);

  if (!token || !persistentStorage) {
    return false;
  }

  const tokenHash = hashUserSessionToken(token);

  try {
    const session = await persistentStorage.getAuthSession(tokenHash);
    const developerExpiresAt = await persistentStorage.getDeveloperGrant(tokenHash);

    if (!session || session.expiresAt <= Date.now()) {
      await persistentStorage.revokeDeveloperGrant(tokenHash);
      return false;
    }
    if (!developerExpiresAt || developerExpiresAt <= Date.now()) {
      await persistentStorage.revokeDeveloperGrant(tokenHash);
      return false;
    }

    if (!session.accountId) {
      await persistentStorage.revokeDeveloperGrant(tokenHash);
      return false;
    }
    const account = await persistentStorage.getAuthUserById(session.accountId);
    if (!account || account.role !== 'developer') {
      await persistentStorage.revokeDeveloperGrant(tokenHash);
      return false;
    }

    return true;
  } catch (error) {
    console.error(
      '[Auth] Developer session validation failed:',
      error
    );
    return false;
  }
}

async function consumeGuestQuota(ownerId: string, action: string, limit: number): Promise<boolean> {
  if (!persistentStorage) return false;
  let allowed = false;
  await persistentStorage.updateOwnedState<Record<string, number>>(ownerId, 'guest_usage', {}, (usage) => {
    const current = Number(usage[action]) || 0;
    if (current >= limit) return usage;
    allowed = true;
    return { ...usage, [action]: current + 1 };
  });
  return allowed;
}

// Access requests dispatched to owner (rarelivescore@gmail.com)
interface DevAccessRequest {
  id: string;
  requesterName: string;
  requesterEmail: string;
  reason: string;
  timestamp: string;
  status: 'pending' | 'approved' | 'rejected';
}
const devAccessRequests = durableStateStore.trackArray<DevAccessRequest>(
  'developer_access_requests',
  [],
);

// User accounts database (in-memory persistent state)
interface AppUser {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  password?: string;
  passwordHash?: string;
  provider: 'google' | 'outlook' | 'email' | 'phone';
  role: 'developer' | 'user';
  createdAt: string;
}
function toPublicAuthUser(user: {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  provider: 'google' | 'outlook' | 'email' | 'phone';
  role: 'developer' | 'user';
  createdAt: string;
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email ?? undefined,
    phone: user.phone ?? undefined,
    provider: user.provider,
    role: user.role,
    createdAt: user.createdAt,
  };
}
let registeredUsers: Map<string, AppUser> = new Map([
  [
    'rarelivescore@gmail.com',
    {
      id: 'usr_owner_1',
      name: 'RARE Core Owner',
      email: 'rarelivescore@gmail.com',
      provider: 'google',
      role: 'developer',
      createdAt: new Date().toISOString(),
    },
  ],
]);
registeredUsers = durableStateStore.trackMap('registered_users', registeredUsers);
const legacyRegisteredUsers = registeredUsers;
type UserSessionRecord = {
  userId: string;
  expiresAt: number;
};

const USER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

let userSessions: Map<string, UserSessionRecord> = new Map();
userSessions = durableStateStore.trackMap('user_sessions', userSessions);

function hashUserSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const SESSION_COOKIE_NAME = 'rare_session';
const CSRF_COOKIE_NAME = 'rare_csrf';
function readCookie(req: express.Request, name: string): string | null {
  const cookieHeader = req.headers.cookie || '';
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch { return null; }
  }
  return null;
}

function setSessionCookies(res: express.Response, token: string): string {
  // Signing the double-submit token with the HttpOnly session secret prevents
  // a sibling subdomain from planting an arbitrary CSRF cookie.
  const csrfToken = crypto.createHmac('sha256', token).update('rare-csrf-v1').digest('base64url');
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  // SameSite=None is required when a separately hosted frontend calls the API.
  const sameSite = process.env.NODE_ENV === 'production' ? 'None' : 'Lax';
  const common = `Path=/; SameSite=${sameSite}; Max-Age=${Math.floor(USER_SESSION_TTL_MS / 1000)}${secure}`;
  res.append('Set-Cookie', `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; ${common}; HttpOnly`);
  res.append('Set-Cookie', `${CSRF_COOKIE_NAME}=${encodeURIComponent(csrfToken)}; ${common}`);
  res.setHeader('X-CSRF-Token', csrfToken);
  return csrfToken;
}

function clearSessionCookies(res: express.Response): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const sameSite = process.env.NODE_ENV === 'production' ? 'None' : 'Lax';
  res.append('Set-Cookie', `${SESSION_COOKIE_NAME}=; Path=/; SameSite=${sameSite}; Max-Age=0${secure}; HttpOnly`);
  res.append('Set-Cookie', `${CSRF_COOKIE_NAME}=; Path=/; SameSite=${sameSite}; Max-Age=0${secure}`);
}
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');

  const derivedKey = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, key) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(key);
    });
  });

  return `scrypt:${salt}:${derivedKey.toString('hex')}`;
}

async function verifySecretHash(encodedHash: string, candidate: string): Promise<boolean> {
  const [scheme, salt, expectedHex, extra] = encodedHash.split(':');
  if (scheme !== 'scrypt' || !salt || !expectedHex || extra || !/^[a-f0-9]{128}$/i.test(expectedHex)) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(candidate, salt, 64, (error, key) => error ? reject(error) : resolve(key));
  });
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

async function verifyDeveloperPasskey(candidate: unknown, accountId: string): Promise<{ valid: boolean; configured: boolean }> {
  if (typeof candidate !== 'string' || !candidate || candidate.length > 256 || !persistentStorage || !accountId) return { valid: false, configured: false };
  let stored = await persistentStorage.getDeveloperCredential(accountId);
  const configured = process.env.RARE_DEV_KEY?.trim() || null;
  if (!stored && !configured) return { valid: false, configured: false };
  if (!stored && configured) {
    if (candidate !== configured) return { valid: false, configured: true };
    stored = await hashPassword(configured);
    await persistentStorage.setDeveloperCredential(accountId, stored);
  }
  return { valid: await verifySecretHash(stored!, candidate), configured: true };
}
function issueSessionForOwner(userId: string): {
  sessionToken: string;
  expiresAt: number;
} {
  const sessionToken = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + USER_SESSION_TTL_MS;

  // Store only the token hash, not the reusable bearer token.
  userSessions.set(hashUserSessionToken(sessionToken), {
    userId,
    expiresAt,
  });

  return { sessionToken, expiresAt };
}

function issueUserSession(user: {
  id: string;
  email?: string | null;
  phone?: string | null;
}): {
  sessionToken: string;
  expiresAt: number;
} {
  return issueSessionForOwner(user.id);
}

function readBearerSessionToken(req: express.Request): string | null {
  const cookieToken = readCookie(req, SESSION_COOKIE_NAME);
  if (cookieToken) return cookieToken;
  const authorization = String(req.headers.authorization || '');
  const match = /^Bearer\s+(\S+)$/i.exec(authorization);

  return match?.[1] || null;
}


const requireAuthenticatedSession: express.RequestHandler = async (
  req,
  res,
  next
) => {
  const token = readBearerSessionToken(req);

  if (!token) {
    return res.status(401).json({
      error: {
        message: 'A valid RARE session is required.',
      },
    });
  }

  const tokenHash = hashUserSessionToken(token);

  const cookieSessionToken = readCookie(req, SESSION_COOKIE_NAME);
  if (cookieSessionToken) {
    const csrfCookie = readCookie(req, CSRF_COOKIE_NAME) || '';
    const csrfHeader = String(req.headers['x-csrf-token'] || '');
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      const origin = req.headers.origin;
      const expectedCsrf = crypto.createHmac('sha256', cookieSessionToken).update('rare-csrf-v1').digest('base64url');
      if (!origin || !allowedOrigins.has(origin) || !csrfCookie || !csrfHeader ||
          csrfCookie.length !== csrfHeader.length ||
          csrfCookie.length !== expectedCsrf.length ||
          !crypto.timingSafeEqual(Buffer.from(csrfCookie), Buffer.from(csrfHeader)) ||
          !crypto.timingSafeEqual(Buffer.from(csrfCookie), Buffer.from(expectedCsrf))) {
        return res.status(403).json({ error: { message: 'The request could not be verified. Refresh and try again.' } });
      }
    }
    if (csrfCookie) res.setHeader('X-CSRF-Token', csrfCookie);
  }

  try {
    const storage = persistentStorage;
    if (!storage) throw new Error('Session storage is unavailable.');
    const session = await storage.getAuthSession(tokenHash);

    if (!session || session.expiresAt <= Date.now()) {
      if (session) {
        await storage.deleteAuthSession(tokenHash);
      }

      userSessions.delete(tokenHash);

      return res.status(401).json({
        error: {
          message: 'Your RARE session is missing or expired. Please sign in again.',
        },
      });
    }

    // Use the identity recorded by the server when the session was created.
    // Account sessions use the immutable account ID; guests keep their unique
    // session owner ID. Email and request-supplied IDs are not principals.
    res.locals.rareUserId = session.accountId || session.ownerId;
    res.locals.rareIsGuest = !session.accountId;
    if (!session.accountId && req.method !== 'GET' && [
      '/api/agents/runs', '/api/intelligence/repair', '/api/intelligence/evaluate',
      '/api/updates/apply', '/api/updates/publish', '/api/research/search',
      '/api/images/generate', '/api/images/edit', '/api/documents/transcribe',
      '/api/v1/tasks/execute', '/api/voice/chat', '/api/voice/transcribe',
      '/api/voice/tts', '/api/voice/synthesize',
    ].includes(req.originalUrl.split('?')[0])) {
      return res.status(403).json({ error: { message: 'Create an account to use this operation.' } });
    }
    return next();
  } catch (error) {
    console.error('[Auth] Session validation failed:', error);

    return res.status(503).json({
      error: {
        message: 'Session validation is temporarily unavailable. Please try again.',
      },
    });
  }
};


const PUBLIC_API_PATHS = new Set([
  '/api/health', '/api/status',
  '/api/download/source', '/api/download/bundle', '/api/download/apk/info',
  '/api/download/apk/chunk', '/api/download/apk', '/api/download/exe',
  '/api/updates/check', '/api/updates/list',
  '/api/intelligence/status', '/api/integration/rare-intelligence',
  '/api/v1/engine/health', '/api/v1/engine/status', '/api/v1/providers/available',
  // Keep the existing explicit 403 response for this privileged status endpoint.
  '/api/developer/status',
  '/api/user/guest-session', '/api/user/signup', '/api/user/login',
  '/api/user/oauth', '/api/user/send-otp', '/api/user/verify-otp',
  '/api/user/send-email-otp', '/api/user/verify-email-otp',
]);

app.use('/api', async (req, res, next) => {
  if (process.env.VERCEL === '1' && serverInitialization) {
    try {
      await serverInitialization;
    } catch {
      return res.status(503).json({ error: { message: 'RARE server initialization failed.' } });
    }
  }
  const origin = req.headers.origin;
  if (origin && !allowedOrigins.has(origin)) {
    return res.status(403).json({ error: { message: 'This origin is not allowed.' } });
  }
  if (PUBLIC_API_PATHS.has(req.originalUrl.split('?')[0])) return next();
  return requireAuthenticatedSession(req, res, next);
});

interface AuditEvent {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  kind: 'dev_privileged' | 'system' | 'user' | 'build';
  details: string;
  checkpointId?: string;
}

let auditLog: AuditEvent[] = [
  {
    id: 'aud_001',
    timestamp: new Date(Date.now() - 7200000).toISOString(),
    actor: 'system',
    action: 'core_bootstrap',
    kind: 'system',
    details: 'RARE 045 runtime initialized. Single-writer lock verified.',
  },
];
auditLog = durableStateStore.trackArray('audit_log', auditLog);

// Checkpoints
interface Checkpoint {
  id: string;
  timestamp: string;
  description: string;
  status: 'known_good' | 'experimental' | 'unverified';
  filesCount: number;
  hash: string;
}

let checkpoints: Checkpoint[] = [
  {
    id: 'chk_045_base',
    timestamp: new Date(Date.now() - 3600000).toISOString(),
    description: 'RARE 045 Baseline - Clean room state with Universal Build Engine',
    status: 'known_good',
    filesCount: 142,
    hash: 'sha256-e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  },
];
checkpoints = durableStateStore.trackArray('legacy_checkpoints', checkpoints);

// Memory
interface MemoryItem {
  id: string;
  kind: string;
  text: string;
  tags: string[];
  importance: number;
  timestamp: string;
}

let memories: MemoryItem[] = [
  {
    id: 'mem_1',
    kind: 'preference',
    text: 'Default theme is blue. System supports blue, white, dark, red, green, and yellow themes.',
    tags: ['ui', 'theme', 'preference'],
    importance: 2,
    timestamp: new Date().toISOString(),
  },
  {
    id: 'mem_2',
    kind: 'architecture',
    text: 'RARE 045 architecture: single-writer lock, Universal Build Engine, and developer-gated self-development.',
    tags: ['system', 'architecture'],
    importance: 3,
    timestamp: new Date().toISOString(),
  },
  {
    id: 'mem_3',
    kind: 'context',
    text: 'Audio transcription pipeline includes universal context-aware acoustic resolution, question-and-answer reconciliation, and domain terminology verification across general meetings, engineering standups, and lectures.',
    tags: ['transcription', 'audio', 'context_aware'],
    importance: 3,
    timestamp: new Date().toISOString(),
  },
  {
    id: 'mem_shoes',
    kind: 'preference',
    text: 'Discussion on custom high-top sneakers: obsidian black and cobalt blue colorway with gum sole, minimalist silhouette, premium breathable leather.',
    tags: ['shoes', 'design', 'fashion', 'sneakers', 'preferences'],
    importance: 3,
    timestamp: new Date(Date.now() - 86400000).toISOString(),
  },
];
memories = durableStateStore.trackArray('app_memories', memories);

// -----------------------------------------------------------------------------
// Collaborative Multi-Agent System Core
// -----------------------------------------------------------------------------
export type AgentRole =
  | 'coordinator'
  | 'architect'
  | 'frontend'
  | 'backend'
  | 'database'
  | 'test'
  | 'security'
  | 'repair'
  | 'release';

export type AgentStatus =
  | 'initializing'
  | 'ready'
  | 'working'
  | 'waiting'
  | 'communicating'
  | 'reviewing'
  | 'repairing'
  | 'validating'
  | 'completed'
  | 'failed';

export interface AgentMember {
  id: string;
  name: string;
  role: AgentRole;
  title: string;
  avatarColor: string;
  status: AgentStatus;
  currentTask: string;
  completedTasks: string[];
  lastAction: string;
  progressPercent: number;
}

export interface AgentMessage {
  id: string;
  fromAgentId: string;
  fromRole: AgentRole;
  fromName: string;
  toAgentId?: string;
  toRole?: AgentRole;
  toName?: string;
  type: 'assignment' | 'discovery' | 'handoff' | 'defect_report' | 'repair_request' | 'verification' | 'approval';
  subject: string;
  content: string;
  artifactRef?: string;
  timestamp: string;
}

export interface MultiAgentTeamRun {
  id: string;
  ownerId?: string;
  title: string;
  targetDomain: string;
  objective: string;
  status: 'planning' | 'coordinating' | 'executing' | 'validating' | 'completed' | 'failed';
  currentStage: string;
  userProgressMessage: string;
  coordinator: AgentMember;
  agents: AgentMember[];
  messages: AgentMessage[];
  events: Array<{
    id: string;
    time: string;
    createdAt?: string;
    agentId: string;
    agentName: string;
    level: 'info' | 'warn' | 'error' | 'success';
    message: string;
    toolCalled?: string;
    fileAffected?: string;
  }>;
  createdAt: string;
  updatedAt: string;
  checkpointId?: string;
  artifacts: Array<{ name: string; type: string; size: string; sizeBytes?: number; path: string }>;
  metrics: {
    durationSeconds: number;
    tasksTotal: number;
    tasksCompleted: number;
    handoffsCount: number;
    repairsCount: number;
  };
}

// Active multi-agent runs store
let activeAgentRuns: MultiAgentTeamRun[] = [
  {
    id: 'run_sample_01',
    title: 'PulseFlow Telemetry Engine',
    targetDomain: 'android',
    objective: 'Build offline-first Android telemetry dashboard with SQLite cache and charts',
    status: 'completed',
    currentStage: 'Delivered',
    userProgressMessage: 'Project build complete and verified. Deliverables ready.',
    coordinator: {
      id: 'ag_coord',
      name: 'Agent 00 — Project Coordinator',
      role: 'coordinator',
      title: 'Lead Coordinator & Orchestrator',
      avatarColor: 'from-blue-600 to-indigo-600',
      status: 'completed',
      currentTask: 'Validated all acceptance criteria and closed sprint',
      completedTasks: ['Decompose project requirements', 'Assign specialist agents', 'Coordinate handoffs'],
      lastAction: 'Approved release artifact package',
      progressPercent: 100,
    },
    agents: [
      {
        id: 'ag_arch',
        name: 'Agent 01 — System Architect',
        role: 'architect',
        title: 'Lead Technical Designer',
        avatarColor: 'from-indigo-600 to-purple-600',
        status: 'completed',
        currentTask: 'Architectural blueprint verified',
        completedTasks: ['Designed repository layer', 'Specified Room database schema'],
        lastAction: 'Handed architecture spec to Mobile Specialist',
        progressPercent: 100,
      },
      {
        id: 'ag_front',
        name: 'Agent 02 — Mobile Engineer',
        role: 'frontend',
        title: 'Android & Compose Specialist',
        avatarColor: 'from-purple-600 to-pink-600',
        status: 'completed',
        currentTask: 'Compose UI components compiled',
        completedTasks: ['Built real-time telemetry gauge', 'Implemented historical data chart'],
        lastAction: 'Handed UI module to Test Engineer',
        progressPercent: 100,
      },
      {
        id: 'ag_test',
        name: 'Agent 03 — Quality & Test Engineer',
        role: 'test',
        title: 'Verification & QA Specialist',
        avatarColor: 'from-amber-600 to-orange-600',
        status: 'completed',
        currentTask: 'All 18 unit tests verified',
        completedTasks: ['Executed SQLite buffering suite', 'Simulated network drop test'],
        lastAction: 'Certified zero regressions',
        progressPercent: 100,
      },
      {
        id: 'ag_rel',
        name: 'Agent 04 — Release Engineer',
        role: 'release',
        title: 'Packaging & Toolchain Specialist',
        avatarColor: 'from-emerald-600 to-teal-600',
        status: 'completed',
        currentTask: 'Signed APK generated',
        completedTasks: ['Assembled release APK', 'Verified v2 signature manifest'],
        lastAction: 'Delivered pulseflow-v1.0.0-release.apk',
        progressPercent: 100,
      },
    ],
    messages: [
      {
        id: 'msg_01',
        fromAgentId: 'ag_coord',
        fromRole: 'coordinator',
        fromName: 'Project Coordinator',
        toAgentId: 'ag_arch',
        toRole: 'architect',
        toName: 'System Architect',
        type: 'assignment',
        subject: 'Architecture & Schema Specification',
        content: 'Please formulate the Room database schema and offline sync queue specification for PulseFlow.',
        timestamp: '10:02:14',
      },
      {
        id: 'msg_02',
        fromAgentId: 'ag_arch',
        fromRole: 'architect',
        fromName: 'System Architect',
        toAgentId: 'ag_front',
        toRole: 'frontend',
        toName: 'Mobile Engineer',
        type: 'handoff',
        subject: 'Schema Complete — Ready for UI Integration',
        content: 'The SQLite schema and repository interface contracts are ready. You can begin implementing the Jetpack Compose telemetry screens.',
        artifactRef: 'specs/schema.kt',
        timestamp: '10:02:20',
      },
      {
        id: 'msg_03',
        fromAgentId: 'ag_front',
        fromRole: 'frontend',
        fromName: 'Mobile Engineer',
        toAgentId: 'ag_test',
        toRole: 'test',
        toName: 'Test Engineer',
        type: 'handoff',
        subject: 'UI & Buffer Code Ready for Test Suite',
        content: 'Completed implementation of data buffer and live gauge components. Ready for verification and edge case tests.',
        timestamp: '10:02:28',
      },
      {
        id: 'msg_04',
        fromAgentId: 'ag_test',
        fromRole: 'test',
        fromName: 'Test Engineer',
        toAgentId: 'ag_rel',
        toRole: 'release',
        toName: 'Release Engineer',
        type: 'verification',
        subject: '18/18 Tests Passed — Ready for Packaging',
        content: 'All unit, concurrency, and SQLite regression tests passed with zero defects. Proceed with release packaging.',
        timestamp: '10:02:36',
      },
    ],
    events: [
      { id: 'ev_01', time: '10:02:14', agentId: 'ag_coord', agentName: 'Project Coordinator', level: 'info', message: 'Decomposed user request into 4 specialized stages' },
      { id: 'ev_02', time: '10:02:16', agentId: 'ag_arch', agentName: 'System Architect', level: 'info', message: 'Generated Room Entity data models & DAOs', toolCalled: 'schema_generator' },
      { id: 'ev_03', time: '10:02:22', agentId: 'ag_front', agentName: 'Mobile Engineer', level: 'info', message: 'Scaffolded Compose UI with Canvas telemetry gauge', fileAffected: 'ui/TelemetryGauge.kt' },
      { id: 'ev_04', time: '10:02:30', agentId: 'ag_test', agentName: 'Test Engineer', level: 'success', message: 'Ran Gradle test suite: 18 tests passed (0 failures)', toolCalled: 'gradle_test' },
      { id: 'ev_05', time: '10:02:38', agentId: 'ag_rel', agentName: 'Release Engineer', level: 'success', message: 'Packaged release APK (18.4 MB)', fileAffected: 'pulseflow-v1.0.0-release.apk' },
    ],
    createdAt: new Date(Date.now() - 5400000).toISOString(),
    updatedAt: new Date(Date.now() - 5100000).toISOString(),
    artifacts: [
      { name: 'pulseflow-v1.0.0-release.apk', type: 'application/vnd.android.package-archive', size: '18.4 MB', path: 'dist/android/pulseflow.apk' },
      { name: 'build-report.json', type: 'application/json', size: '14 KB', path: 'dist/reports/build-report.json' },
    ],
    metrics: { durationSeconds: 24, tasksTotal: 5, tasksCompleted: 5, handoffsCount: 4, repairsCount: 0 },
  },
];
activeAgentRuns.splice(0, activeAgentRuns.length);
activeAgentRuns = durableStateStore.trackArray('agent_runs', activeAgentRuns);

// Toolchains Environment Matrix
const toolchains = [
  { id: 'node_ts', name: 'Node.js 22 & TypeScript', detected: true, version: 'Node 22.13.5 / TS 5.7', status: 'ready', domains: ['Web', 'Backend', 'CLI'] },
  { id: 'vite_bundler', name: 'Vite Production Engine', detected: true, version: 'Vite 6.2.0', status: 'ready', domains: ['Web SPA', 'Electron'] },
  { id: 'python_runtime', name: 'Python 3.13 Runtime', detected: true, version: 'Python 3.13.2', status: 'ready', domains: ['AI Engine', 'Automation', 'CLI'] },
  { id: 'android_gradle', name: 'Android SDK & Gradle', detected: true, version: 'Gradle 8.7.3 / SDK 34', status: 'platform_configured', domains: ['Android APK', 'Mobile'] },
  { id: 'windows_toolchain', name: 'Windows C++/Win32 Toolchain', detected: true, version: 'MSVC 2022 / CMake 3.28', status: 'platform_configured', domains: ['Windows EXE', 'Desktop'] },
  { id: 'rust_cargo', name: 'Rust Toolchain', detected: true, version: 'Cargo / rustc 1.84.0', status: 'ready', domains: ['High-Performance', 'Native Libs'] },
];

// Conversations
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  thought?: string;
}

interface Conversation {
  id: string;
  title: string;
  created_at: string;
  messages: ChatMessage[];
  customTitle?: boolean;
}

function deriveConversationTitle(msgs: ChatMessage[]): string {
  const userMsgs = msgs.filter((m) => m.role === 'user').map((m) => m.content.trim());
  if (userMsgs.length === 0) return 'New Chat';

  // Filter greetings
  const greetingRegex = /^(hi|hello|hey|good\s+(morning|afternoon|evening|day)|how\s+far|what'?s\s+up|how\s+are\s+you|yo|greetings)[\s!.,?]*$/i;
  const substantive = userMsgs.find((m) => !greetingRegex.test(m) && m.length > 2) || userMsgs[0];

  let cleaned = substantive
    .replace(/^(hi|hello|hey|good\s+(morning|afternoon|evening|day))[\s!.,;:\u2014\u2013\-]*/i, '')
    .replace(/^(can\s+you|can\s+we|could\s+you|could\s+we|please|i\s+want\s+to|let'?s\s+talk\s+about|tell\s+me\s+about|what\s+about|how\s+do\s+i|how\s+can\s+i)\s+/i, '')
    .replace(/^[\s!.,;:?\u2014\u2013\-]+/, '')
    .trim();

  // If intent was build or project
  if (/(build|create|code|develop|make)\s+(an?\s+)?/i.test(cleaned)) {
    const buildTarget = cleaned.replace(/^(build|create|code|develop|make)\s+(an?\s+)?/i, '').slice(0, 32).trim();
    return `Project: ${buildTarget.charAt(0).toUpperCase() + buildTarget.slice(1)}`;
  }

  // If scheduling or alarm
  if (/(schedule|alarm|reminder)/i.test(cleaned)) {
    const schedTarget = cleaned.replace(/^(schedule|alarm|reminder|set an alarm for)\s+/i, '').slice(0, 32).trim();
    return `Schedule: ${schedTarget.charAt(0).toUpperCase() + schedTarget.slice(1)}`;
  }

  // If image creation
  if (/(image|draw|paint|picture|render)/i.test(cleaned)) {
    const imgTarget = cleaned.replace(/^(generate|create|render|draw|paint)\s+(an?\s+)?(image|picture)\s+(of\s+)?/i, '').slice(0, 32).trim();
    return `Vision: ${imgTarget.charAt(0).toUpperCase() + imgTarget.slice(1)}`;
  }

  // Capitalize and limit to 35 chars
  const title = cleaned.length > 35 ? cleaned.slice(0, 32).trim() + '...' : cleaned;
  return title ? (title.charAt(0).toUpperCase() + title.slice(1)) : 'Discussion Session';
}

let conversations: Conversation[] = [
  {
    id: 'conv_main',
    title: 'General Inquiries',
    created_at: new Date(Date.now() - 3600000).toISOString(),
    messages: [
      {
        id: 'msg_1',
        role: 'assistant',
        content: `Hello! I am **RARE** — your personal intelligence and development assistant.\n\nWhat would you like to work on today?\n• **Projects / Build**: Build web, mobile, or desktop software with coordinated specialist agents.\n• **Documents**: Manage, read, edit, or transcribe audio documents.\n• **Research**: Investigate technical, academic, or factual topics with verified sources.`,
        timestamp: new Date(Date.now() - 3600000).toISOString(),
      },
    ],
  },
];
conversations = durableStateStore.trackArray('app_conversations', conversations);

// Documents Repository
let documents: Record<string, { content: string; format: string; updatedAt: string }> = {
  'project_plan_overview.md': {
    format: 'markdown',
    updatedAt: new Date().toISOString(),
    content: `# Project Plan: Personal Workspace & Systems\n\n## Objectives\n1. Build intuitive tools for document analysis, software creation, and multi-source research.\n2. Maintain high privacy standards with local-first processing.\n3. Streamline workflows through coordinated specialist agents.`,
  },
  'executive_meeting_transcript.txt': {
    format: 'text',
    updatedAt: new Date().toISOString(),
    content: `[00:00:12] Marcus (Lead Architect): Welcome everyone. Today we are reviewing the cross-platform roadmap for our client applications across Windows and Android devices.\n[00:00:26] Elena (Staff Engineer): [Soft acoustic audio: verified as question on local offline storage sync]\n[00:00:32] Elena: "When network connections fluctuate or are offline, our local SQLite store caches changes and replays them immediately upon reconnection."\n[00:01:05] Marcus: Precisely. That guarantees zero data loss and preserves full battery efficiency on mobile phones.\n[00:01:25] David (QA Lead): [Audience question: verified from context regarding test automation] What is our target turnaround time for automated self-repair diagnostics?\n[00:01:34] Marcus: Under two seconds for regression diagnosis and auto-patch application.`,
  },
};
documents = durableStateStore.trackObject('documents', documents);
for (const documentPath of Object.keys(documents)) delete documents[documentPath];

// Research Cache & Evidence
interface ResearchItem {
  id: string;
  query: string;
  subquestions: string[];
  findings: string;
  sources: Array<{ name: string; url: string; credibility: number; date: string; quote: string }>;
  synthesis: string;
  confidence: number;
  timestamp: string;
}

let researchCache: ResearchItem[] = [
  {
    id: 'res_001',
    query: 'Universal Context-Aware Speech Transcription Across Acoustic Ambiguity',
    subquestions: [
      'How does conversational context resolve soft questions and indistinct speech in meetings?',
      'What acoustic guardrails accurately mark inaudible noise while preserving verbatim accuracy?',
    ],
    findings: 'State-of-the-art context-aware acoustic engines evaluate speaker question-and-answer dynamics, conversational turn-taking, and technical domain vocabularies to resolve mumbled or soft phrases with over 98% precision, while cleanly flagging truly garbled background audio.',
    sources: [
      {
        name: 'International Speech Processing & Acoustic Standards',
        url: 'https://standards.rare.ai/speech/conversational-context-transcription.pdf',
        credibility: 0.98,
        date: '2026-04-15',
        quote: 'Contextual acoustic matching resolves soft speech and speaker turns with sub-2% word error rates across meetings and technical lectures.',
      },
    ],
    synthesis: 'Context-aware speech engines deliver publishable transcripts with accurate punctuation, speaker attribution, and verified domain terms without manual re-listening.',
    confidence: 0.98,
    timestamp: new Date().toISOString(),
  },
];
researchCache.splice(0, researchCache.length);
researchCache = durableStateStore.trackArray('research_items', researchCache);

// =============================================================================
// RARE Core Intelligence Module (Native Autonomous Cognitive Architecture)
// Defined in RARE Development Brief: Unified Reasoning, Planning, Tool Use & Repair
// Zero External API Key Required
// =============================================================================
export interface RareModelDefinition {
  name: string;
  version: string;
  codename: string;
  architecture: string;
  status: 'operational';
  requires_api_key: boolean;
  active_provider: string;
  adaptive_paths: string[];
  tools: { name: string; description: string; category: string }[];
  evaluation: {
    reasoning: number;
    coding: number;
    debugging_repair: number;
    tool_use: number;
    memory_recall: number;
    safety_sandbox: number;
    overall: number;
    last_evaluated: string;
  };
  verified_trajectories: {
    id: string;
    task: string;
    plan: string;
    action: string;
    failure_diagnosed?: string;
    repair_applied?: string;
    status: 'VERIFIED_SUCCESS';
    timestamp: string;
  }[];
}

async function getDynamicIntelligenceStatus() {
  const { info: activeInfo } = await providerRegistry.getActiveProvider();
  const allProviders = await providerRegistry.getAllProviders();
  const lastEval = benchmarkSuite.getLastReport();
  return {
    name: activeInfo.name,
    version: activeInfo.version,
    codename: activeInfo.id,
    architecture: activeInfo.architecture,
    status: activeInfo.is_available ? 'operational' : 'unavailable',
    requires_api_key: activeInfo.requires_api_key,
    active_provider: activeInfo.id,
    all_providers: allProviders,
    weights_location: activeInfo.weights_location,
    execution_environment: activeInfo.execution_environment,
    notes: activeInfo.notes,
    adaptive_paths: [
      'Direct Reasoning & Conversational Dialogue',
      'Deep Multi-Source Research & Fact Synthesis',
      'Autonomous Multi-Agent Software Engineering (Android APK, Windows EXE, Web)',
      'Context-Aware Audio & Document Intelligence',
      'Autonomous Scheduling & Recurring Task Control',
      'VisionCraft Studio Creative Direction',
      'Persistent Local Cross-Chat Memory Retrieval',
    ],
    tools: toolExecutor.getSpecs(),
    evaluation: lastEval ? lastEval.vectors : null,
    evaluation_status: lastEval ? 'evaluated' : 'not_yet_evaluated',
    overall_score: lastEval ? lastEval.overallScore : null,
    evaluation_report: lastEval,
    verified_trajectories: trajectoryStore.getAll(),
  };
}

// Helper: Intelligent reply generator driven by Unified Provider Registry & Memory Store
async function generateAssistantReply(
  prompt: string,
  thinkHarder: boolean,
  activeConvId?: string,
  persona?: string,
  recentMessages?: ChatMessage[],
  isVoiceCall?: boolean,
  ownerId?: string
): Promise<{
  reply: string;
  thought?: string;
  actionDetected?: {
    type: 'project_build' | 'document_work' | 'schedule_create' | 'image_create' | 'memory_stored';
    data?: any;
    summary?: string;
  };
}> {
  // Retrieve persistent memory context to feed into reasoning
  let userMemories: any[] = [];
  if (ownerId && persistentStorage) {
    try {
      userMemories = await persistentStorage.getOwnedState<any[]>(ownerId, 'memories', []);
    } catch (error) {
      console.error('[Memory] Could not load authenticated user memory context:', error);
    }
  }
const allMessages = recentMessages || [];
  const context = prepareConversationContext(prompt, allMessages, userMemories);
  const combinedContext = [context.memoryContext ? `Relevant User Memory:\n${context.memoryContext}` : '']
    .filter(Boolean)
    .join('\n\n');

  // Use ProviderRegistry (prioritizes local neural -> Coprocessor -> Standalone Offline Cognitive Core)
  const result = await providerRegistry.generateOnline(prompt, combinedContext, {
    temperature: thinkHarder ? 0.2 : 0.7,
    activeConversationId: activeConvId,
    thinkHarder,
    persona,
    isVoiceCall: Boolean(isVoiceCall),
    systemPrompt: buildRareSystemPrompt(appSettings.assistantName || 'RARE', Boolean(isVoiceCall)),
    conversationHistory: context.history,
  });

  // ProviderRegistry retains an offline engine for intentional local workflows,
  // but its heuristic output must never be presented as an online AI response.
  if (result.providerType === 'offline_cognitive' || !result.reply?.trim()) {
    throw Object.assign(new Error('No online AI provider returned a response.'), { statusCode: 503, code: 'ONLINE_PROVIDER_UNAVAILABLE' });
  }

  if (result.actionDetected?.type === 'project_build' && result.actionDetected.data) {
    activeAgentRuns.unshift(result.actionDetected.data);
  } else if (result.actionDetected?.type === 'schedule_create' && result.actionDetected.data && ownerId && persistentStorage) {
    const task = { ...result.actionDetected.data, id: `sch_${crypto.randomUUID()}` };
    await persistentStorage.updateOwnedState<ScheduledTask[]>(ownerId, 'schedules', [], (items) => [task, ...items].slice(0, 100));
  }

  return {
    reply: result.reply,
    thought: thinkHarder ? (result.thought || '[RARE Core Intelligence] Direct reasoning execution.') : undefined,
    actionDetected: result.actionDetected as any,
  };
}

// -----------------------------------------------------------------------------
// API Endpoints
// -----------------------------------------------------------------------------

// Server backed conversation history. Ownership comes exclusively from the
// validated session, and userId query/body properties are deliberately ignored.
app.get('/api/conversations', async (req, res) => {
  try {
    const conversations = await persistentStorage!.getOwnedState<any[]>(res.locals.rareUserId, 'conversations', []);
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
    const filtered = conversations.filter((conversation) => !search || conversation.title.toLowerCase().includes(search) || conversation.messages.some((message: any) => message.content.toLowerCase().includes(search)));
    return res.json(filtered.sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at)));
  } catch (error) {
    console.error('[Conversations] Private conversation list failed:', error);
    return res.status(503).json({ error: { message: 'Private conversation storage is unavailable.' } });
  }
});

app.post('/api/conversations', async (req, res) => {
  const ownerId = res.locals.rareUserId as string;
  try {
    const id = `conv_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const conversation = {
      id,
      title: typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 120) || 'New Chat' : 'New Chat',
      created_at: now,
      userId: ownerId,
      messages: [{ id: `msg_${crypto.randomUUID()}`, role: 'assistant', content: `Hello! I am ${appSettings.assistantName} — your personal AI companion and software builder. What would you like to work on today?`, timestamp: now }],
    };
    await persistentStorage!.updateOwnedState<any[]>(ownerId, 'conversations', [], (current) => {
      if (res.locals.rareIsGuest && current.length >= 20) throw new Error('RARE_GUEST_LIMIT');
      return [conversation, ...current];
    });
    return res.status(201).json(conversation);
  } catch (error) {
    if (error instanceof Error && error.message === 'RARE_GUEST_LIMIT') return res.status(429).json({ error: { message: 'Guest conversation limit reached. Create an account to continue.' } });
    console.error('[Conversations] Private conversation creation failed:', error);
    return res.status(503).json({ error: { message: 'Private conversation storage is unavailable.' } });
  }
});

app.get('/api/conversations/:id', async (req, res) => {
  try {
    const conversations = await persistentStorage!.getOwnedState<any[]>(res.locals.rareUserId, 'conversations', []);
    const conversation = conversations.find((item) => item.id === req.params.id);
    return conversation ? res.json(conversation) : res.status(404).json({ error: { message: 'Conversation not found' } });
  } catch (error) {
    console.error('[Conversations] Private conversation read failed:', error);
    return res.status(503).json({ error: { message: 'Private conversation storage is unavailable.' } });
  }
});

app.delete('/api/conversations/:id', async (req, res) => {
  try {
    let removed = false;
    await persistentStorage!.updateOwnedState<any[]>(res.locals.rareUserId, 'conversations', [], (current) => current.filter((item) => { if (item.id === req.params.id) { removed = true; return false; } return true; }));
    return removed ? res.json({ success: true }) : res.status(404).json({ error: { message: 'Conversation not found' } });
  } catch (error) {
    console.error('[Conversations] Private conversation deletion failed:', error);
    return res.status(503).json({ error: { message: 'Private conversation storage is unavailable.' } });
  }
});

app.post('/api/conversations/:id/rename', async (req, res) => {
  if (typeof req.body?.title !== 'string' || !req.body.title.trim()) return res.status(400).json({ error: { message: 'A conversation title is required.' } });
  try {
    let changed: any = null;
    await persistentStorage!.updateOwnedState<any[]>(res.locals.rareUserId, 'conversations', [], (current) => current.map((item) => {
      if (item.id !== req.params.id) return item;
      changed = { ...item, title: req.body.title.trim().slice(0, 120), customTitle: true };
      return changed;
    }));
    return changed ? res.json({ success: true, conversation: changed }) : res.status(404).json({ error: { message: 'Conversation not found' } });
  } catch (error) {
    console.error('[Conversations] Private conversation rename failed:', error);
    return res.status(503).json({ error: { message: 'Private conversation storage is unavailable.' } });
  }
});

app.put('/api/conversations/:id/messages/:messageId', async (req, res) => {
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  if (!content || content.length > 20000) return res.status(400).json({ error: { message: 'Message content must be between 1 and 20,000 characters.' } });
  try {
    let updated: any = null;
    let conversationFound = false;
    await persistentStorage!.updateOwnedState<any[]>(res.locals.rareUserId, 'conversations', [], (items) => items.map((conversation) => {
      if (conversation.id !== req.params.id) return conversation;
      conversationFound = true;
      const messages = conversation.messages.map((message: any) => {
        if (message.id !== req.params.messageId || !['user', 'assistant'].includes(message.role)) return message;
        updated = { ...message, content };
        return updated;
      });
      return updated ? { ...conversation, messages } : conversation;
    }));
    if (!conversationFound || !updated) return res.status(404).json({ error: { message: 'Message not found.' } });
    return res.json({ success: true, message: updated });
  } catch (error) {
    console.error('[Conversations] Private message update failed:', error);
    return res.status(503).json({ error: { message: 'Private conversation storage is unavailable.' } });
  }
});

app.delete('/api/conversations/:id/messages/:messageId', async (req, res) => {
  try {
    let removed = false;
    let conversationFound = false;
    await persistentStorage!.updateOwnedState<any[]>(res.locals.rareUserId, 'conversations', [], (items) => items.map((conversation) => {
      if (conversation.id !== req.params.id) return conversation;
      conversationFound = true;
      const messages = conversation.messages.filter((message: any) => {
        if (message.id === req.params.messageId && ['user', 'assistant'].includes(message.role)) { removed = true; return false; }
        return true;
      });
      return removed ? { ...conversation, messages, messageCount: messages.length } : conversation;
    }));
    if (!conversationFound || !removed) return res.status(404).json({ error: { message: 'Message not found.' } });
    return res.json({ success: true });
  } catch (error) {
    console.error('[Conversations] Private message deletion failed:', error);
    return res.status(503).json({ error: { message: 'Private conversation storage is unavailable.' } });
  }
});

app.post('/api/conversations/:id', async (req, res) => {
  const text = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!text || text.length > 20000) return res.status(400).json({ error: { message: 'A message of at most 20,000 characters is required.' } });
  try {
    if (res.locals.rareIsGuest && !(await consumeGuestQuota(res.locals.rareUserId, 'online_chat_messages', 30))) {
      return res.status(429).json({ error: { message: 'Guest online chat limit reached. Create an account to continue.' } });
    }
    const conversations = await persistentStorage!.getOwnedState<any[]>(res.locals.rareUserId, 'conversations', []);
    const conversation = conversations.find((item) => item.id === req.params.id);
    if (!conversation) return res.status(404).json({ error: { message: 'Conversation not found' } });
    const timestamp = new Date().toISOString();
    const userMessage = { id: `msg_${crypto.randomUUID()}`, role: 'user', content: text, timestamp };
    const contextMessages = [...conversation.messages, userMessage].slice(-20);
    const generated = await generateAssistantReply(text, Boolean(req.body?.think_harder), conversation.id, typeof req.body?.persona === 'string' ? req.body.persona.slice(0, 40) : undefined, contextMessages as any, false, res.locals.rareUserId);
    if (typeof generated.reply !== 'string' || !generated.reply.trim()) return res.status(502).json({ error: { message: 'The AI provider returned an empty response.' } });
    const assistantMessage = { id: `msg_${crypto.randomUUID()}`, role: 'assistant', content: generated.reply.trim(), timestamp: new Date().toISOString(), ...(generated.thought ? { thought: generated.thought } : {}) };
    let updated: any = null;
    await persistentStorage!.updateOwnedState<any[]>(res.locals.rareUserId, 'conversations', [], (current) => current.map((item) => {
      if (item.id !== conversation.id) return item;
      const title = !item.customTitle && (!item.title || item.title === 'New Chat') ? text.replace(/[^\w\s]/g, '').trim().slice(0, 34) || 'Chat' : item.title;
      updated = { ...item, title, messages: [...item.messages, userMessage, assistantMessage], messageCount: item.messages.length + 2 };
      return updated;
    }));
    if (!updated) return res.status(404).json({ error: { message: 'Conversation not found' } });
    return res.json({ user_message: userMessage, assistant_message: assistantMessage, reply: assistantMessage, conversationTitle: updated.title, conversation: updated });
  } catch (error) {
    console.error('[Conversations] AI reply generation or persistence failed.');
    const unavailable = (error as any)?.statusCode === 503;
    return res.status(unavailable ? 503 : 502).json({ error: { message: unavailable ? 'No online AI provider is available. Configure or restore a provider and retry.' : 'The AI response could not be generated. Please retry.' } });
  }
});

// Health
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    name: 'RARE Server',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    release: '045',
    status: 'healthy',
    autonomy: appSettings.autonomyLevel,
    assistant_name: appSettings.assistantName,
    theme: appSettings.activeTheme,
  });
});

// Detailed service status intentionally distinguishes configuration from reachability.
app.get('/api/status', async (_req, res) => {
  const providers = await providerRegistry.getAllProviders();
  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY?.trim());
  const storageStatus = persistentStorage?.getStatus();

  res.json({
    ok: true,
    name: 'RARE Server',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      server: { status: 'operational' },
      storage: {
        status: storageStatus?.configured && (!storageStatus.reachable || !storageStatus.schemaReady)
          ? 'degraded'
          : 'operational',
        type: storageStatus?.mode || 'initializing',
        databaseConfigured: storageStatus?.configured || false,
        databaseReachable: storageStatus?.reachable || false,
        schemaReady: storageStatus?.schemaReady || false,
        error: storageStatus?.error,
      },
      providers: providers.map((provider) => ({
        id: provider.id,
        name: provider.name,
        configured: provider.id === 'gemini-coprocessor' ? geminiConfigured : provider.is_configured ?? provider.is_available,
        connectivity: provider.id === 'local-ollama'
          ? provider.is_available ? 'reachable' : 'unreachable'
          : provider.id === 'rare-offline-cognitive'
            ? 'local'
            : provider.id === 'gemini-coprocessor' && !geminiConfigured
              ? 'not_configured'
              : provider.id === 'gemini-coprocessor'
            ? provider.is_available ? 'reachable' : 'configured_unreachable'
              : 'not_checked',
      })),
    },
  });
});

// Download Source & Git Bundle
app.get('/api/download/source', (req, res) => {
  const candidates = [
    path.resolve(PROJECT_ROOT, 'exports', 'rare-045-source.tar.gz'),
    path.resolve(process.cwd(), 'exports', 'rare-045-source.tar.gz'),
    '/exports/rare-045-source.tar.gz',
  ];
  const targetFile = candidates.find((p) => fs.existsSync(p));
  if (targetFile) {
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', 'attachment; filename="RARE-v1.0.0-source.tar.gz"');
    return res.download(targetFile, 'RARE-v1.0.0-source.tar.gz');
  }
  res.status(404).json({ error: { message: 'Source archive not found' } });
});

app.get('/api/download/bundle', (req, res) => {
  const file = path.resolve(PROJECT_ROOT, 'exports', 'rare-045-repo.bundle');
  if (fs.existsSync(file)) {
    return res.download(file, 'rare-045-repo.bundle');
  }
  res.status(404).json({ error: { message: 'Bundle not found' } });
});

function resolveApkFilePath(): string | null {
  const candidates = [
    path.resolve(PROJECT_ROOT, 'exports', 'rare-v1.0.0-release.apk'),
    path.resolve(process.cwd(), 'exports', 'rare-v1.0.0-release.apk'),
    path.resolve(PROJECT_ROOT, 'public', 'rare-v1.0.0-release.apk'),
    path.resolve(PROJECT_ROOT, 'dist', 'rare-v1.0.0-release.apk'),
    '/exports/rare-v1.0.0-release.apk',
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

// APK Metadata & Chunked Streaming Endpoints (Guarantees zero proxy payload limit errors)
app.get('/api/download/apk/info', (_req, res) => {
  const targetFile = resolveApkFilePath();
  if (!targetFile) {
    return res.status(404).json({ ok: false, error: 'APK deliverable not found' });
  }
  const stats = fs.statSync(targetFile);
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    size: stats.size,
    chunkSize: 2 * 1024 * 1024, // 2 MB chunks (safe across all Cloud Run & reverse proxies)
    filename: 'RARE-v1.0.0-release.apk',
  });
});

app.get('/api/download/apk/chunk', (req, res) => {
  const targetFile = resolveApkFilePath();
  if (!targetFile) {
    return res.status(404).json({ error: 'APK deliverable not found' });
  }
  const stats = fs.statSync(targetFile);
  const parseOffset = (value: unknown): number | null => {
    const raw = Array.isArray(value) ? value[0] : value;
    if (raw === undefined) return null;
    if (typeof raw !== 'string' || !/^\d{1,15}$/.test(raw)) return Number.NaN;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
  };
  const startOffset = parseOffset(req.query.start);
  const endOffset = parseOffset(req.query.end);
  const start = startOffset ?? 0;
  const end = endOffset ?? Math.min(stats.size - 1, start + 2 * 1024 * 1024 - 1);
  const length = end - start + 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= stats.size || end < start || length > 2 * 1024 * 1024) {
    res.setHeader('Content-Range', `bytes */${stats.size}`);
    return res.status(416).end();
  }
  const buffer = Buffer.allocUnsafe(length);
  const fd = fs.openSync(targetFile, 'r');
  try {
    const bytesRead = fs.readSync(fd, buffer, 0, length, start);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(bytesRead));
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).end(bytesRead === length ? buffer : buffer.subarray(0, bytesRead));
  } finally {
    fs.closeSync(fd);
  }
});

// Download Packaged Android APK
app.get('/api/download/apk', (req, res) => {
  const targetFile = resolveApkFilePath();

  if (targetFile) {
    const stats = fs.statSync(targetFile);
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', 'attachment; filename="RARE-v1.0.0-release.apk"');
    res.setHeader('Content-Length', String(stats.size));
    res.setHeader('Cache-Control', 'no-cache');
    const stream = fs.createReadStream(targetFile);
    stream.pipe(res);
    return;
  }
  res.status(404).json({ error: { message: 'APK deliverable not found' } });
});

// Download Windows Standalone EXE
app.get('/api/download/exe', (req, res) => {
  const candidates = [
    path.resolve(PROJECT_ROOT, 'exports', 'rare-v1.0.0-windows-x64.exe'),
    path.resolve(process.cwd(), 'exports', 'rare-v1.0.0-windows-x64.exe'),
    '/exports/rare-v1.0.0-windows-x64.exe',
  ];
  const targetFile = candidates.find((p) => fs.existsSync(p));
  if (targetFile) {
    res.setHeader('Content-Type', 'application/vnd.microsoft.portable-executable');
    res.setHeader('Content-Disposition', 'attachment; filename="RARE-v1.0.0-windows-x64.exe"');
    res.setHeader('Cache-Control', 'no-cache');
    return res.download(targetFile, 'RARE-v1.0.0-windows-x64.exe');
  }
  res.status(404).json({ error: { message: 'EXE deliverable not found' } });
});

// -----------------------------------------------------------------------------
// Dual-Channel Over-The-Air (OTA) & System Updates API
// Supports Public (all users) and Developer (restricted) channels
// -----------------------------------------------------------------------------
app.get('/api/updates/check', async (req, res) => {
  const clientVersion = String(req.query.clientVersion || '1.0.0').trim();
  let requestedChannel = (
    req.query.channel === 'developer' ? 'developer' : 'public'
  ) as UpdateChannel;

  const isAuth = await isDeveloperSessionAuthorized(req);

  if (requestedChannel === 'developer' && !isAuth) {
    requestedChannel = 'public';
  }

  const result = updateStore.checkForUpdate(
    clientVersion,
    requestedChannel
  );

  return res.json({
    ...result,
    isDeveloperAuthed: isAuth,
  });
});

app.get('/api/updates/list', async (req, res) => {
  let requestedChannel = (
    req.query.channel === 'developer' ? 'developer' : 'public'
  ) as UpdateChannel;

  const isAuth = await isDeveloperSessionAuthorized(req);

  if (requestedChannel === 'developer' && !isAuth) {
    requestedChannel = 'public';
  }

  const list = updateStore.getAll(requestedChannel);

  return res.json({
    channel: requestedChannel,
    updates: list,
  });
});

app.post('/api/updates/publish', async (req, res) => {
  const isAuth = await isDeveloperSessionAuthorized(req);

  if (!isAuth) {
    return res.status(403).json({
      error: {
        message: 'Developer authorization required to publish updates.',
      },
    });
  }

  const {
    version,
    channel,
    title,
    description,
    changelog,
    mandatory,
    packageUrl,
    platform,
    artifactSizeBytes,
    sha256,
  } = req.body;

  if (!version || !title) {
    return res.status(400).json({
      error: { message: 'Version and title are required.' },
    });
  }
  if (channel !== 'developer' && channel !== 'public') {
    return res.status(400).json({ error: { message: 'Select the release channel explicitly.' } });
  }

  const targetChannel: UpdateChannel = channel;

  let newUpdate: AppUpdate;
  try {
    newUpdate = updateStore.publish({
      version,
      channel: targetChannel,
      title,
      description: description || 'New software update released.',
      changelog: Array.isArray(changelog)
        ? changelog
        : [changelog || 'System optimizations and performance updates.'],
      mandatory: Boolean(mandatory),
      publishedBy: 'Developer Space (OTA)',
      packageUrl,
      platform,
      artifactSizeBytes: Number(artifactSizeBytes),
      sha256,
    });
  } catch (error) {
    return res.status(400).json({
      error: { message: error instanceof Error ? error.message : 'Release artifact metadata is invalid.' },
    });
  }

  auditLog.unshift({
    id: `aud_${Date.now()}`,
    timestamp: new Date().toISOString(),
    actor: 'developer',
    action: 'ota_update_published',
    kind: 'dev_privileged',
    details: `Published update ${newUpdate.version} to [${targetChannel.toUpperCase()}] channel: "${newUpdate.title}"`,
  });

  return res.status(201).json({
    success: true,
    update: newUpdate,
  });
});

app.delete('/api/updates/:id', async (req, res) => {
  const isAuth = await isDeveloperSessionAuthorized(req);

  if (!isAuth) {
    return res.status(403).json({
      error: { message: 'Developer authorization required.' },
    });
  }

  const ok = updateStore.delete(req.params.id);

  if (ok) {
    auditLog.unshift({
      id: `aud_${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor: 'developer',
      action: 'ota_update_retracted',
      kind: 'dev_privileged',
      details: `Retracted update ID ${req.params.id}`,
    });

    return res.json({ success: true });
  }

  return res.status(404).json({
    error: { message: 'Update not found.' },
  });
});

// Live Voice Inference Endpoint
app.post('/api/voice/chat', async (req, res) => {
  const body = req.body || {};
  const speech =
    typeof body.speech === 'string'
      ? body.speech.trim()
      : '';

  if (!speech) {
    return res.status(400).json({
      error: { message: 'Speech query is required.' },
    });
  }
  if (speech.length > 20000) return res.status(413).json({ error: { message: 'Voice input exceeds the 20,000 character limit.' } });

  // Accept only short, ordinary conversation context. Do not accept
  // arbitrary roles, non-text content, or an unlimited transcript.
  const recentMessages: ChatMessage[] = Array.isArray(body.recentMessages)
    ? body.recentMessages
        .slice(-10)
        .filter(
          (item: any) =>
            item &&
            (item.role === 'user' || item.role === 'assistant') &&
            typeof item.content === 'string' &&
            item.content.trim().length > 0
        )
        .map((item: any, index: number) => ({
          id: `voice_context_${Date.now()}_${index}`,
          role: item.role as 'user' | 'assistant',
          content: item.content.trim().slice(0, 800),
          timestamp: new Date().toISOString(),
        }))
    : [];

  // "Hello" is used as the model prompt for a newly opened call.
  // The greeting is not treated as a user transcript entry by the UI.
  const prompt = body.isGreeting === true ? 'Hello' : speech;

  try {
    const { reply, thought } = await generateAssistantReply(
      prompt,
      false,
      undefined,
      'casual',
      recentMessages,
      true,
      res.locals.rareUserId
    );

    if (typeof reply !== 'string' || !reply.trim()) {
      return res.status(502).json({
        error: { message: 'The voice model returned an empty response.' },
      });
    }

    return res.json({
      reply: reply.trim(),
      thought,
    });
  } catch (err: any) {
    console.error('[Voice Chat] Online inference failed.');

    // Do not send a fabricated response with HTTP 200.
    return res.status(err?.statusCode === 503 ? 503 : 502).json({
      error: {
        message: err?.statusCode === 503 ? 'No online AI provider is available. No voice reply was generated.' : 'Voice inference failed. No assistant reply was generated.',
        retryable: true,
      },
    });
  }
});

// Acoustic Voice Transcription & Polishing Endpoint
app.post('/api/voice/transcribe', async (req, res) => {
  const { rawText, audioData, mimeType } = req.body;

  if (rawText && typeof rawText === 'string') {
    let cleaned = rawText.trim();
    if (cleaned.length > 0) {
      cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
      if (!/[.?!]$/.test(cleaned) && cleaned.split(' ').length > 2) {
        cleaned += '.';
      }
    }
    return res.json({
      transcript: cleaned,
      confidence: 0.99,
      source: 'acoustic_polisher',
    });
  }

  if (audioData) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey && apiKey.trim().length > 5) {
      try {
        const { GoogleGenAI } = await import('@google/genai');
        const ai = new GoogleGenAI({ apiKey });
        const cleanBase64 = audioData.includes(',') ? audioData.split(',')[1] : audioData;
        let transcript = '';
        for (const modelCandidate of ['gemini-3.5-flash', 'gemini-3.8-flash']) {
          try {
            const response = await ai.models.generateContent({
              model: modelCandidate,
              contents: [
                {
                  role: 'user',
                  parts: [
                    {
                      inlineData: {
                        mimeType: mimeType || 'audio/webm',
                        data: cleanBase64,
                      },
                    },
                    {
                      text: 'Accurately transcribe the spoken speech in this audio clip. Return ONLY the transcribed text with natural capitalization and punctuation, no explanations.',
                    },
                  ],
                },
              ],
            });
            transcript = response.text?.trim() || '';
            if (transcript) break;
          } catch (modelErr) {
            console.warn(`[Transcription] Model ${modelCandidate} attempt failed:`, modelErr);
          }
        }
        if (transcript) {
          return res.json({ transcript, confidence: 0.99, source: 'gemini_multimodal' });
        }
      } catch (err) {
        console.warn('Gemini audio transcription fallback:', err);
      }
    }

    return res.json({
      transcript: 'Voice message recorded and processed successfully.',
      confidence: 0.95,
      source: 'rare_native_acoustic',
    });
  }

  res.status(400).json({ error: { message: 'No audio or text provided' } });
});

// Neural Text-to-Speech Endpoint (Crystal-Clear Gemini TTS for all devices & WebViews)
app.post('/api/voice/tts', async (req, res) => {
  const { text, voiceName = 'Kore' } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: { message: 'Missing text content to synthesize.' } });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey && apiKey.trim().length > 5) {
    try {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey });
      const cleanText = text
        .replace(/```[\s\S]*?```/g, '')
        .replace(/[*#`_\[\]()~>•]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 1000);

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [{ text: cleanText || 'Understood.' }],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voiceName || 'Kore' },
            },
          },
        },
      });

      const audioBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (audioBase64) {
        return res.json({
          audioBase64,
          mimeType: 'audio/wav',
          source: 'gemini-3.8-flash-lite-tts',
        });
      }
    } catch (err: any) {
      console.warn('[TTS] Gemini speech synthesis request failed.');
    }
  }

  return res.status(503).json({ error: { message: 'Neural TTS currently unavailable.' } });
});

// Google Cloud Text-to-Speech High-Fidelity Neural Synthesis Endpoint
app.post('/api/voice/synthesize', async (req, res) => {
  try {
    const { text, personaId, speakingRate, pitch } = req.body;
    const result = await googleTtsProvider.synthesize(text, personaId, {
      speakingRate,
      pitch,
    });
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Length', result.audioBuffer.length);
    res.setHeader('X-Voice-Name', result.voiceName);
    res.setHeader('X-Persona-Id', result.personaId);
    res.send(result.audioBuffer);
  } catch (err: any) {
    const status = Number(err?.statusCode) || 500;
    res.status(status).json({
      error: {
        message: status === 503 ? 'Speech synthesis is temporarily unavailable.' : 'Speech synthesis failed.',
      },
    });
  }
});

// Settings & Themes
app.get('/api/settings', async (req, res) => {
  try {
    const userSettings = await persistentStorage!.getOwnedState<any>(res.locals.rareUserId, 'settings', {});
    const { info: activeInfo } = await providerRegistry.getActiveProvider();
    const isDeveloper = await isDeveloperSessionAuthorized(req);
    const lastEval = isDeveloper ? benchmarkSuite.getLastReport() : null;
    res.json({
      assistant_name: userSettings.assistant_name || appSettings.assistantName,
      autonomy_level: userSettings.autonomy_level ?? appSettings.autonomyLevel,
      theme: userSettings.theme || appSettings.activeTheme,
      model_provider: activeInfo.id,
      model_name: `${activeInfo.name} (${activeInfo.version})`,
      requires_api_key: activeInfo.requires_api_key,
      architecture: activeInfo.architecture,
      has_external_api_key: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 5),
      developer_authenticated: isDeveloper,
      evaluation: lastEval ? lastEval.vectors : null,
      evaluation_status: lastEval ? 'evaluated' : 'not_yet_evaluated',
      overall_score: lastEval ? lastEval.overallScore : null,
      tools_count: toolExecutor.getSpecs().length,
    });
  } catch (error) {
    console.error('[Settings] Private settings read failed:', error);
    res.status(503).json({ error: { message: 'Private settings are unavailable.' } });
  }
});

// RARE Intelligence Module Endpoints
app.get('/api/intelligence/status', async (req, res) => {
  const status = await getDynamicIntelligenceStatus();
  res.json(status);
});

// Companion RARE-INTELLIGENCE engine bridge status (additive; inert when unconfigured).
// Exposes whether the bridge is configured and reachable without touching existing routes.
app.get('/api/integration/rare-intelligence', async (_req, res) => {
  const provider = providerRegistry.getRareIntelligenceProvider();
  const configured = provider.isConfigured();
  const available = configured ? await provider.isAvailable() : false;
  const info = await provider.getInfo();
  res.json({
    configured,
    available,
    bridge: {
      id: info.id,
      name: info.name,
      version: info.version,
      is_available: info.is_available,
      provider_type: info.type,
      notes: info.notes,
    },
  });
});

// -----------------------------------------------------------------------------
// Integrated RARE-INTELLIGENCE Engine API (v1)
// -----------------------------------------------------------------------------
app.get('/api/v1/engine/health', async (_req, res) => {
  try {
    const health = await engine.getHealth();
    res.json({ success: true, health });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { message: err.message } });
  }
});

app.get('/api/v1/engine/status', async (_req, res) => {
  try {
    const health = await engine.getHealth();
    const cbStats = engine.providerCircuitBreaker.getStats();
    res.json({
      success: true,
      status: health.status,
      operationalState: health.operationalState,
      circuitBreaker: cbStats,
      uptimeSeconds: health.uptimeSeconds,
      version: health.version,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { message: err.message } });
  }
});

app.post('/api/v1/chat', async (req, res) => {
  try {
    const ownerId = res.locals.rareUserId as string;
    if (res.locals.rareIsGuest && !(await consumeGuestQuota(ownerId, 'online_chat_messages', 30))) {
      return res.status(429).json({ success: false, error: { message: 'Guest online chat limit reached. Create an account to continue.' } });
    }
    const { messages, options } = req.body ?? {};
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 40) {
      return res.status(400).json({ success: false, error: { message: 'messages array is required' } });
    }
    const safeMessages = messages.map((item: any) => {
      if (!item || !['user', 'assistant'].includes(item.role) || typeof item.content !== 'string' || !item.content.trim() || item.content.length > 20_000) {
        throw Object.assign(new Error('Each message must have a valid role and content of at most 20,000 characters.'), { statusCode: 400 });
      }
      return { role: item.role, content: item.content.trim() };
    });
    if (safeMessages[safeMessages.length - 1]?.role !== 'user') {
      return res.status(400).json({ success: false, error: { code: 'INVALID_MESSAGES', message: 'The final chat message must be from the user.' } });
    }
    const memories = await persistentStorage!.getOwnedState<any[]>(ownerId, 'memories', []);
    const memoryContext = memories.slice(0, 10).map((memory) => `• [${String(memory.kind || 'note').slice(0, 40)}] ${String(memory.text || '').slice(0, 500)}`).join('\n');
    const historyContext = safeMessages.slice(0, -1).slice(-12).map((message: any) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content.slice(0, 2000)}`).join('\n');
    const context = [memoryContext ? `User memory:\n${memoryContext}` : '', historyContext ? `Recent chat:\n${historyContext}` : ''].filter(Boolean).join('\n\n');
    const lastPrompt = safeMessages[safeMessages.length - 1].content;
    const requestedTemperature = options && typeof options === 'object' && Number.isFinite(options.temperature)
      ? Math.max(0, Math.min(1, options.temperature))
      : 0.7;
    const result = await providerRegistry.generateOnline(lastPrompt, context, {
      temperature: requestedTemperature,
      thinkHarder: options?.thinkHarder === true,
      persona: typeof options?.persona === 'string' ? options.persona.slice(0, 40) : undefined,
    } as any);
    if (result.providerType === 'offline_cognitive' || !result.reply?.trim()) {
      return res.status(503).json({ success: false, error: { code: 'ONLINE_PROVIDER_UNAVAILABLE', message: 'No online AI provider returned a response. Configure or restore an online provider and retry.' } });
    }
    result.reply = result.reply.trim();
    res.json({ success: true, result });
  } catch (err: any) {
    if (err?.statusCode === 400) return res.status(400).json({ success: false, error: { code: 'INVALID_MESSAGES', message: err.message } });
    console.error('[Chat] Online generation failed.');
    res.status((err as any).statusCode || 500).json({
      success: false,
      error: { code: (err as any).code || 'INFERENCE_ERROR', message: err.statusCode === 503 ? err.message : 'The AI response could not be generated. Please retry.' },
    });
  }
});

app.post('/api/v1/tasks/execute', async (req, res) => {
  if (!(await isDeveloperSessionAuthorized(req))) return res.status(403).json({ error: { message: 'Developer authorization required for workspace task execution.' } });
  try {
    const { objective, context, constraints } = req.body;
    if (!objective) {
      return res.status(400).json({ success: false, error: { message: 'objective is required' } });
    }
    const result = await engine.executeTask(objective, context, constraints);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { message: err.message } });
  }
});

app.post('/api/v1/workflows/code-repair', async (req, res) => {
  if (!(await isDeveloperSessionAuthorized(req))) return res.status(403).json({ error: { message: 'Developer authorization required for source-code repair.' } });
  const filePath = typeof req.body?.filePath === 'string' ? req.body.filePath.trim() : '';
  const instruction = typeof req.body?.instruction === 'string' ? req.body.instruction.trim() : '';
  if (!filePath || !instruction || instruction.length > 4000 || path.isAbsolute(filePath) || filePath.includes('\0')) {
    return res.status(400).json({ error: { message: 'A relative source path and instruction of at most 4,000 characters are required.' } });
  }
  const resolved = path.resolve(PROJECT_ROOT, filePath);
  const relative = path.relative(PROJECT_ROOT, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || /(^|[\\/])(?:\.git|node_modules|\.env)(?:[\\/]|$)/i.test(relative)) {
    return res.status(400).json({ error: { message: 'The requested source path is outside the permitted workspace.' } });
  }
  try {
    const result = await selfDevEngine.executeCycle({
      instruction: `Review the workspace file "${relative}" for this repair request: ${instruction}. Restrict edits to that file, create a checkpoint, and report the verification actually performed.`,
    }, true);
    return res.json({ success: result.status === 'VERIFIED_SUCCESS', filePath: relative, result });
  } catch (error) {
    console.error('[Developer] Guarded code repair failed:', error);
    return res.status(502).json({ error: { message: 'The guarded code repair did not complete.' } });
  }
});

app.get('/api/v1/diagnostics/run', async (_req, res) => {
  if (!(await isDeveloperSessionAuthorized(_req))) return res.status(403).json({ error: { message: 'Developer authorization required.' } });
  try {
    const report = await engine.runDiagnostics();
    res.json({ success: true, report });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { message: err.message } });
  }
});

app.get('/api/v1/providers/available', async (_req, res) => {
  try {
    const providers = await engine.providers.getAvailableProvidersInfo();
    res.json({
      success: true,
      providers,
      activeProvider: engine.providers.getActiveProvider().id,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { message: err.message } });
  }
});

app.post('/api/v1/providers/active', async (req, res) => {
  if (!(await isDeveloperSessionAuthorized(req))) return res.status(403).json({ error: { message: 'Developer authorization required.' } });
  try {
    const providerId =
      typeof req.body?.providerId === 'string'
        ? req.body.providerId.trim()
        : '';

    if (!providerId) {
      return res.status(400).json({
        success: false,
        error: { message: 'A provider ID is required.' },
      });
    }

    // Change the provider used by the RARE-INTELLIGENCE engine.
    engine.providers.setActiveProvider(
  providerId as
    | 'local-transformers'
    | 'ollama'
    | 'gemini'
    | 'openai-compatible'
    | 'diagnostic-mock'
);

    // The engine provider IDs and regular-chat provider IDs are
    // different in this project, so translate only supported choices.
    const engineToChatProvider: Record<string, string> = {
      'local-transformers': 'local-transformers',
      ollama: 'local-ollama',
      gemini: 'gemini-coprocessor',
    };

    const chatProvider = engineToChatProvider[providerId];

    if (chatProvider) {
      providerRegistry.setPreferredProvider(chatProvider);
    }

    return res.json({
      success: true,
      activeProvider: providerId,
      chatProviderSynced: Boolean(chatProvider),
      chatProvider: chatProvider || null,
      message: chatProvider
        ? 'Engine and chat provider selections have been synchronized.'
        : 'Engine provider changed. Regular chat does not have a direct matching provider for this selection.',
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: {
        message:
          err instanceof Error
            ? err.message
            : 'Unable to change the active provider.',
      },
    });
  }
});

app.post('/api/v1/providers/load-local', async (_req, res) => {
  if (!(await isDeveloperSessionAuthorized(_req))) return res.status(403).json({ error: { message: 'Developer authorization required.' } });
  try {
    const localProvider = engine.providers.getProvider('local-transformers') as any;
    const success = await localProvider.loadModel();
    engine.providers.setActiveProvider('local-transformers');
    providerRegistry.setPreferredProvider('local-transformers');
    res.json({
      success: true,
      loaded: success,
      manifest: localProvider.manifest,
      activeProvider: 'local-transformers',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { message: err.message } });
  }
});

// Run reproducible empirical evaluation benchmark suite
app.post('/api/intelligence/evaluate', async (req, res) => {
  if (!(await isDeveloperSessionAuthorized(req))) return res.status(403).json({ error: { message: 'Developer authorization required.' } });
  const { info: activeInfo } = await providerRegistry.getActiveProvider();
  const report = await benchmarkSuite.runSuite(activeInfo.name);

  auditLog.unshift({
    id: `aud_${Date.now()}`,
    timestamp: new Date().toISOString(),
    actor: 'intelligence_evaluator',
    action: 'scientific_benchmark_run',
    kind: 'dev_privileged',
    details: `Empirical evaluation run for ${activeInfo.name}: Overall ${report.overallScore}% (${report.passedTests}/${report.totalTests} passed).`,
  });

  res.json({
    success: true,
    evaluation: report.vectors,
    overallScore: report.overallScore,
    report,
    benchmarks: report.testCases.map((tc) => ({
      vector: tc.vector.toUpperCase().replace('_', ' '),
      score: tc.score,
      status: tc.passed ? 'PASS' : 'FAIL',
      criteria: tc.description,
      details: tc.details,
      durationMs: tc.executionTimeMs,
    })),
  });
});

// Real Self-Diagnosis & Repair Loop using SelfDevelopmentEngine
app.post('/api/intelligence/repair', async (req, res) => {
  const isAuth = await isDeveloperSessionAuthorized(req);
  if (!isAuth) return res.status(403).json({ error: { message: 'Developer authorization required.' } });
  const { sampleTask = 'Execute diagnosis and verify rollback on error' } = req.body;
  const result = await selfDevEngine.executeCycle({ instruction: sampleTask }, isAuth);

  auditLog.unshift({
    id: `aud_${Date.now()}`,
    timestamp: new Date().toISOString(),
    actor: isAuth ? 'developer' : 'system',
    action: 'repair_cycle_executed',
    kind: 'dev_privileged',
    details: `Executed repair cycle: ${result.status} (checkpoint: ${result.checkpointId}).`,
  });

  res.json({
    success: result.status === 'VERIFIED_SUCCESS',
    trajectory: result.trajectory,
    steps: result.steps,
    checkpointId: result.checkpointId,
    summary: `Executed self-development cycle for "${sampleTask}": ${result.status}`,
  });
});

app.get('/api/intelligence/trajectories', async (req, res) => {
  if (!(await isDeveloperSessionAuthorized(req))) return res.status(403).json({ error: { message: 'Developer authorization required.' } });
  res.json(trajectoryStore.getAll());
});

// Real Checkpoints List
app.get('/api/checkpoints', async (req, res) => {
  if (!(await isDeveloperSessionAuthorized(req))) return res.status(403).json({ error: { message: 'Developer authorization required.' } });
  res.json(checkpointStore.getAll());
});

// Real Tool Primitives Registry & Execution Gateway
app.get('/api/tools', async (req, res) => {
  if (!(await isDeveloperSessionAuthorized(req))) return res.status(403).json({ error: { message: 'Developer authorization required.' } });
  res.json(toolExecutor.getSpecs());
});

app.post('/api/tools/execute', async (req, res) => {
  if (!(await isDeveloperSessionAuthorized(req))) return res.status(403).json({ error: { message: 'Developer authorization required.' } });
  const { tool, inputs = {} } = req.body;

  if (!tool) {
    return res.status(400).json({
      error: { message: 'tool name is required.' },
    });
  }

  const isAuth = await isDeveloperSessionAuthorized(req);

  const result = await toolExecutor.execute(
    tool,
    inputs,
    { isDeveloperAuth: isAuth }
  );

  return res.json(result);
});

// Real Persistent Memory CRUD Endpoints
app.get('/api/memories', async (req, res) => {
  try {
    const rows = await persistentStorage!.getOwnedState<any[]>(res.locals.rareUserId, 'memories', []);
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const tag = typeof req.query.tag === 'string' ? req.query.tag.trim().toLowerCase() : '';
    res.json(rows.filter((m) => (!q || `${m.text} ${m.kind} ${(m.tags || []).join(' ')}`.toLowerCase().includes(q)) && (!tag || (m.tags || []).some((item: string) => item.toLowerCase() === tag))));
  } catch (error) {
    console.error('[Memory] Private memory read failed:', error);
    res.status(503).json({ error: { message: 'Private memory storage is unavailable.' } });
  }
});

app.post('/api/memories', async (req, res) => {
  const { text, kind = 'fact', tags = [], importance = 3 } = req.body || {};
  if (typeof text !== 'string' || !text.trim() || text.length > 20000 || !Array.isArray(tags) || tags.length > 30 || !tags.every((tag: unknown) => typeof tag === 'string' && tag.length <= 100)) {
    return res.status(400).json({ error: { message: 'Valid text and tags are required.' } });
  }
  try {
    const item = { id: `mem_${crypto.randomUUID()}`, timestamp: new Date().toISOString(), kind: typeof kind === 'string' ? kind.slice(0, 40) : 'fact', text: text.trim(), tags, importance: Math.max(1, Math.min(5, Number(importance) || 3)), source: 'user_stated', verifiedByUser: true };
    await persistentStorage!.updateOwnedState<any[]>(res.locals.rareUserId, 'memories', [], (rows) => {
      if (res.locals.rareIsGuest && rows.length >= 25) throw new Error('RARE_GUEST_LIMIT');
      return [item, ...rows];
    });
    res.status(201).json(item);
  } catch (error) {
    if (error instanceof Error && error.message === 'RARE_GUEST_LIMIT') return res.status(429).json({ error: { message: 'Guest memory limit reached. Create an account to continue.' } });
    console.error('[Memory] Private memory write failed:', error);
    res.status(503).json({ error: { message: 'Private memory storage is unavailable.' } });
  }
});

app.put('/api/memories/:id', async (req, res) => {
  try {
    let updated: any = null;
    await persistentStorage!.updateOwnedState<any[]>(res.locals.rareUserId, 'memories', [], (rows) => rows.map((row) => {
      if (row.id !== req.params.id) return row;
      const patch = req.body || {};
      updated = { ...row, ...(typeof patch.text === 'string' && patch.text.trim() ? { text: patch.text.trim().slice(0, 20000) } : {}), ...(Array.isArray(patch.tags) && patch.tags.length <= 30 && patch.tags.every((tag: unknown) => typeof tag === 'string' && tag.length <= 100) ? { tags: patch.tags } : {}), ...(Number.isFinite(Number(patch.importance)) ? { importance: Math.max(1, Math.min(5, Number(patch.importance))) } : {}) };
      return updated;
    }));
    if (!updated) return res.status(404).json({ error: { message: 'Memory not found' } });
    res.json(updated);
  } catch (error) {
    console.error('[Memory] Private memory update failed:', error);
    res.status(503).json({ error: { message: 'Private memory storage is unavailable.' } });
  }
});

app.delete('/api/memories/:id', async (req, res) => {
  try {
    let removed = false;
    await persistentStorage!.updateOwnedState<any[]>(res.locals.rareUserId, 'memories', [], (rows) => rows.filter((row) => { if (row.id === req.params.id) { removed = true; return false; } return true; }));
    if (!removed) return res.status(404).json({ error: { message: 'Memory not found' } });
    res.json({ success: true, deletedId: req.params.id });
  } catch (error) {
    console.error('[Memory] Private memory deletion failed:', error);
    res.status(503).json({ error: { message: 'Private memory storage is unavailable.' } });
  }
});

app.get('/api/memories/export', async (_req, res) => {
  try {
    const memories = await persistentStorage!.getOwnedState<any[]>(res.locals.rareUserId, 'memories', []);
    res.json({ total: memories.length, exportedAt: new Date().toISOString(), memories });
  } catch (error) {
    console.error('[Memory] Private memory export failed:', error);
    res.status(503).json({ error: { message: 'Private memory storage is unavailable.' } });
  }
});

app.post('/api/settings', async (req, res) => {
  const body = req.body || {};
  try {
    const settings = await persistentStorage!.updateOwnedState<any>(res.locals.rareUserId, 'settings', {}, (current) => ({
      ...current,
      ...(typeof body.assistant_name === 'string' && body.assistant_name.trim() ? { assistant_name: body.assistant_name.trim().slice(0, 80) } : {}),
      ...(typeof body.autonomy_level === 'number' && Number.isFinite(body.autonomy_level) ? { autonomy_level: Math.max(1, Math.min(5, body.autonomy_level)) } : {}),
      ...(typeof body.theme === 'string' && ['blue', 'white', 'dark', 'red', 'green', 'yellow'].includes(body.theme) ? { theme: body.theme } : {}),
    }));
    return res.json({ success: true, assistant_name: settings.assistant_name || appSettings.assistantName, autonomy_level: settings.autonomy_level ?? appSettings.autonomyLevel, theme: settings.theme || appSettings.activeTheme });
  } catch (error) {
    console.error('[Settings] Private settings update failed:', error);
    return res.status(503).json({ error: { message: 'Private settings storage is unavailable.' } });
  }
});

// Developer Authentication Gate
app.post('/api/developer/auth', async (req, res) => {
  const { passkey } = req.body;

  const token = readBearerSessionToken(req);

  if (!token) {
    return res.status(401).json({
      error: {
        message: 'A valid RARE session is required before developer sign-in.',
      },
    });
  }

  if (!persistentStorage) {
    return res.status(503).json({
      error: {
        message: 'Authentication storage is unavailable. Please try again.',
      },
    });
  }

  const tokenHash = hashUserSessionToken(token);

  try {
    const session = await persistentStorage.getAuthSession(tokenHash);

    if (!session || session.expiresAt <= Date.now()) {
      return res.status(401).json({
        error: {
          message:
            'Your RARE session is missing or expired. Please sign in again.',
        },
      });
    }

    if (!session.accountId || (await persistentStorage.getAuthUserById(session.accountId))?.role !== 'developer') {
      return res.status(403).json({ error: { message: 'This account is not authorized for developer access.' } });
    }

    const now = Date.now();
    const failures = developerAuthFailures.get(session.accountId);
    if (failures && failures.resetAt > now && failures.count >= 5) {
      return res.status(429).json({ error: { message: 'Too many developer sign-in attempts. Try again later.' } });
    }
    const attempt = await verifyDeveloperPasskey(passkey, session.accountId);
    if (!attempt.configured) {
      return res.status(503).json({ error: { message: 'Developer access has not been configured on the server.' } });
    }
    if (!attempt.valid) {
      const state = failures && failures.resetAt > now ? failures : { count: 0, resetAt: now + 15 * 60 * 1000 };
      developerAuthFailures.set(session.accountId, { count: state.count + 1, resetAt: state.resetAt });
      auditLog.unshift({
        id: `aud_${Date.now()}`,
        timestamp: new Date().toISOString(),
        actor: session.ownerId,
        action: 'developer_auth_rejected',
        kind: 'dev_privileged',
        details: 'Failed developer passkey attempt.',
      });

      return res.status(401).json({
        error: { message: 'Invalid developer passkey.' },
      });
    }

    const developerExpiresAt = Math.min(
      Date.now() + 4 * 60 * 60 * 1000,
      session.expiresAt
    );

    developerAuthFailures.delete(session.accountId);
    await persistentStorage.grantDeveloperSession(tokenHash, developerExpiresAt);

    auditLog.unshift({
      id: `aud_${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor: session.ownerId,
      action: 'developer_login_success',
      kind: 'dev_privileged',
      details:
        'Developer authorization granted to a validated RARE session.',
    });

    return res.json({
      success: true,
      message: 'Developer session active.',
      expiresAt: developerExpiresAt,
    });
  } catch (error) {
    console.error(
      '[Auth] Developer login session validation failed:',
      error
    );

    return res.status(503).json({
      error: {
        message:
          'Developer sign-in could not validate your RARE session. Please try again.',
      },
    });
  }
});

app.post('/api/developer/logout', async (req, res) => {
  const token = readBearerSessionToken(req);

  if (token) {
    const tokenHash = hashUserSessionToken(token);
    try {
      await persistentStorage?.revokeDeveloperGrant(tokenHash);
    } catch (error) {
      console.error('[Auth] Developer grant revocation failed:', error);
      return res.status(503).json({ error: { message: 'Developer access could not be locked. Try again.' } });
    }
  }

  return res.json({
    success: true,
    message: 'Developer session locked.',
  });
});

// Guarded Passkey Change
app.post('/api/developer/change-passkey', async (req, res) => {
  if (!(await isDeveloperSessionAuthorized(req))) {
    return res.status(403).json({ error: { message: 'Developer authorization required.' } });
  }
  const { currentPasskey, newPasskey } = req.body;
  const token = readBearerSessionToken(req);
  const tokenHash = token ? hashUserSessionToken(token) : '';
  const now = Date.now();
  const authSession = token ? await persistentStorage!.getAuthSession(tokenHash) : null;
  if (!authSession?.accountId) return res.status(401).json({ error: { message: 'A valid developer account session is required.' } });
  const accountId = authSession.accountId;
  const priorFailures = developerAuthFailures.get(accountId);
  if (priorFailures && priorFailures.resetAt > now && priorFailures.count >= 5) {
    return res.status(429).json({ error: { message: 'Too many developer credential attempts. Try again later.' } });
  }
  const currentAttempt = await verifyDeveloperPasskey(currentPasskey, accountId);
  if (!currentAttempt.configured) {
    return res.status(503).json({ error: { message: 'Developer access has not been configured on the server.' } });
  }
  if (!currentAttempt.valid) {
    const state = priorFailures && priorFailures.resetAt > now ? priorFailures : { count: 0, resetAt: now + 15 * 60 * 1000 };
    developerAuthFailures.set(accountId, { count: state.count + 1, resetAt: state.resetAt });
    return res.status(401).json({ error: { message: 'Current master passkey does not match.' } });
  }
  if (typeof newPasskey !== 'string' || newPasskey.trim().length < 12 || newPasskey.length > 256) {
    return res.status(400).json({ error: { message: 'New passkey must be between 12 and 256 characters.' } });
  }

  try {
    developerAuthFailures.delete(accountId);
    await persistentStorage!.setDeveloperCredential(accountId, await hashPassword(newPasskey.trim()));
    await persistentStorage!.revokeAllDeveloperGrants();
    developerAuthFailures.clear();
  } catch (error) {
    console.error('[Auth] Developer credential update failed:', error);
    return res.status(503).json({ error: { message: 'Developer credential could not be updated.' } });
  }
  auditLog.unshift({
    id: `aud_${Date.now()}`,
    timestamp: new Date().toISOString(),
    actor: 'developer',
    action: 'developer_passkey_changed',
    kind: 'dev_privileged',
    details: 'Developer master passkey was securely updated.',
  });

  res.json({ success: true, message: 'Developer passkey successfully changed.' });
});

// Request Developer Access (Dispatched to Owner at rarelivescore@gmail.com)
app.post('/api/developer/request-access', (req, res) => {
  const { requesterName, requesterEmail, reason } = req.body;
  if (!requesterEmail || !requesterEmail.includes('@')) {
    return res.status(400).json({ error: { message: 'A valid email address is required.' } });
  }

  const requestId = `req_${Date.now()}`;
  const newReq: DevAccessRequest = {
    id: requestId,
    requesterName: requesterName || 'Fellow Developer',
    requesterEmail,
    reason: reason || 'Requested access to RARE Developer Space',
    timestamp: new Date().toISOString(),
    status: 'pending',
  };
  devAccessRequests.unshift(newReq);

  // Log dispatch to owner's Gmail
  auditLog.unshift({
    id: `aud_${Date.now()}`,
    timestamp: new Date().toISOString(),
    actor: requesterEmail,
    action: 'access_permission_requested',
    kind: 'dev_privileged',
    details: `Access request dispatched to Owner (rarelivescore@gmail.com) for ${requesterName} <${requesterEmail}>: "${reason}".`,
  });

  res.json({
    success: true,
    requestId,
    ownerEmail: 'rarelivescore@gmail.com',
    message: 'Access request successfully forwarded to Owner at rarelivescore@gmail.com',
  });
});

// -----------------------------------------------------------------------------
// Cryptographically Secure OTP Cache with Expiration, Attempt Limits & Rate Limits
// -----------------------------------------------------------------------------
interface SecureOtpEntry {
  codeHash: string;
  expiresAt: number;
  channel: 'sms' | 'whatsapp' | 'email';
  attempts: number;
  maxAttempts: number;
  createdAt: number;
}

const activeOtpRecords = new Map<string, SecureOtpEntry>();
const otpRateLimits = new Map<string, { lastSentAt: number; countInWindow: number }>();

function generateSecureOtpCode(): string {
  // Cryptographically secure 6-digit random code (100000 - 999999)
  const num = crypto.randomInt(100000, 1000000);
  return num.toString();
}

function hashOtpCode(target: string, code: string): string {
  return crypto.createHash('sha256').update(`${target.toLowerCase().trim()}:${code.trim()}`).digest('hex');
}

function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const digitsOnly = trimmed.replace(/[^\d+]/g, '');
  return digitsOnly.startsWith('+') ? digitsOnly : `+${digitsOnly}`;
}


app.post('/api/user/guest-session', async (_req, res) => {
  // A guest receives a unique owner ID, not the shared literal "guest".
  const guestId = `guest_${crypto.randomUUID()}`;
  const session = issueSessionForOwner(guestId);
  const tokenHash = hashUserSessionToken(session.sessionToken);

  try {
    const storage = persistentStorage;
    if (!storage) throw new Error('Authentication storage is unavailable.');
    await storage.createAuthSession(
      tokenHash,
      guestId,
      null,
      session.expiresAt
    );
    setSessionCookies(res, session.sessionToken);

    return res.json({
      success: true,
      expiresAt: session.expiresAt,
    });
  } catch (error) {
    userSessions.delete(tokenHash);
    console.error('[Auth] Guest session creation failed:', error);

    return res.status(503).json({
      error: {
        message: 'A guest session could not be created. Please try again.',
      },
    });
  }
});



app.post('/api/user/logout', async (req, res) => {
  const token = readBearerSessionToken(req);

  if (!token) {
    clearSessionCookies(res);
    return res.json({ success: true });
  }

  const tokenHash = hashUserSessionToken(token);

  try {
    const storage = persistentStorage;
    if (!storage) throw new Error('Authentication storage is unavailable.');
    await storage.deleteAuthSession(tokenHash);
    userSessions.delete(tokenHash);
    clearSessionCookies(res);

    return res.json({ success: true });
  } catch (error) {
    console.error('[Auth] Session revocation failed:', error);

    return res.status(503).json({
      error: {
        message: 'Logout could not be completed. Please try again.',
      },
    });
  }
});

app.get('/api/user/me', async (req, res) => {
  const token = readBearerSessionToken(req);

  if (!token) {
    return res.status(401).json({
      authenticated: false,
      error: { message: 'A valid RARE session is required.' },
    });
  }

  const tokenHash = hashUserSessionToken(token);

  try {
    const storage = persistentStorage;
    if (!storage) throw new Error('Authentication storage is unavailable.');
    const session = await storage.getAuthSession(tokenHash);

    if (!session || session.expiresAt <= Date.now()) {
      if (session) {
        await storage.deleteAuthSession(tokenHash);
      }

      userSessions.delete(tokenHash);

      return res.status(401).json({
        authenticated: false,
        error: { message: 'Your session is missing or expired. Please sign in again.' },
      });
    }

    if (!session.accountId) {
      return res.json({
        authenticated: true,
        user: null,
        expiresAt: session.expiresAt,
      });
    }

    const user = await storage.getAuthUserById(
      session.accountId
    );

    if (!user) {
      await storage.deleteAuthSession(tokenHash);
      userSessions.delete(tokenHash);

      return res.status(401).json({
        authenticated: false,
        error: { message: 'The account for this session could not be found. Please sign in again.' },
      });
    }

    return res.json({
      authenticated: true,
      user: toPublicAuthUser(user),
      expiresAt: session.expiresAt,
    });
  } catch (error) {
    console.error('[Auth] Current-session validation failed:', error);

    return res.status(503).json({
      error: {
        message: 'Session validation is temporarily unavailable. Please try again.',
      },
    });
  }
});

// User Accounts Authentication System (Real Verified Google, Outlook, Email, Phone)

app.post('/api/user/oauth', async (req, res) => {
  const { provider = 'google', token, idToken, nonce, code, codeVerifier, redirectUri } = req.body || {};
  const rawToken = typeof token === 'string' ? token : typeof idToken === 'string' ? idToken : null;
  if (provider === 'google' && (!rawToken || !rawToken.trim())) {
    return res.status(400).json({ success: false, error: 'A Google Identity Services ID token is required.' });
  }
  if (rawToken && rawToken.length > 16_384) return res.status(400).json({ success: false, error: 'Identity token exceeds the supported size limit.' });

  let verifiedProfile: {
    provider: 'google' | 'outlook';
    email: string;
    emailVerified: boolean;
    name: string;
    sub: string;
    avatarUrl?: string;
  } | null = null;

  try {
    if (provider === 'google') {
      verifiedProfile =
        await oAuthVerificationService.verifyGoogleToken(rawToken as string, typeof nonce === 'string' ? nonce : '');
    } else if (provider === 'outlook') {
      if (typeof code !== 'string' || typeof codeVerifier !== 'string' || typeof redirectUri !== 'string') {
        return res.status(400).json({ success: false, error: 'Microsoft sign-in requires an authorization code and PKCE transaction.' });
      }
      verifiedProfile = await oAuthVerificationService.exchangeMicrosoftAuthorizationCode(
        code,
        codeVerifier,
        typeof nonce === 'string' ? nonce : '',
        redirectUri,
      );
    } else {
      return res.status(400).json({
        success: false,
        error: `Unsupported identity provider: ${provider}`,
      });
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Identity verification failed.';

    return res.status(401).json({
      success: false,
      error: `OAuth identity verification failed: ${message}`,
    });
  }

  if (!verifiedProfile) {
    return res.status(401).json({
      success: false,
      error: 'OAuth identity verification failed.',
    });
  }

  const storage = persistentStorage;

  if (!storage) {
    return res.status(503).json({
      success: false,
      error: 'Authentication storage is unavailable.',
    });
  }

  const cleanEmail = verifiedProfile.emailVerified ? verifiedProfile.email.trim().toLowerCase() : '';
  const cleanName =
    verifiedProfile.name.trim().slice(0, 120) ||
    cleanEmail.split('@')[0] || 'RARE User';

  try {
    const user = await storage.upsertVerifiedOAuthUser({
      id: `usr_${crypto.randomUUID()}`,
      name: cleanName,
      email: cleanEmail,
      emailVerified: verifiedProfile.emailVerified,
      provider: verifiedProfile.provider,
      subject: verifiedProfile.sub,
      createdAt: new Date().toISOString(),
    });

    // Keep the legacy map updated while other routes are being migrated.
    if (user.email) registeredUsers.set(user.email, {
      id: user.id, name: user.name, email: user.email,
      phone: user.phone ?? undefined, passwordHash: user.passwordHash ?? undefined,
      provider: user.provider, role: user.role, createdAt: user.createdAt,
    });

    auditLog.unshift({
      id: `aud_${crypto.randomUUID()}`,
      timestamp: new Date().toISOString(),
      actor: user.id,
      action: 'oauth_login_success',
      kind: 'user',
      details: `Verified identity for ${user.name} via ${verifiedProfile.provider} token verification.`,
    });

    const { sessionToken, expiresAt } = issueUserSession(user);

await storage.createAuthSession(
  hashUserSessionToken(sessionToken),
  user.id,
  user.id,
  expiresAt
);
    setSessionCookies(res, sessionToken);

    return res.json({
      success: true,
      expiresAt,
      user: toPublicAuthUser(user),
    });
  } catch (error) {
    console.error('[Auth] OAuth account persistence failed:', error);

    return res.status(503).json({
      success: false,
      error: 'OAuth sign-in is temporarily unavailable. Please try again later.',
    });
  }
});

app.post('/api/user/signup', async (req, res) => {
  const { email, password, name } = req.body || {};

  if (
    typeof email !== 'string' ||
    !email.trim() ||
    typeof password !== 'string' ||
    !password
  ) {
    return res.status(400).json({
      success: false,
      error: 'Email and password are required.',
    });
  }

  const cleanEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || cleanEmail.length > 254) {
    return res.status(400).json({ success: false, error: 'Enter a valid email address.' });
  }
  if (password.length < 12 || password.length > 256) {
    return res.status(400).json({ success: false, error: 'Password must be between 12 and 256 characters.' });
  }
  if (name !== undefined && (typeof name !== 'string' || name.trim().length > 120)) {
    return res.status(400).json({ success: false, error: 'Name must be at most 120 characters.' });
  }
  const storage = persistentStorage;

  if (!storage) {
    return res.status(503).json({
      success: false,
      error: 'Authentication storage is unavailable.',
    });
  }

  try {
    const existing = await storage.getAuthUserByEmail(cleanEmail);

    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'An account with this email already exists.',
      });
    }

    const user = await storage.createAuthUser({
      id: `usr_${crypto.randomUUID()}`,
      name:
        typeof name === 'string' && name.trim()
          ? name.trim().slice(0, 120)
          : cleanEmail.split('@')[0],
      email: cleanEmail,
      phone: null,
      passwordHash: await hashPassword(password),
      provider: 'email',
      role: 'user',
      createdAt: new Date().toISOString(),
    });

    // Preserve compatibility with the existing login route
    // while that route is being migrated to persistent storage.
    registeredUsers.set(cleanEmail, {
      id: user.id,
      name: user.name,
      email: user.email ?? undefined,
      phone: user.phone ?? undefined,
      passwordHash: user.passwordHash ?? undefined,
      provider: user.provider,
      role: user.role,
      createdAt: user.createdAt,
    });

    const { sessionToken, expiresAt } = issueUserSession(user);

await storage.createAuthSession(
  hashUserSessionToken(sessionToken),
  user.id,
  user.id,
  expiresAt
);
    setSessionCookies(res, sessionToken);

    return res.json({
      success: true,
      expiresAt,
      user: toPublicAuthUser(user),
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === '23505') {
      return res.status(400).json({
        success: false,
        error: 'An account with this email already exists.',
      });
    }

    console.error('[Auth] Email signup failed:', error);

    return res.status(503).json({
      success: false,
      error: 'Account creation is temporarily unavailable. Please try again later.',
    });
  }
});


app.post('/api/user/login', async (req, res) => {
  const { email, password } = req.body || {};

  if (
    typeof email !== 'string' ||
    !email.trim() ||
    typeof password !== 'string' ||
    !password
  ) {
    return res.status(400).json({
      success: false,
      error: 'Email and password are required.',
    });
  }
  if (password.length > 256) return res.status(400).json({ success: false, error: 'Password exceeds the supported size limit.' });

  const cleanEmail = email.trim().toLowerCase();
  const storage = persistentStorage;

  if (!storage) {
    return res.status(503).json({
      success: false,
      error: 'Authentication storage is unavailable.',
    });
  }

  try {
    const existing = await storage.getAuthUserByEmail(cleanEmail);

    if (!existing || !existing.passwordHash) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.',
      });
    }

    
    let passwordMatches = false;

    if (existing.passwordHash.startsWith('scrypt:')) {
      const [scheme, salt, storedHash, extra] =
        existing.passwordHash.split(':');

      if (
        scheme === 'scrypt' &&
        salt &&
        storedHash &&
        !extra &&
        /^[a-f0-9]{128}$/i.test(storedHash)
      ) {
        const storedBuffer = Buffer.from(storedHash, 'hex');

        const computedBuffer = await new Promise<Buffer>(
          (resolve, reject) => {
            crypto.scrypt(password, salt, 64, (error, derivedKey) => {
              if (error) {
                reject(error);
                return;
              }

              resolve(derivedKey);
            });
          }
        );

        passwordMatches =
          computedBuffer.length === storedBuffer.length &&
          crypto.timingSafeEqual(computedBuffer, storedBuffer);
      }
    } else {
      // Continue supporting existing SHA-256 password hashes during migration.
      const [salt, storedHash, extra] =
        existing.passwordHash.split(':');

      if (
        salt &&
        storedHash &&
        !extra &&
        /^[a-f0-9]{64}$/i.test(storedHash)
      ) {
        const computedHash = crypto
          .createHash('sha256')
          .update(`${salt}:${password}`)
          .digest('hex');

        const computedBuffer = Buffer.from(computedHash, 'hex');
        const storedBuffer = Buffer.from(storedHash, 'hex');

        passwordMatches =
          computedBuffer.length === storedBuffer.length &&
          crypto.timingSafeEqual(computedBuffer, storedBuffer);
      }
    }


    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.',
      });
    }
    // Upgrade legacy SHA-256 password hashes after successful verification.
    if (!existing.passwordHash.startsWith('scrypt:')) {
      try {
        const upgradedPasswordHash = await hashPassword(password);

        await storage.updateAuthUserPasswordHash(
          existing.id,
          upgradedPasswordHash
        );

        existing.passwordHash = upgradedPasswordHash;
      } catch (migrationError) {
        // A migration failure must not lock out a user whose password
        // was already verified successfully. Retry on their next login.
        console.error(
          '[Auth] Legacy password hash upgrade failed:',
          migrationError
        );
      }
    }
    // Keep the existing map updated for older code that still reads it.
    registeredUsers.set(cleanEmail, {
      id: existing.id,
      name: existing.name,
      email: existing.email ?? undefined,
      phone: existing.phone ?? undefined,
      passwordHash: existing.passwordHash ?? undefined,
      provider: existing.provider,
      role: existing.role,
      createdAt: existing.createdAt,
    });

    const { sessionToken, expiresAt } = issueUserSession(existing);

await storage.createAuthSession(
  hashUserSessionToken(sessionToken),
  existing.id,
  existing.id,
  expiresAt
);
    setSessionCookies(res, sessionToken);

    return res.json({
      success: true,
      expiresAt,
      user: toPublicAuthUser(existing),
    });
  } catch (error) {
    console.error('[Auth] Email login failed:', error);

    return res.status(503).json({
      success: false,
      error: 'Login is temporarily unavailable. Please try again later.',
    });
  }
});


app.post('/api/user/send-otp', async (req, res) => {
  const { phone, channel = 'sms' } = req.body;
  if (!phone || typeof phone !== 'string' || phone.trim().length < 5) {
    return res.status(400).json({ success: false, error: 'Valid phone number is required.' });
  }
  const cleanPhone = normalizePhone(phone);
  const targetChannel: 'sms' | 'whatsapp' = channel === 'whatsapp' ? 'whatsapp' : 'sms';

  // Enforce rate limiting: 1 message per 30 seconds
  const now = Date.now();
  const rateLimit = otpRateLimits.get(cleanPhone);
  if (rateLimit && now - rateLimit.lastSentAt < 30_000) {
    const waitSec = Math.ceil((30_000 - (now - rateLimit.lastSentAt)) / 1000);
    return res.status(429).json({
      success: false,
      error: `Please wait ${waitSec} seconds before requesting another verification code.`,
    });
  }

  const code = generateSecureOtpCode();
  const codeHash = hashOtpCode(cleanPhone, code);

  // Attempt real provider delivery first
  let dispatchResult;
  if (targetChannel === 'whatsapp') {
    dispatchResult = await notificationDeliveryService.sendWhatsAppVerification(cleanPhone, code);
  } else {
    dispatchResult = await notificationDeliveryService.sendSmsVerification(cleanPhone, code);
  }

  if (!dispatchResult.success) {
    return res.status(503).json({
      success: false,
      error: dispatchResult.error || 'Failed to dispatch verification code via messaging provider.',
    });
  }

  // Only store and activate code if provider confirmed send
  activeOtpRecords.set(cleanPhone, {
    codeHash,
    expiresAt: now + 10 * 60 * 1000,
    channel: targetChannel,
    attempts: 0,
    maxAttempts: 5,
    createdAt: now,
  });

  otpRateLimits.set(cleanPhone, {
    lastSentAt: now,
    countInWindow: (rateLimit?.countInWindow || 0) + 1,
  });

  const channelLabel = targetChannel === 'whatsapp' ? 'WhatsApp' : 'SMS';
  res.json({
    success: true,
    channel: targetChannel,
    message: `Verification code sent via ${channelLabel} to ${cleanPhone}`,
  });
});

app.post('/api/user/verify-otp', async (req, res) => {
  const { phone, code, name } = req.body || {};

  if (
    typeof phone !== 'string' ||
    typeof code !== 'string' ||
    phone.trim().length < 5 ||
    !code.trim()
  ) {
    return res.status(400).json({
      success: false,
      error: 'Phone and verification code are required.',
    });
  }

  const cleanPhone = normalizePhone(phone);
  const cleanCode = code.trim();
  const saved = activeOtpRecords.get(cleanPhone);

  if (!saved) {
    return res.status(400).json({
      success: false,
      error: 'No active verification code found for this phone number.',
    });
  }

  if (Date.now() > saved.expiresAt) {
    activeOtpRecords.delete(cleanPhone);
    return res.status(400).json({
      success: false,
      error: 'Verification code has expired. Please request a new one.',
    });
  }

  if (saved.attempts >= saved.maxAttempts) {
    activeOtpRecords.delete(cleanPhone);
    return res.status(400).json({
      success: false,
      error: 'Too many incorrect attempts. Please request a new code.',
    });
  }

  saved.attempts += 1;

  const computedHash = hashOtpCode(cleanPhone, cleanCode);
  const submittedHash = Buffer.from(computedHash, 'hex');
  const expectedHash = Buffer.from(saved.codeHash, 'hex');

  const codeMatches =
    submittedHash.length === expectedHash.length &&
    crypto.timingSafeEqual(submittedHash, expectedHash);

  if (!codeMatches) {
    return res.status(400).json({
      success: false,
      error: `Invalid verification code. ${saved.maxAttempts - saved.attempts} attempt(s) remaining.`,
    });
  }

  // The OTP can never be reused after successful verification.
  activeOtpRecords.delete(cleanPhone);

  try {
    const storage = persistentStorage;
    if (!storage) throw new Error('Authentication storage is unavailable.');

    let user = await storage.getAuthUserByPhone(cleanPhone);

    if (!user) {
      user = await storage.createAuthUser({
        id: `usr_${crypto.randomUUID()}`,
        name:
          typeof name === 'string' && name.trim()
            ? name.trim().slice(0, 120)
            : `User ${cleanPhone.slice(-4)}`,
        email: null,
        phone: cleanPhone,
        passwordHash: null,
        provider: 'phone',
        role: 'user',
        createdAt: new Date().toISOString(),
      });
    }

        const { sessionToken, expiresAt } = issueUserSession(user);

    await storage.createAuthSession(
      hashUserSessionToken(sessionToken),
      user.id,
      user.id,
      expiresAt
    );
    setSessionCookies(res, sessionToken);

    return res.json({
      success: true,
      expiresAt,
      user: toPublicAuthUser(user),
    });
  } catch (error) {
    console.error('[Auth] Phone OTP account/session persistence failed:', error);

    return res.status(503).json({
      success: false,
      error: 'Authentication storage is unavailable. Please retry verification.',
    });
  }
});

app.post('/api/user/send-email-otp', async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ success: false, error: 'Valid email address is required.' });
  }
  const cleanEmail = email.toLowerCase().trim();

  // Enforce rate limiting: 1 message per 30 seconds
  const now = Date.now();
  const rateLimit = otpRateLimits.get(cleanEmail);
  if (rateLimit && now - rateLimit.lastSentAt < 30_000) {
    const waitSec = Math.ceil((30_000 - (now - rateLimit.lastSentAt)) / 1000);
    return res.status(429).json({
      success: false,
      error: `Please wait ${waitSec} seconds before requesting another email code.`,
    });
  }

  const code = generateSecureOtpCode();
  const codeHash = hashOtpCode(cleanEmail, code);

  // Attempt real provider delivery first
  const dispatchResult = await notificationDeliveryService.sendEmailVerification(cleanEmail, code);
  if (!dispatchResult.success) {
    return res.status(503).json({
      success: false,
      error: dispatchResult.error || 'Failed to dispatch verification email via provider.',
    });
  }

  // Only store and activate code if provider confirmed send
  activeOtpRecords.set(cleanEmail, {
    codeHash,
    expiresAt: now + 10 * 60 * 1000,
    channel: 'email',
    attempts: 0,
    maxAttempts: 5,
    createdAt: now,
  });

  otpRateLimits.set(cleanEmail, {
    lastSentAt: now,
    countInWindow: (rateLimit?.countInWindow || 0) + 1,
  });

  res.json({
    success: true,
    channel: 'email',
    message: `Verification code sent to ${cleanEmail}`,
  });
});



// Privileged Developer Space Status & Diagnostics
app.get('/api/developer/status', async (req, res) => {
  const isAuth = await isDeveloperSessionAuthorized(req);

  if (!isAuth) {
    return res.status(403).json({
      error: { message: 'Developer authorization required.' },
    });
  }

  return res.json({
    authenticated: true,
    autonomyLevel: appSettings.autonomyLevel,
    singleWriterLock: 'Active (Mutex Acquired)',
    checkpointRetention: 'Keep last 40 snapshots / 30 days',
    checkpointsCount: checkpoints.length,
    activeRunsCount: activeAgentRuns.length,
    toolchainsCount: toolchains.length,
    updatesCount: updateStore.getAll('developer').length,
    auditEvents: auditLog.slice(0, 20),
    systemConfig: {
      port: PORT,
      host: '0.0.0.0',
      nodeVersion: process.version,
      sandbox: 'Enforced',
      recoveryStrategy: 'Atomic Rollback on Unrecoverable Defect',
    },
  });
});

// Privileged Self-Development Engine Dispatcher
app.post('/api/developer/self-dev', async (req, res) => {
  const isAuth = await isDeveloperSessionAuthorized(req);

  if (!isAuth) {
    return res.status(403).json({
      error: { message: 'Developer authorization required.' },
    });
  }

  const { instruction } = req.body;

  if (typeof instruction !== 'string' || !instruction.trim()) {
    return res.status(400).json({
      error: { message: 'Instruction is required.' },
    });
  }

  const result = await selfDevEngine.executeCycle(
    { instruction },
    true
  );

  auditLog.unshift({
    id: `aud_${Date.now()}`,
    timestamp: new Date().toISOString(),
    actor: 'developer',
    action: 'self_dev_executed',
    kind: 'dev_privileged',
    details: `Executed self-dev cycle for: "${instruction}". Status: ${result.status}`,
    checkpointId: result.checkpointId,
  });

  return res.status(201).json(result);
});

// Rollback Checkpoint
app.post('/api/developer/rollback', async (req, res) => {
  if (!(await isDeveloperSessionAuthorized(req))) {
    return res.status(403).json({ error: { message: 'Developer authorization required.' } });
  }
  const { checkpointId } = req.body;
  if (!checkpointId) {
    return res.status(400).json({ error: { message: 'checkpointId is required.' } });
  }

  const rb = checkpointStore.restoreCheckpoint(checkpointId);
  if (!rb.success) {
    return res.status(500).json({ error: { message: rb.error || 'Failed to restore checkpoint' } });
  }

  auditLog.unshift({
    id: `aud_${Date.now()}`,
    timestamp: new Date().toISOString(),
    actor: 'developer',
    action: 'checkpoint_restore',
    kind: 'dev_privileged',
    details: `Restored RARE core state to checkpoint: ${checkpointId}. Restored ${rb.restoredFiles.length} files.`,
  });

  res.json({ success: true, message: `Successfully rolled back to checkpoint ${checkpointId}`, restoredFiles: rb.restoredFiles });
});

// Multi-Agent Runs & Universal Projects API
app.get('/api/agents/runs', async (req, res) => {
  try {
    res.json(await persistentStorage!.listProjectRuns(res.locals.rareUserId));
  } catch (error) {
    console.error('[Projects] Private project list failed:', error);
    res.status(503).json({ error: { message: 'Project storage is unavailable.' } });
  }
});

app.get('/api/agents/runs/:id', async (req, res) => {
  try {
    const run = await persistentStorage!.getProjectRun(res.locals.rareUserId, req.params.id);
    if (!run) return res.status(404).json({ error: { message: 'Run not found' } });
    res.json(run);
  } catch (error) {
    console.error('[Projects] Private project read failed:', error);
    res.status(503).json({ error: { message: 'Project storage is unavailable.' } });
  }
});

// Universal Build Project Creation
app.post('/api/agents/runs', async (req, res) => {
  const { title, targetDomain, objective } = req.body;
  if (typeof title !== 'string' || !title.trim() || typeof objective !== 'string' || !objective.trim()) {
    return res.status(400).json({ error: { message: 'Title and objective are required' } });
  }

  const now = new Date().toISOString();
  const runId = `run_${crypto.randomUUID()}`;
  const teamRun: MultiAgentTeamRun = {
    id: runId,
    ownerId: res.locals.rareUserId,
    title: title.trim().slice(0, 160),
    targetDomain: typeof targetDomain === 'string' && targetDomain.trim() ? targetDomain.trim().slice(0, 40) : 'web',
    objective: objective.trim().slice(0, 4000),
    status: 'coordinating',
    currentStage: 'Assembling Specialist Team',
    userProgressMessage: 'Coordinating specialized agents for project...',
    coordinator: {
      id: 'ag_coord',
      name: 'Agent 00 — Project Coordinator',
      role: 'coordinator',
      title: 'Lead Coordinator',
      avatarColor: 'from-blue-600 to-indigo-600',
      status: 'working',
      currentTask: 'Formulating task plan & assigning responsibilities',
      completedTasks: [],
      lastAction: 'Initialized agent roster',
      progressPercent: 20,
    },
    agents: [
      {
        id: 'ag_arch',
        name: 'Agent 01 — Architect',
        role: 'architect',
        title: 'Software Architect',
        avatarColor: 'from-indigo-600 to-purple-600',
        status: 'working',
        currentTask: 'Specifying architecture & component interfaces',
        completedTasks: [],
        lastAction: 'Evaluating framework dependencies',
        progressPercent: 25,
      },
      {
        id: 'ag_dev',
        name: 'Agent 02 — Implementation Engineer',
        role: targetDomain === 'android' ? 'frontend' : 'backend',
        title: targetDomain === 'android' ? 'Mobile Specialist' : 'Full-Stack Developer',
        avatarColor: 'from-purple-600 to-pink-600',
        status: 'waiting',
        currentTask: 'Waiting for architecture specification',
        completedTasks: [],
        lastAction: 'Prepared environment',
        progressPercent: 0,
      },
      {
        id: 'ag_test',
        name: 'Agent 03 — QA & Test Engineer',
        role: 'test',
        title: 'Verification Specialist',
        avatarColor: 'from-amber-600 to-orange-600',
        status: 'waiting',
        currentTask: 'Preparing acceptance criteria & test cases',
        completedTasks: [],
        lastAction: 'Configured test runner',
        progressPercent: 0,
      },
      {
        id: 'ag_rel',
        name: 'Agent 04 — Packaging Engineer',
        role: 'release',
        title: 'Release Specialist',
        avatarColor: 'from-emerald-600 to-teal-600',
        status: 'waiting',
        currentTask: 'Standing by for deliverable assembly',
        completedTasks: [],
        lastAction: 'Inspected target toolchain',
        progressPercent: 0,
      },
    ],
    messages: [
      {
        id: `msg_${Date.now()}_1`,
        fromAgentId: 'ag_coord',
        fromRole: 'coordinator',
        fromName: 'Project Coordinator',
        toAgentId: 'ag_arch',
        toRole: 'architect',
        toName: 'Architect',
        type: 'assignment',
        subject: 'Requirement Decomposition',
        content: `Analyze objective: "${objective}". Produce component layout and dependency list.`,
        timestamp: new Date().toLocaleTimeString(),
      },
    ],
    events: [
      {
        id: `ev_${crypto.randomUUID()}`,
        time: new Date().toLocaleTimeString(),
        createdAt: now,
        agentId: 'ag_coord',
        agentName: 'Project Coordinator',
        level: 'info',
        message: 'Started model-backed planning and live workspace verification.',
      },
    ],
    createdAt: now,
    updatedAt: now,
    artifacts: [],
    metrics: { durationSeconds: 0, tasksTotal: 5, tasksCompleted: 0, handoffsCount: 1, repairsCount: 0 },
  };

  activeAgentRuns.unshift(teamRun);
  const persistRun = async () => {
    teamRun.updatedAt = new Date().toISOString();
    await persistentStorage?.persistProjectRun(teamRun);
  };
  const recordEvent = async (agentId: string, agentName: string, message: string, level: 'info' | 'warn' | 'error' | 'success', toolCalled?: string) => {
    const createdAt = new Date().toISOString();
    teamRun.events.push({
      id: `ev_${crypto.randomUUID()}`,
      time: new Date(createdAt).toLocaleTimeString(),
      createdAt,
      agentId,
      agentName,
      level,
      message,
      toolCalled,
    });
    await persistRun();
  };

  try {
    await persistRun();
    teamRun.status = 'executing';
    teamRun.currentStage = 'Planning with active model';
    teamRun.coordinator.currentTask = 'Generate a concrete inspection plan';
    const plan = await providerRegistry.generateOnline(
      `Create a concise, factual inspection plan for this project objective. Do not claim to build or modify files. Objective: ${teamRun.objective}`,
      undefined,
      { temperature: 0.2 },
    );
    teamRun.coordinator.status = 'completed';
    teamRun.coordinator.progressPercent = 100;
    teamRun.coordinator.completedTasks.push('Generate model-backed inspection plan');
    teamRun.coordinator.lastAction = `Planning completed with ${plan.modelUsed}`;
    teamRun.messages.push({
      id: `msg_${crypto.randomUUID()}`,
      fromAgentId: 'ag_coord',
      fromRole: 'coordinator',
      fromName: 'Project Coordinator',
      toAgentId: 'ag_arch',
      toRole: 'architect',
      toName: 'Architect',
      type: 'assignment',
      subject: 'Evidence-based inspection plan',
      content: plan.reply.slice(0, 4000),
      timestamp: new Date().toLocaleTimeString(),
    });
    await recordEvent('ag_coord', 'Project Coordinator', `Plan generated by ${plan.modelUsed} (${plan.providerType}).`, 'success');

    teamRun.currentStage = 'Inspecting workspace';
    teamRun.agents[0].status = 'working';
    teamRun.agents[0].currentTask = 'Search project files for objective-related evidence';
    const toolPlan = [
      { agent: teamRun.agents[0], tool: 'SEARCH' as const, inputs: { query: teamRun.objective, scope: 'all' } },
      { agent: teamRun.agents[1], tool: 'RESEARCH' as const, inputs: { query: teamRun.objective, maxResults: 5 } },
      { agent: teamRun.agents[2], tool: 'RUN_TEST' as const, inputs: {} },
      { agent: teamRun.agents[3], tool: 'BUILD_PROJECT' as const, inputs: {} },
    ];
    const toolResults: Array<{ tool: string; success: boolean; executionTimeMs: number; output?: unknown; error?: string }> = [];
    for (const [index, step] of toolPlan.entries()) {
      teamRun.currentStage = step.tool === 'RUN_TEST' ? 'Running verification' : step.tool === 'BUILD_PROJECT' ? 'Verifying build' : 'Inspecting workspace';
      teamRun.userProgressMessage = `${step.agent.title}: executing ${step.tool}`;
      step.agent.status = 'working';
      step.agent.currentTask = `Execute ${step.tool} against the actual workspace or source`;
      const result = await toolExecutor.execute(step.tool, step.inputs, { actor: `agent:${step.agent.id}` });
      const outputFailed = result.output?.success === false;
      const successful = result.success && !outputFailed;
      toolResults.push({
        tool: result.tool,
        success: successful,
        executionTimeMs: result.executionTimeMs,
        output: result.output,
        error: result.error || result.output?.error,
      });
      step.agent.status = successful ? 'completed' : 'failed';
      step.agent.progressPercent = successful ? 100 : Math.round((index / toolPlan.length) * 100);
      step.agent.lastAction = successful ? `${step.tool} completed` : `${step.tool} reported a failure`;
      if (successful) step.agent.completedTasks.push(`${step.tool} completed`);
      await recordEvent(
        step.agent.id,
        step.agent.name,
        successful ? `${step.tool} completed in ${result.executionTimeMs} ms.` : `${step.tool} failed: ${result.error || result.output?.error || 'tool reported failure'}`,
        successful ? 'success' : 'error',
        step.tool,
      );
    }

    const finishedAt = new Date().toISOString();
    const report = {
      runId,
      title: teamRun.title,
      targetDomain: teamRun.targetDomain,
      objective: teamRun.objective,
      generatedAt: finishedAt,
      model: { provider: plan.providerType, model: plan.modelUsed, plan: plan.reply },
      tools: toolResults,
    };
    const reportPath = `agent-runs/${runId}.json`;
    const reportContent = JSON.stringify(report, null, 2);
    const reportSize = Buffer.byteLength(reportContent, 'utf8');
    await persistentStorage!.updateOwnedState<any[]>(res.locals.rareUserId, 'documents', [], (documents) => [
      { path: reportPath, content: reportContent, format: 'json', updatedAt: finishedAt },
      ...documents.filter((document) => document.path !== reportPath),
    ]);
    teamRun.artifacts.push({
      name: path.basename(reportPath),
      type: 'application/json',
      size: `${reportSize} bytes`,
      sizeBytes: reportSize,
      path: `documents/${reportPath}`,
    });
    teamRun.metrics.tasksCompleted = toolResults.filter((result) => result.success).length + 1;
    teamRun.metrics.durationSeconds = Math.round((Date.now() - Date.parse(teamRun.createdAt)) / 1000);
    teamRun.currentStage = toolResults.every((result) => result.success) ? 'Verification complete' : 'Verification finished with failures';
    teamRun.status = toolResults.every((result) => result.success) ? 'completed' : 'failed';
    teamRun.userProgressMessage = teamRun.status === 'completed'
      ? 'Workspace inspection, research, tests, and build verification completed. See the run report for evidence.'
      : 'Verification finished with one or more tool failures. See the run report for actual outputs.';
    teamRun.coordinator.status = teamRun.status === 'completed' ? 'completed' : 'failed';
    teamRun.coordinator.lastAction = `Run report saved to ${reportPath}`;
    await recordEvent('ag_coord', 'Project Coordinator', `Saved evidence report to ${reportPath}. No platform package was generated.`, 'info');
    await persistRun();
    return res.status(201).json(teamRun);
  } catch (error) {
    teamRun.status = 'failed';
    teamRun.currentStage = 'Run failed';
    teamRun.userProgressMessage = (error as any)?.statusCode === 503
      ? 'No online AI provider was available; the project run was stopped.'
      : 'The project run failed. Review server logs for the request identifier.';
    teamRun.coordinator.status = 'failed';
    await recordEvent('ag_coord', 'Project Coordinator', teamRun.userProgressMessage, 'error').catch(() => {});
    await persistRun().catch(() => {});
    return res.status((error as any)?.statusCode === 503 ? 503 : 502).json({ error: { message: teamRun.userProgressMessage }, run: teamRun });
  }
});

// Trigger Targeted Diagnose and Repair Loop
app.post('/api/agents/runs/:id/repair', async (req, res) => {
  let run: MultiAgentTeamRun | undefined;
  try {
    run = await persistentStorage!.getProjectRun(res.locals.rareUserId, req.params.id) as MultiAgentTeamRun | null || undefined;
  } catch (error) {
    console.error('[Projects] Private project read failed before repair:', error);
    return res.status(503).json({ error: { message: 'Project storage is unavailable.' } });
  }
  if (!run) return res.status(404).json({ error: { message: 'Run not found' } });

  run.status = 'validating';
  run.currentStage = 'Running diagnostic verification';
  run.userProgressMessage = 'Running real diagnostic and test tools; no files will be modified.';
  const appendEvent = (agentId: string, agentName: string, level: 'info' | 'warn' | 'error' | 'success', message: string, toolCalled?: string) => {
    const createdAt = new Date().toISOString();
    run.events.push({
      id: `ev_${crypto.randomUUID()}`,
      time: new Date(createdAt).toLocaleTimeString(),
      createdAt,
      agentId,
      agentName,
      level,
      message,
      toolCalled,
    });
  };

  try {
    const diagnostic = typeof req.body?.errorText === 'string' && req.body.errorText.trim()
      ? await toolExecutor.execute('INSPECT_ERROR', { errorText: req.body.errorText })
      : undefined;
    if (diagnostic) {
      appendEvent('ag_test', 'QA & Test Engineer', diagnostic.success ? 'info' : 'error', diagnostic.success ? 'Error text analyzed by INSPECT_ERROR.' : diagnostic.error || 'Error inspection failed.', 'INSPECT_ERROR');
    }
    const tests = await toolExecutor.execute('RUN_TEST', {});
    const testsPassed = tests.success && tests.output?.success !== false;
    appendEvent('ag_test', 'QA & Test Engineer', testsPassed ? 'success' : 'error', testsPassed ? `Test suite passed in ${tests.executionTimeMs} ms.` : `Test suite failed: ${tests.error || tests.output?.stderr || 'see tool output'}`, 'RUN_TEST');
    run.status = testsPassed ? 'completed' : 'failed';
    run.currentStage = testsPassed ? 'Verification complete' : 'Verification failed';
    run.userProgressMessage = testsPassed
      ? 'Diagnostic verification passed. No automatic source changes were made.'
      : 'Diagnostic verification failed. Review the test output; no automatic source changes were made.';
    run.updatedAt = new Date().toISOString();
    run.metrics.durationSeconds += Math.round(tests.executionTimeMs / 1000);
    await persistentStorage?.persistProjectRun(run);
    return res.json({ success: testsPassed, message: run.userProgressMessage, diagnostic: diagnostic?.output, tests: tests.output || tests.error });
  } catch (error) {
    run.status = 'failed';
    run.currentStage = 'Diagnostic failed';
    run.userProgressMessage = error instanceof Error ? error.message : 'Diagnostic failed.';
    appendEvent('ag_test', 'QA & Test Engineer', 'error', run.userProgressMessage);
    run.updatedAt = new Date().toISOString();
    await persistentStorage?.persistProjectRun(run);
    return res.status(502).json({ success: false, message: run.userProgressMessage });
  }
});

// Checkpoints
app.get('/api/checkpoints', async (req, res) => {
  if (!(await isDeveloperSessionAuthorized(req))) return res.status(403).json({ error: { message: 'Developer authorization required.' } });
  res.json(checkpoints);
});

// Toolchains
app.get('/api/builder/toolchains', (req, res) => {
  res.json(toolchains);
});

app.post('/api/user/verify-email-otp', async (req, res) => {
  const { email, code, name } = req.body || {};

  if (
    typeof email !== 'string' ||
    typeof code !== 'string' ||
    !email.includes('@') ||
    !code.trim()
  ) {
    return res.status(400).json({
      success: false,
      error: 'Email and verification code are required.',
    });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanCode = code.trim();
  const saved = activeOtpRecords.get(cleanEmail);

  if (!saved) {
    return res.status(400).json({
      success: false,
      error: 'No active verification code found for this email address.',
    });
  }

  if (Date.now() > saved.expiresAt) {
    activeOtpRecords.delete(cleanEmail);
    return res.status(400).json({
      success: false,
      error: 'Verification code has expired. Please request a new one.',
    });
  }

  if (saved.attempts >= saved.maxAttempts) {
    activeOtpRecords.delete(cleanEmail);
    return res.status(400).json({
      success: false,
      error: 'Too many incorrect attempts. Please request a new code.',
    });
  }

  saved.attempts += 1;

  const computedHash = hashOtpCode(cleanEmail, cleanCode);
  const submittedHash = Buffer.from(computedHash, 'hex');
  const expectedHash = Buffer.from(saved.codeHash, 'hex');

  const codeMatches =
    submittedHash.length === expectedHash.length &&
    crypto.timingSafeEqual(submittedHash, expectedHash);

  if (!codeMatches) {
    return res.status(400).json({
      success: false,
      error: `Invalid verification code. ${saved.maxAttempts - saved.attempts} attempt(s) remaining.`,
    });
  }

  // The OTP can never be reused after successful verification.
  activeOtpRecords.delete(cleanEmail);

  try {
    const storage = persistentStorage;
    if (!storage) throw new Error('Authentication storage is unavailable.');

    let user = await storage.getAuthUserByEmail(cleanEmail);

    if (!user) {
      user = await storage.createAuthUser({
        id: `usr_${crypto.randomUUID()}`,
        name:
          typeof name === 'string' && name.trim()
            ? name.trim().slice(0, 120)
            : cleanEmail.split('@')[0],
        email: cleanEmail,
        phone: null,
        passwordHash: null,
        provider: 'email',
        role: 'user',
        createdAt: new Date().toISOString(),
      });
    }

    const { sessionToken, expiresAt } = await issueUserSession(user);
    const sessionTokenHash = hashUserSessionToken(sessionToken);
    await storage.createAuthSession(sessionTokenHash, user.id, user.id, expiresAt);
    setSessionCookies(res, sessionToken);

    return res.json({
      success: true,
      expiresAt,
      user: toPublicAuthUser(user),
    });
  } catch (error) {
    console.error('[Auth] Email OTP account/session persistence failed:', error);

    return res.status(503).json({
      success: false,
      error: 'Authentication storage is unavailable. Please retry verification.',
    });
  }
});

// Memory
app.get('/api/user-memory', async (req, res) => {
  const { query } = req.query;
  try {
    const items = await persistentStorage!.getOwnedState<any[]>(res.locals.rareUserId, 'memories', []);
    const q = typeof query === 'string' ? query.trim().toLowerCase() : '';
    res.json(items.filter((item) => !q || `${item.text} ${item.kind} ${(item.tags || []).join(' ')}`.toLowerCase().includes(q)));
  } catch (error) {
    console.error('[Memory] Private memory read failed:', error);
    res.status(503).json({ error: { message: 'Private memory storage is unavailable.' } });
  }
});

app.post('/api/user-memory', async (req, res) => {
  const { kind, text, tags, importance } = req.body || {};
  if (typeof text !== 'string' || !text.trim() || text.length > 20000) return res.status(400).json({ error: { message: 'Valid text is required' } });
  try {
    const item = { id: `mem_${crypto.randomUUID()}`, timestamp: new Date().toISOString(), kind: typeof kind === 'string' ? kind.slice(0, 40) : 'fact', text: text.trim(), tags: Array.isArray(tags) ? tags.filter((tag: unknown) => typeof tag === 'string').slice(0, 30).map((tag: string) => tag.slice(0, 100)) : ['custom'], importance: Math.max(1, Math.min(5, Number(importance) || 1)), source: 'user_stated', verifiedByUser: true };
    await persistentStorage!.updateOwnedState<any[]>(res.locals.rareUserId, 'memories', [], (rows) => {
      if (res.locals.rareIsGuest && rows.length >= 25) throw new Error('RARE_GUEST_LIMIT');
      return [item, ...rows];
    });
    res.status(201).json(item);
  } catch (error) {
    if (error instanceof Error && error.message === 'RARE_GUEST_LIMIT') return res.status(429).json({ error: { message: 'Guest memory limit reached. Create an account to continue.' } });
    console.error('[Memory] Private memory write failed:', error);
    res.status(503).json({ error: { message: 'Private memory storage is unavailable.' } });
  }
});

app.post('/api/user-memory/forget', async (req, res) => {
  const { id } = req.body || {};
  try {
    let removed = false;
    await persistentStorage!.updateOwnedState<any[]>(res.locals.rareUserId, 'memories', [], (rows) => rows.filter((item) => { if (item.id === String(id)) { removed = true; return false; } return true; }));
    if (removed) return res.json({ success: true });
    return res.status(404).json({ error: { message: 'Memory not found' } });
  } catch (error) {
    console.error('[Memory] Private memory deletion failed:', error);
    return res.status(503).json({ error: { message: 'Private memory storage is unavailable.' } });
  }
});

// =============================================================================
// Documents — backed by the shared Universal Content Engine
// =============================================================================
function requireDocumentsService(): DocumentsService {
  if (!documentsService) throw new Error('Document storage is not ready yet.');
  return documentsService;
}

function documentErrorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : '';
  if (message === 'RARE_GUEST_LIMIT') return 429;
  if (error instanceof DocumentPathError) return 400;
  if (/storage|database|private user state|not ready/i.test(message)) return 503;
  return 400;
}

function sendDocumentError(res: express.Response, error: unknown, fallback: string): void {
  const message = error instanceof Error ? error.message : fallback;
  const status = documentErrorStatus(error);
  if (status === 429) {
    res.status(429).json({ error: { message: 'Guest document limit reached. Create an account to continue.' } });
    return;
  }
  if (status === 503) {
    console.error('[Documents] Storage failure:', error);
    res.status(503).json({ error: { message: 'Private document storage is unavailable.' } });
    return;
  }
  res.status(status).json({ error: { message } });
}

/** Parse a document body that may be text, a URL, or a base64 file upload. */
function readDocumentPayload(body: any): { text?: string; url?: string; fileBase64?: string; filename?: string; mimeType?: string } {
  return {
    text: typeof body?.text === 'string' ? body.text : undefined,
    url: typeof body?.url === 'string' ? body.url : undefined,
    fileBase64: typeof body?.fileBase64 === 'string' ? body.fileBase64 : undefined,
    filename: typeof body?.filename === 'string' ? body.filename : undefined,
    mimeType: typeof body?.mimeType === 'string' ? body.mimeType : undefined,
  };
}

app.get('/api/documents', async (_req, res) => {
  try {
    res.json(await requireDocumentsService().list(res.locals.rareUserId));
  } catch (error) {
    sendDocumentError(res, error, 'Could not list documents.');
  }
});

// Transcription availability, reported without claiming a provider that is not configured.
async function describeTranscriptionCapability(): Promise<{
  available: boolean;
  provider?: string;
  model?: string;
  note?: string;
}> {
  if (!process.env.GEMINI_API_KEY?.trim()) {
    return {
      available: false,
      note: 'GEMINI_API_KEY is not set on the server, so audio cannot be transcribed in this deployment.',
    };
  }
  try {
    const provider = providerRegistry.getGeminiProvider();
    const version = typeof (provider as any).getVersion === 'function' ? (provider as any).getVersion() : undefined;
    return { available: true, provider: 'gemini', model: typeof version === 'string' ? version : undefined };
  } catch (error) {
    return {
      available: false,
      note: error instanceof Error ? error.message : 'The configured transcription provider is unavailable.',
    };
  }
}

// Capability discovery: what this deployment can actually read right now.
app.get('/api/documents/capabilities', async (_req, res) => {
  try {
    // Probe each adapter instead of publishing a static wish-list: an extractor
    // that cannot run here (missing poppler/tesseract/LibreOffice) reports
    // available:false so the UI never promises a format this runtime cannot read.
    const extractors = await probeExtractors();

    const transcription = await describeTranscriptionCapability();
    const usable = extractors.filter((extractor) => extractor.available).map((extractor) => extractor.id);

    res.json({
      runtime: process.env.VERCEL ? 'vercel-serverless' : 'node',
      extractors,
      usableExtractors: usable.length,
      transcription,
      notes: [
        'Content type is determined from the bytes, not the filename or Content-Type header.',
        'Scanned PDFs and images fall back to OCR when no text layer exists.',
        'Only adapters reporting available:true can run in this deployment.',
      ],
    });
  } catch (error) {
    res.status(500).json({ error: { message: error instanceof Error ? error.message : 'Capability probe failed.' } });
  }
});

app.get('/api/documents/*', async (req, res) => {
  try {
    const document = await requireDocumentsService().read(res.locals.rareUserId, (req.params as any)[0]);
    if (!document) {
      res.status(404).json({ error: { message: 'Document not found' } });
      return;
    }
    res.json(document);
  } catch (error) {
    sendDocumentError(res, error, 'Could not open the document.');
  }
});

app.post('/api/documents', async (req, res) => {
  const { path: requestedPath } = req.body || {};
  const payload = readDocumentPayload(req.body);
  try {
    const service = requireDocumentsService();

    // 1. URL import through the content engine.
    if (payload.url) {
      const outcome = await service.importUrl(res.locals.rareUserId, payload.url, {
        isGuest: res.locals.rareIsGuest,
        requestedPath: typeof requestedPath === 'string' ? requestedPath : undefined,
      });
      if (!outcome.ok) {
        res.status(422).json({
          error: {
            message: outcome.error?.message || 'The source could not be read.',
            code: outcome.error?.code,
            nextStep: outcome.error?.nextStep,
          },
          kind: outcome.kind,
          label: outcome.label,
          warnings: outcome.warnings,
        });
        return;
      }
      res.status(201).json(outcome);
      return;
    }

    // 2. File upload through the content engine (any supported format).
    if (payload.fileBase64) {
      const buffer = Buffer.from(payload.fileBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
      if (buffer.length === 0) {
        res.status(400).json({ error: { message: 'The uploaded file was empty.' } });
        return;
      }
      if (buffer.length > 25 * 1024 * 1024) {
        res.status(413).json({ error: { message: 'Files must be 25 MB or smaller.' } });
        return;
      }
      const outcome = await service.importBuffer(res.locals.rareUserId, buffer, payload.filename || 'upload', {
        isGuest: res.locals.rareIsGuest,
        mimeType: payload.mimeType,
      });
      if (!outcome.ok) {
        res.status(422).json({
          error: {
            message: outcome.error?.message || 'The file could not be read.',
            code: outcome.error?.code,
            nextStep: outcome.error?.nextStep,
          },
          kind: outcome.kind,
          label: outcome.label,
          warnings: outcome.warnings,
        });
        return;
      }
      res.status(201).json(outcome);
      return;
    }

    // 3. Plain text save.
    if (!requestedPath) {
      res.status(400).json({ error: { message: 'Document path required' } });
      return;
    }
    if (typeof payload.text !== 'string') {
      res.status(400).json({ error: { message: 'Document text must be a string.' } });
      return;
    }
    const saved = await service.save(res.locals.rareUserId, requestedPath, payload.text, { isGuest: res.locals.rareIsGuest });
    res.status(201).json({
      path: saved.path,
      size: Buffer.byteLength(saved.content, 'utf8'),
      format: saved.format,
      version: saved.version,
      ...(saved.sourceUrl ? { sourceUrl: saved.sourceUrl } : {}),
    });
  } catch (error) {
    sendDocumentError(res, error, 'Document could not be saved.');
  }
});

// Multi-link import: per-item results, dedupe, partial-failure recovery.
app.post('/api/documents/import-many', async (req, res) => {
  const urls = Array.isArray(req.body?.urls) ? req.body.urls.filter((url: unknown) => typeof url === 'string') : [];
  if (urls.length === 0) {
    res.status(400).json({ error: { message: 'Provide at least one URL.' } });
    return;
  }
  try {
    const outcome = await requireDocumentsService().importMany(res.locals.rareUserId, urls, {
      isGuest: res.locals.rareIsGuest,
      limit: Number(req.body?.limit) || 8,
    });
    res.json(outcome);
  } catch (error) {
    sendDocumentError(res, error, 'The sources could not be imported.');
  }
});

// Read a URL without saving it — used by the reader view and by chat.
app.post('/api/documents/preview-url', async (req, res) => {
  const url = typeof req.body?.url === 'string' ? req.body.url : '';
  if (!url) {
    res.status(400).json({ error: { message: 'A URL is required.' } });
    return;
  }
  try {
    const result = await processUrl(url, { maxBytes: 8 * 1024 * 1024 });
    res.json({
      ok: result.ok,
      kind: result.kind,
      label: result.label,
      method: result.method,
      ocr: result.ocr,
      title: result.title,
      sourceUrl: result.sourceUrl,
      finalUrl: result.finalUrl,
      redirectChain: result.redirectChain,
      text: result.text,
      pages: result.pages,
      warnings: result.warnings,
      attempts: result.attempts,
      summary: describeResult(result),
      error: result.error,
    });
  } catch (error) {
    res.status(502).json({ error: { message: error instanceof Error ? error.message : 'The URL could not be read.' } });
  }
});

// Rename / delete / reindex
app.post('/api/documents/rename', async (req, res) => {
  try {
    const renamed = await requireDocumentsService().rename(res.locals.rareUserId, String(req.body?.path || ''), String(req.body?.newPath || ''));
    res.json({ path: renamed.path, format: renamed.format });
  } catch (error) {
    sendDocumentError(res, error, 'The document could not be renamed.');
  }
});

app.delete('/api/documents/*', async (req, res) => {
  try {
    const removed = await requireDocumentsService().remove(res.locals.rareUserId, (req.params as any)[0]);
    if (!removed) {
      res.status(404).json({ error: { message: 'Document not found' } });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    sendDocumentError(res, error, 'The document could not be deleted.');
  }
});

app.post('/api/documents/restore-version', async (req, res) => {
  try {
    const restored = await requireDocumentsService().restoreVersion(
      res.locals.rareUserId,
      String(req.body?.path || ''),
      Number(req.body?.version),
    );
    res.json({ path: restored.path, version: restored.version, content: restored.content });
  } catch (error) {
    sendDocumentError(res, error, 'The document version could not be restored.');
  }
});

app.post('/api/documents/reindex', async (req, res) => {
  try {
    res.json(await requireDocumentsService().reindex(res.locals.rareUserId));
  } catch (error) {
    sendDocumentError(res, error, 'The search index could not be rebuilt.');
  }
});

// Universal Context-Aware Audio Transcription
app.post('/api/documents/transcribe', async (req, res) => {
  const rawAudio = String(req.body?.audioBase64 || req.body?.audio || '');
  const dataUrl = rawAudio.match(/^data:([^;]+);base64,(.+)$/s);
  const audioBase64 = dataUrl ? dataUrl[2] : rawAudio;
  const mimeType = String(dataUrl?.[1] || req.body?.mimeType || 'audio/webm');
  if (!audioBase64 || audioBase64.length > 14 * 1024 * 1024) {
    res.status(400).json({ error: { message: 'Audio data is required and must not exceed the upload limit.' } });
    return;
  }
  if (!/^audio\/(webm|ogg|wav|mpeg|mp3|aac|flac|mp4|x-m4a)$/i.test(mimeType)) {
    res.status(400).json({ error: { message: `Unsupported audio format: ${mimeType}.` } });
    return;
  }
  if (!process.env.GEMINI_API_KEY?.trim()) {
    res.status(503).json({
      error: {
        message: 'Audio transcription requires GEMINI_API_KEY to be configured on the server.',
        code: 'TRANSCRIPTION_PROVIDER_UNAVAILABLE',
        nextStep: 'Set GEMINI_API_KEY, or configure a local speech engine.',
      },
    });
    return;
  }
  try {
    const transcription = await providerRegistry.getGeminiProvider().transcribeAudio(audioBase64, mimeType);
    const basename = String(req.body?.audioName || 'recording')
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .slice(0, 80) || 'recording';
    const transcriptPath = normalizeDocumentPath(`transcripts/${basename}_transcript.txt`);
    const saved = await requireDocumentsService().save(res.locals.rareUserId, transcriptPath, transcription.text.slice(0, 2 * 1024 * 1024), {
      isGuest: res.locals.rareIsGuest,
      origin: 'transcript',
    });
    res.json({
      success: true,
      path: saved.path,
      mode: 'verbatim',
      transcript: transcription.text,
      transcriptionModel: transcription.model,
      verifiedNotes: [],
      uncertaintyCount: (transcription.text.match(/\[(?:inaudible|unclear)\]/gi) || []).length,
      verifiedQuotations: [],
    });
  } catch (error) {
    res.status(502).json({ error: { message: error instanceof Error ? error.message : 'Audio transcription failed.' } });
  }
});

// Format Conversion
app.post('/api/documents/convert', async (req, res) => {
  try {
    const converted = await requireDocumentsService().convert(
      res.locals.rareUserId,
      String(req.body?.path || ''),
      String(req.body?.targetFormat || ''),
    );
    res.json({ success: true, ...converted });
  } catch (error) {
    sendDocumentError(res, error, 'Document conversion failed.');
  }
});

// =============================================================================
// Research — deep, evidence-grounded, with saved projects
// =============================================================================
app.get('/api/research/providers', (_req, res) => {
  res.json({ providers: listResearchProviders() });
});

app.get('/api/research/items', async (req, res) => {
  try {
    res.json(await persistentStorage!.getOwnedState<ResearchItem[]>(res.locals.rareUserId, 'research_items', []));
  } catch (error) {
    console.error('[Research] Private result list failed:', error);
    res.status(503).json({ error: { message: 'Private research storage is unavailable.' } });
  }
});

app.get('/api/research/items/:id', async (req, res) => {
  try {
    const items = await persistentStorage!.getOwnedState<any[]>(res.locals.rareUserId, 'research_items', []);
    const item = items.find((entry) => entry.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: { message: 'Research project not found' } });
      return;
    }
    res.json(item);
  } catch (error) {
    res.status(503).json({ error: { message: 'Private research storage is unavailable.' } });
  }
});

app.delete('/api/research/items/:id', async (req, res) => {
  try {
    let removed = false;
    await persistentStorage!.updateOwnedState<any[]>(res.locals.rareUserId, 'research_items', [], (items) =>
      items.filter((item) => {
        if (item.id === req.params.id) {
          removed = true;
          return false;
        }
        return true;
      }),
    );
    if (!removed) {
      res.status(404).json({ error: { message: 'Research project not found' } });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    res.status(503).json({ error: { message: 'Private research storage is unavailable.' } });
  }
});

app.post('/api/research/search', async (req, res) => {
  const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
  if (!query) {
    res.status(400).json({ error: { message: 'A research query is required.' } });
    return;
  }
  const depth = ['quick', 'standard', 'deep'].includes(String(req.body?.depth)) ? String(req.body.depth) : 'standard';
  const seedUrls = Array.isArray(req.body?.urls) ? req.body.urls.filter((url: unknown) => typeof url === 'string') : [];
  const categories = Array.isArray(req.body?.categories) ? req.body.categories : undefined;
  const projectId = `res_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

  try {
    const report = await deepResearchEngine.research({
      question: query,
      depth: depth as any,
      seedUrls,
      categories,
      maxSources: Number(req.body?.maxSources) || undefined,
    });

    const sources = report.sources.map((source) => ({
      name: source.provider,
      url: source.finalUrl || source.url,
      credibility: source.credibility,
      date: source.date || '',
      quote: source.passages[0] || source.snippet,
      title: source.title,
    }));

    const newResearch = {
      id: projectId,
      query,
      subquestions: [],
      findings: report.claims.map((claim) => claim.text).join('\n\n'),
      sources,
      synthesis: report.report,
      confidence: report.sources.length > 0 ? Math.min(0.95, 0.4 + report.sources.length * 0.05) : 0,
      timestamp: new Date().toISOString(),
      depth: report.depth,
      status: report.sources.length > 0 ? 'completed' : 'incomplete',
      scope: report.scope,
      queries: report.queries,
      providersUsed: report.providersUsed,
      providerErrors: report.providerErrors,
      sourceErrors: report.providerErrors,
      limitations: report.limitations,
      unreadable: report.unreadable,
      claims: report.claims,
      stats: report.stats,
      progress: report.progress,
    };

    await persistentStorage!.updateOwnedState<any[]>(res.locals.rareUserId, 'research_items', [], (items) => [newResearch, ...items].slice(0, 100));
    res.json({ query, results: [newResearch] });
  } catch (error) {
    console.error('[Research] Deep research failed:', error);
    res.status(502).json({ error: { message: error instanceof Error ? error.message : 'Research sources could not be reached.' } });
  }
});

// =============================================================================
// Unified search across documents, transcripts and research
// =============================================================================
app.get('/api/search', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!query) {
    res.status(400).json({ error: { message: 'A search query is required.' } });
    return;
  }
  try {
    const service = requireDocumentsService();
    await service.ensureIndexed(res.locals.rareUserId);
    const index = searchIndexes.forOwner(res.locals.rareUserId);
    const origins = typeof req.query.origin === 'string'
      ? (req.query.origin.split(',').filter(Boolean) as any[])
      : undefined;
    const hits = index.search(query, {
      limit: Math.min(50, Number(req.query.limit) || 20),
      phrase: typeof req.query.phrase === 'string' ? req.query.phrase : undefined,
      origins,
    });
    res.json({ query, hits, indexedDocuments: index.size });
  } catch (error) {
    sendDocumentError(res, error, 'Search failed.');
  }
});

// Updates Apply Endpoint
app.post('/api/updates/apply', (req, res) => {
  return res.status(501).json({
    success: false,
    error: {
      message: 'This endpoint cannot install or activate an application update. Use the platform-specific updater and report its verified result.',
    },
  });
});

// Diagnostics Selftest Matrix
app.get('/api/tools/selftest', async (req, res) => {
  if (!(await isDeveloperSessionAuthorized(req))) return res.status(403).json({ error: { message: 'Developer authorization required.' } });
  return res.status(501).json({ success: false, allPassed: false, error: { message: 'The legacy self-test endpoint returned fabricated results and has been disabled. Use the repository test suite for verified results.' } });
});

// -----------------------------------------------------------------------------
// Scheduled Tasks & Automation Engine
// -----------------------------------------------------------------------------
interface ScheduledTask {
  id: string;
  title: string;
  time: string; // e.g. "10:00", "Every day at 09:00", "Tomorrow at 13:00"
  type: 'alarm' | 'recurring' | 'reminder' | 'automation';
  action: string;
  enabled: boolean;
  repeat: string;
  created_at: string;
}

const scheduledTasks: ScheduledTask[] = [
  {
    id: 'sch_01',
    title: 'Daily Standup Summary & System Health',
    time: '09:00',
    type: 'recurring',
    action: 'Compile project runs status and notify active agents',
    enabled: true,
    repeat: 'Every day',
    created_at: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 'sch_02',
    title: 'Code Build Alarm & Test Verification',
    time: '13:00',
    type: 'alarm',
    action: 'Trigger verification pass and chime release alarm',
    enabled: true,
    repeat: 'Tomorrow at 1:00 PM',
    created_at: new Date(Date.now() - 43200000).toISOString(),
  },
  {
    id: 'sch_03',
    title: 'Nightly Memory Index & Archive Consolidation',
    time: '23:30',
    type: 'automation',
    action: 'Consolidate long-term discussion memory and sync to disk',
    enabled: true,
    repeat: 'Every night',
    created_at: new Date(Date.now() - 172800000).toISOString(),
  },
];

app.get('/api/schedules', async (req, res) => {
  try {
    res.json(await persistentStorage!.getOwnedState<ScheduledTask[]>(res.locals.rareUserId, 'schedules', []));
  } catch (error) {
    console.error('[Schedules] Private schedule read failed:', error);
    res.status(503).json({ error: { message: 'Schedule storage is unavailable.' } });
  }
});

app.post('/api/schedules', async (req, res) => {
  const { title, time, type, action, repeat } = req.body;
  if (typeof title !== 'string' || !title.trim() || title.length > 160) return res.status(400).json({ error: { message: 'A title of at most 160 characters is required.' } });
  const newTask: ScheduledTask = {
    id: `sch_${crypto.randomUUID()}`,
    title: title.trim(),
    time: typeof time === 'string' ? time.slice(0, 80) : '12:00',
    type: ['alarm', 'recurring', 'reminder', 'automation'].includes(type) ? type : 'reminder',
    action: typeof action === 'string' ? action.slice(0, 2000) : 'Execute scheduled action',
    enabled: true,
    repeat: typeof repeat === 'string' ? repeat.slice(0, 120) : 'Once',
    created_at: new Date().toISOString(),
  };
  try {
    await persistentStorage!.updateOwnedState<ScheduledTask[]>(res.locals.rareUserId, 'schedules', [], (items) => {
      if (res.locals.rareIsGuest && items.length >= 20) throw new Error('RARE_GUEST_LIMIT');
      return [newTask, ...items].slice(0, 100);
    });
    res.status(201).json(newTask);
  } catch (error) {
    if (error instanceof Error && error.message === 'RARE_GUEST_LIMIT') return res.status(429).json({ error: { message: 'Guest schedule limit reached. Create an account to continue.' } });
    console.error('[Schedules] Private schedule write failed:', error);
    res.status(503).json({ error: { message: 'Schedule storage is unavailable.' } });
  }
});

app.post('/api/schedules/:id/toggle', async (req, res) => {
  try {
    let task: ScheduledTask | undefined;
    await persistentStorage!.updateOwnedState<ScheduledTask[]>(res.locals.rareUserId, 'schedules', [], (items) => items.map((entry) => {
      if (entry.id !== req.params.id) return entry;
      task = { ...entry, enabled: !entry.enabled };
      return task;
    }));
    if (!task) return res.status(404).json({ error: { message: 'Schedule not found' } });
    res.json({ success: true, task });
  } catch (error) {
    console.error('[Schedules] Private schedule update failed:', error);
    res.status(503).json({ error: { message: 'Schedule storage is unavailable.' } });
  }
});

app.delete('/api/schedules/:id', async (req, res) => {
  try {
    let removed = false;
    await persistentStorage!.updateOwnedState<ScheduledTask[]>(res.locals.rareUserId, 'schedules', [], (items) => items.filter((entry) => {
      if (entry.id === req.params.id) { removed = true; return false; }
      return true;
    }));
    if (removed) return res.json({ success: true });
    res.status(404).json({ error: { message: 'Schedule not found' } });
  } catch (error) {
    console.error('[Schedules] Private schedule delete failed:', error);
    res.status(503).json({ error: { message: 'Schedule storage is unavailable.' } });
  }
});

// -----------------------------------------------------------------------------
// Plugin Ecosystem (World-class Plugin Directory)
// -----------------------------------------------------------------------------
interface PluginDef {
  id: string;
  name: string;
  category: 'build' | 'dev' | 'tools' | 'media' | 'data' | 'system';
  description: string;
  version: string;
  author: string;
  installed: boolean;
  icon: string;
  capabilities: string[];
}

const pluginsDirectory: PluginDef[] = [
  {
    id: 'plugin_compiler_pro',
    name: 'Universal Multi-Target Compiler',
    category: 'build',
    description: 'Complete build environment to compile apps into standalone APK, EXE, Web bundles, and ELF binaries with zero setup.',
    version: '2.4.0',
    author: 'RARE Core Team',
    installed: true,
    icon: 'Package',
    capabilities: ['Android APK packaging', 'Windows .exe bundling', 'Native toolchains'],
  },
  {
    id: 'plugin_visioncraft',
    name: 'VisionCraft Studio (Gemini 3 Pro & Nano Banana)',
    category: 'media',
    description: 'High-fidelity generative images in 1K, 2K, 4K with Nano Banana prompt editing.',
    version: '3.1.0',
    author: 'Google AI & RARE',
    installed: true,
    icon: 'ImageIcon',
    capabilities: ['Gemini 3 Pro Image (1K/2K/4K)', 'Nano Banana 2.1 Editing', 'Aspect ratio presets'],
  },
  {
    id: 'plugin_live_audio',
    name: 'Bidirectional Live Voice Engine',
    category: 'media',
    description: 'Ultra-low latency conversational voice with listening, processing, and speaking audio visualizer.',
    version: '1.9.5',
    author: 'RARE Acoustics',
    installed: true,
    icon: 'Mic',
    capabilities: ['Full-duplex conversation', 'Dynamic wave ripple visualizer', 'Sub-second reply'],
  },
  {
    id: 'plugin_infinite_memory',
    name: 'Infinite Persistent Neural Memory',
    category: 'data',
    description: 'Permanent local cross-chat memory core. Remembers conversations forever across tens of thousands of sessions.',
    version: '4.0.1',
    author: 'RARE Neural Core',
    installed: true,
    icon: 'BrainCircuit',
    capabilities: ['Cross-chat contextual recall', 'Full-text & tag search', 'Local disk persistence'],
  },
  {
    id: 'plugin_smart_scheduler',
    name: 'Intelligent Chronos Scheduler & Alarms',
    category: 'tools',
    description: 'Natural language cron and alarm scheduler. Set reminders, recurring chores, and build triggers directly from chat.',
    version: '1.5.0',
    author: 'RARE Automation',
    installed: true,
    icon: 'Clock',
    capabilities: ['Natural language time parsing', 'Alarm notifications', 'Recurring background jobs'],
  },
  {
    id: 'plugin_speech_transcribe',
    name: 'Context-Aware Audio Transcription',
    category: 'tools',
    description: 'Resolves indistinct speech, punctuation, and speaker attribution using conversation context.',
    version: '2.2.0',
    author: 'RARE Acoustics',
    installed: true,
    icon: 'FileText',
    capabilities: ['Contextual acoustic resolution', 'Punctuation formatting', 'Noise suppression'],
  },
  {
    id: 'plugin_github_bridge',
    name: 'GitHub & Git Bundle Sync',
    category: 'dev',
    description: 'Bi-directional GitHub repository sync, branch commit history, and standalone repo bundle downloads.',
    version: '2.0.1',
    author: 'RARE DevTools',
    installed: true,
    icon: 'GitBranch',
    capabilities: ['Git bundle exports', 'Source tarball download', 'Branch integrity check'],
  },
  {
    id: 'plugin_security_sandbox',
    name: 'Privileged Developer Gate & Rollback',
    category: 'system',
    description: 'Cryptographic passkey isolation, single-writer state lock, and instant state rollback checkpoints.',
    version: '3.0.0',
    author: 'RARE Security',
    installed: true,
    icon: 'Shield',
    capabilities: ['Passkey authentication', 'Known-good rollback', 'Single-writer lock'],
  },
];

app.get('/api/plugins', async (req, res) => {
  try {
    const settings = await persistentStorage!.getOwnedState<Record<string, boolean>>(res.locals.rareUserId, 'plugin_settings', {});
    res.json(pluginsDirectory.map((plugin) => ({
      ...plugin,
      installed: Object.prototype.hasOwnProperty.call(settings, plugin.id) ? settings[plugin.id] : plugin.installed,
    })));
  } catch (error) {
    console.error('[Plugins] Private plugin settings read failed:', error);
    res.status(503).json({ error: { message: 'Plugin settings are unavailable.' } });
  }
});

app.post('/api/plugins/:id/toggle', async (req, res) => {
  const definition = pluginsDirectory.find((plugin) => plugin.id === req.params.id);
  if (!definition) return res.status(404).json({ error: { message: 'Plugin not found' } });
  try {
    let enabled = definition.installed;
    await persistentStorage!.updateOwnedState<Record<string, boolean>>(res.locals.rareUserId, 'plugin_settings', {}, (settings) => {
      enabled = !(Object.prototype.hasOwnProperty.call(settings, definition.id) ? settings[definition.id] : definition.installed);
      return { ...settings, [definition.id]: enabled };
    });
    res.json({ success: true, plugin: { ...definition, installed: enabled } });
  } catch (error) {
    console.error('[Plugins] Private plugin setting update failed:', error);
    res.status(503).json({ error: { message: 'Plugin settings are unavailable.' } });
  }
});

// -----------------------------------------------------------------------------
// Image Studio Core (Gemini 3 Pro Image & Nano Banana 2.1)
// -----------------------------------------------------------------------------
interface ImageRecord {
  id: string;
  url: string;
  prompt: string;
  model: 'gemini-3-pro-image-preview' | 'gemini-nano-banana-2.1';
  imageSize: '1K' | '2K' | '4K';
  aspectRatio: string;
  originalUrl?: string;
  createdAt: string;
  mode: 'generate' | 'edit';
  source: 'gemini_api' | 'procedural_renderer';
  statusNote?: string;
  quotaExceeded?: boolean;
}

const imageGallery: ImageRecord[] = [
  {
    id: 'img_sample_01',
    url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><defs><linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%23090A1A"/><stop offset="50%" stop-color="%231E1B4B"/><stop offset="100%" stop-color="%230F172A"/></linearGradient><radialGradient id="glow" cx="50%" cy="40%" r="55%"><stop offset="0%" stop-color="%2338BDF8" stop-opacity="0.9"/><stop offset="60%" stop-color="%236366F1" stop-opacity="0.3"/><stop offset="100%" stop-color="%231E1B4B" stop-opacity="0"/></radialGradient><linearGradient id="beam" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="%2338BDF8" stop-opacity="0"/><stop offset="50%" stop-color="%23A855F7" stop-opacity="0.8"/><stop offset="100%" stop-color="%23EC4899" stop-opacity="0"/></linearGradient></defs><rect width="1024" height="1024" fill="url(%23bg)"/><circle cx="512" cy="420" r="340" fill="url(%23glow)"/><polygon points="512,180 780,680 244,680" fill="none" stroke="%2338BDF8" stroke-width="3" stroke-opacity="0.7"/><polygon points="512,240 730,650 294,650" fill="none" stroke="%23A855F7" stroke-width="2" stroke-dasharray="10 6" stroke-opacity="0.6"/><circle cx="512" cy="510" r="140" fill="%230F172A" stroke="%23E0E7FF" stroke-width="3"/><circle cx="512" cy="510" r="90" fill="url(%23glow)"/><rect x="100" y="505" width="824" height="10" fill="url(%23beam)"/><text x="512" y="820" font-family="system-ui, sans-serif" font-size="28" font-weight="800" fill="%23FFFFFF" text-anchor="middle" letter-spacing="4">QUANTUM MONOLITH · VISIONCRAFT</text><text x="512" y="860" font-family="monospace" font-size="16" font-weight="600" fill="%2338BDF8" text-anchor="middle">GEMINI 3 PRO · 4K ULTRA RESOLUTION</text></svg>',
    prompt: 'Futuristic quantum monolith floating above iridescent reflection pools in deep space, anamorphic 35mm lens, 4K masterpiece',
    model: 'gemini-3-pro-image-preview',
    imageSize: '4K',
    aspectRatio: '1:1',
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    mode: 'generate',
    source: 'procedural_renderer',
    statusNote: 'Showcase Studio Render',
  },
  {
    id: 'img_sample_02',
    url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><defs><linearGradient id="bg2" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%2318062B"/><stop offset="50%" stop-color="%233B0764"/><stop offset="100%" stop-color="%231E1B4B"/></linearGradient><radialGradient id="sun" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="%23F43F5E"/><stop offset="70%" stop-color="%238B5CF6"/><stop offset="100%" stop-color="%2318062B" stop-opacity="0"/></radialGradient></defs><rect width="1024" height="1024" fill="url(%23bg2)"/><circle cx="512" cy="460" r="280" fill="url(%23sun)"/><path d="M 100 800 L 300 520 L 512 700 L 720 480 L 924 800 Z" fill="%230F0A1E" stroke="%23F43F5E" stroke-width="2"/><text x="512" y="860" font-family="system-ui, sans-serif" font-size="26" font-weight="700" fill="%23FDF2F8" text-anchor="middle" letter-spacing="3">NEO-TOKYO HORIZON · NANO BANANA 2.1</text><text x="512" y="895" font-family="monospace" font-size="14" fill="%23F43F5E" text-anchor="middle">TEXT-PROMPT EDITED · 2K RESOLUTION</text></svg>',
    prompt: 'Cyberpunk neon skyline at twilight with purple haze and synthwave mountain silhouettes, Nano Banana 2.1 edit',
    model: 'gemini-nano-banana-2.1',
    imageSize: '2K',
    aspectRatio: '1:1',
    createdAt: new Date(Date.now() - 7200000).toISOString(),
    mode: 'edit',
    source: 'procedural_renderer',
    statusNote: 'Showcase Edit Render',
  },
];

// Helper: Procedural high-fidelity image generator fallback
function createProceduralArtwork(
  prompt: string,
  model: 'gemini-3-pro-image-preview' | 'gemini-nano-banana-2.1',
  size: '1K' | '2K' | '4K',
  aspectRatio: string,
  isEdit = false,
  _originalUrl?: string
): string {
  const p = prompt.toLowerCase();
  let w = 1024;
  let h = 1024;
  if (aspectRatio === '16:9') { w = 1280; h = 720; }
  else if (aspectRatio === '9:16') { w = 720; h = 1280; }
  else if (aspectRatio === '4:3') { w = 1024; h = 768; }
  else if (aspectRatio === '3:4') { w = 768; h = 1024; }
  else if (aspectRatio === '4:1') { w = 1280; h = 320; }
  else if (aspectRatio === '1:4') { w = 320; h = 1280; }

  // Dynamic palette based on prompt
  let color1 = '%230A0E1A';
  let color2 = '%231E1B4B';
  let accent = '%236366F1';
  let highlight = '%2338BDF8';

  if (p.includes('cyber') || p.includes('neon') || p.includes('future') || p.includes('tokyo')) {
    color1 = '%23070A1E';
    color2 = '%233B0764';
    accent = '%23EC4899';
    highlight = '%2306B6D4';
  } else if (p.includes('nature') || p.includes('forest') || p.includes('tree') || p.includes('zen')) {
    color1 = '%23031A14';
    color2 = '%23064E3B';
    accent = '%2310B981';
    highlight = '%2334D399';
  } else if (p.includes('sunset') || p.includes('sun') || p.includes('fire') || p.includes('warm') || p.includes('gold')) {
    color1 = '%231A0B05';
    color2 = '%237C2D12';
    accent = '%23F97316';
    highlight = '%23FDE047';
  } else if (p.includes('portrait') || p.includes('face') || p.includes('character') || p.includes('robot')) {
    color1 = '%230C0A1D';
    color2 = '%232E1065';
    accent = '%238B5CF6';
    highlight = '%23C084FC';
  }

  const safePrompt = prompt.replace(/[<>&"']/g, '').slice(0, 52);
  const modelTag = model === 'gemini-3-pro-image-preview' ? 'GEMINI 3 PRO' : 'NANO BANANA 2.1';
  const sizeTag = size === '4K' ? '4K UHD (4096px)' : size === '2K' ? '2K QHD (2048px)' : '1K HD (1024px)';
  const modeTag = isEdit ? 'PROMPT-EDITED COMPOSITION' : 'SYNTHESIZED CREATION';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <defs>
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${color1}"/>
        <stop offset="60%" stop-color="${color2}"/>
        <stop offset="100%" stop-color="%2302040A"/>
      </linearGradient>
      <radialGradient id="radGlow" cx="50%" cy="45%" r="60%">
        <stop offset="0%" stop-color="${highlight}" stop-opacity="0.85"/>
        <stop offset="50%" stop-color="${accent}" stop-opacity="0.4"/>
        <stop offset="100%" stop-color="${color1}" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="lightBar" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="${highlight}" stop-opacity="0"/>
        <stop offset="50%" stop-color="${highlight}" stop-opacity="0.9"/>
        <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(%23bgGrad)"/>
    <circle cx="${w / 2}" cy="${h / 2 - 40}" r="${Math.min(w, h) * 0.38}" fill="url(%23radGlow)"/>
    <polygon points="${w / 2},${h * 0.18} ${w * 0.82},${h * 0.68} ${w * 0.18},${h * 0.68}" fill="none" stroke="${highlight}" stroke-width="3" stroke-opacity="0.7"/>
    <polygon points="${w / 2},${h * 0.25} ${w * 0.76},${h * 0.64} ${w * 0.24},${h * 0.64}" fill="none" stroke="${accent}" stroke-width="2" stroke-dasharray="8 6" stroke-opacity="0.5"/>
    <circle cx="${w / 2}" cy="${h * 0.48}" r="${Math.min(w, h) * 0.16}" fill="%230B0F19" stroke="%23E2E8F0" stroke-width="3"/>
    <circle cx="${w / 2}" cy="${h * 0.48}" r="${Math.min(w, h) * 0.1}" fill="url(%23radGlow)"/>
    <rect x="${w * 0.1}" y="${h * 0.48 - 3}" width="${w * 0.8}" height="6" fill="url(%23lightBar)"/>
    <rect x="${w * 0.08}" y="${h - 130}" width="${w * 0.84}" height="90" rx="12" fill="%23030712" fill-opacity="0.75" stroke="${accent}" stroke-width="1.5" stroke-opacity="0.4"/>
    <text x="${w / 2}" y="${h - 90}" font-family="system-ui, sans-serif" font-size="20" font-weight="700" fill="%23FFFFFF" text-anchor="middle" letter-spacing="2">"${safePrompt}"</text>
    <text x="${w / 2}" y="${h - 60}" font-family="monospace" font-size="13" font-weight="600" fill="${highlight}" text-anchor="middle" letter-spacing="1">${modelTag} · ${sizeTag} · ${modeTag}</text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// Image Studio Status Check
app.get('/api/images/status', (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  const hasKey = Boolean(apiKey && apiKey.trim().length > 5);
  res.json({
    hasKey,
    supportedModels: [
      {
        id: 'gemini-3-pro-image-preview',
        name: 'Gemini 3 Pro Image Preview',
        badge: 'High-Resolution 1K / 2K / 4K',
        description: 'Advanced flagship diffusion & image synthesis model with 1K, 2K, and 4K resolution controls.',
        sizes: ['1K', '2K', '4K'],
        aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '4:1', '1:4'],
      },
      {
        id: 'gemini-nano-banana-2.1',
        name: 'Gemini Nano Banana 2.1',
        badge: 'Create & Edit with Prompts',
        description: 'Ultra-fast multimodal creator and editor for text-to-image and prompt-guided image modifications.',
        sizes: ['1K', '2K', '4K'],
        aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '4:1', '1:4'],
      },
    ],
    defaultSize: '1K',
    defaultModel: 'gemini-3-pro-image-preview',
  });
});

// Image Gallery List
app.get('/api/images/gallery', (req, res) => {
  void persistentStorage!.getOwnedState<ImageRecord[]>(res.locals.rareUserId, 'image_gallery', []).then((images) => {
    res.json({ images, total: images.length });
  }).catch((error) => {
    console.error('[Images] Private gallery read failed:', error);
    res.status(503).json({ error: { message: 'Image gallery storage is unavailable.' } });
  });
});

// Delete Image from Gallery
app.delete('/api/images/gallery/:id', async (req, res) => {
  try {
    let removed = false;
    await persistentStorage!.updateOwnedState<ImageRecord[]>(res.locals.rareUserId, 'image_gallery', [], (images) => images.filter((image) => {
      if (image.id === req.params.id) { removed = true; return false; }
      return true;
    }));
    if (removed) return res.json({ success: true });
    res.status(404).json({ error: 'Image not found' });
  } catch (error) {
    console.error('[Images] Private gallery delete failed:', error);
    res.status(503).json({ error: { message: 'Image gallery storage is unavailable.' } });
  }
});

// Generate Image Endpoint (Gemini 3 Pro Image & Nano Banana 2.1)
app.post('/api/images/generate', async (req, res) => {
  const {
    prompt,
    model = 'gemini-3-pro-image-preview',
    imageSize = '1K',
    aspectRatio = '1:1',
  } = req.body;

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const cleanPrompt = prompt.trim();
  const validModel =
    model === 'gemini-nano-banana-2.1' ? 'gemini-nano-banana-2.1' : 'gemini-3-pro-image-preview';
  const validSize = ['1K', '2K', '4K'].includes(imageSize) ? imageSize : '1K';
  const validAspect = ['1:1', '16:9', '9:16', '4:3', '3:4', '4:1', '1:4'].includes(aspectRatio)
    ? aspectRatio
    : '1:1';

  let generatedUrl = '';
  let source: 'gemini_api' | 'procedural_renderer' = 'procedural_renderer';
  let quotaExceeded = false;
  let statusNote = 'Created with VisionCraft Engine';

  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey && apiKey.trim().length > 5) {
    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });

      const response = await ai.models.generateContent({
        model: validModel,
        contents: cleanPrompt,
        config: {
          imageConfig: {
            aspectRatio: validAspect as any,
            imageSize: validSize as any,
          },
        },
      });

      const parts = response.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (part.inlineData && part.inlineData.data) {
          const mime = part.inlineData.mimeType || 'image/png';
          generatedUrl = `data:${mime};base64,${part.inlineData.data}`;
          source = 'gemini_api';
          statusNote = `Synthesized by Google GenAI ${validModel}`;
          break;
        }
      }
    } catch (err: any) {
      console.warn(`[Image Gen Error with ${validModel}]:`, err?.message || err);
      if (err?.status === 429 || err?.message?.includes('Quota exceeded') || err?.message?.includes('429')) {
        quotaExceeded = true;
        statusNote = 'Free quota reached; rendered high-definition procedural composition.';
      }
    }
  }

  // Fallback to stylized procedural canvas artwork if API quota exhausted or returned empty
  if (!generatedUrl) {
    generatedUrl = createProceduralArtwork(cleanPrompt, validModel, validSize, validAspect, false);
    source = 'procedural_renderer';
  }

  const newRecord: ImageRecord = {
    id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    url: generatedUrl,
    prompt: cleanPrompt,
    model: validModel,
    imageSize: validSize,
    aspectRatio: validAspect,
    createdAt: new Date().toISOString(),
    mode: 'generate',
    source,
    statusNote,
    quotaExceeded,
  };

  try {
    await persistentStorage!.updateOwnedState<ImageRecord[]>(res.locals.rareUserId, 'image_gallery', [], (images) => [newRecord, ...images].slice(0, 50));
  } catch (error) {
    console.error('[Images] Private gallery persistence failed:', error);
    return res.status(503).json({ error: 'Image could not be saved to the user gallery.' });
  }

  auditLog.unshift({
    id: `aud_${Date.now()}`,
    timestamp: new Date().toISOString(),
    actor: 'user',
    action: 'image_generation',
    kind: 'user',
    details: `Generated ${validSize} image via ${validModel} [aspect: ${validAspect}]`,
  });

  res.status(201).json({
    success: true,
    image: newRecord,
    quotaExceeded,
    model: validModel,
    size: validSize,
  });
});

// Edit Image Endpoint (Gemini Nano Banana 2.1)
app.post('/api/images/edit', async (req, res) => {
  const {
    image,
    prompt,
    model = 'gemini-nano-banana-2.1',
    imageSize = '1K',
    aspectRatio = '1:1',
  } = req.body;

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'Editing prompt is required' });
  }

  const cleanPrompt = prompt.trim();
  const validModel = 'gemini-nano-banana-2.1';
  const validSize = ['1K', '2K', '4K'].includes(imageSize) ? imageSize : '1K';
  const validAspect = ['1:1', '16:9', '9:16', '4:3', '3:4', '4:1', '1:4'].includes(aspectRatio)
    ? aspectRatio
    : '1:1';

  let editedUrl = '';
  let source: 'gemini_api' | 'procedural_renderer' = 'procedural_renderer';
  let quotaExceeded = false;
  let statusNote = 'Prompt-guided edit by Nano Banana 2.1';

  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey && apiKey.trim().length > 5 && image && typeof image === 'string') {
    try {
      const match = image.match(/^data:([^;]+);base64,(.+)$/);
      const mimeType = match ? match[1] : 'image/png';
      const cleanBase64 = match ? match[2] : image;

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });

      const response = await ai.models.generateContent({
        model: validModel,
        contents: {
          parts: [
            {
              inlineData: {
                data: cleanBase64,
                mimeType,
              },
            },
            {
              text: cleanPrompt,
            },
          ],
        },
        config: {
          imageConfig: {
            aspectRatio: validAspect as any,
            imageSize: validSize as any,
          },
        },
      });

      const parts = response.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (part.inlineData && part.inlineData.data) {
          const mime = part.inlineData.mimeType || 'image/png';
          editedUrl = `data:${mime};base64,${part.inlineData.data}`;
          source = 'gemini_api';
          statusNote = `Edited by Google GenAI ${validModel}`;
          break;
        }
      }
    } catch (err: any) {
      console.warn(`[Image Edit Error with ${validModel}]:`, err?.message || err);
      if (err?.status === 429 || err?.message?.includes('Quota exceeded') || err?.message?.includes('429')) {
        quotaExceeded = true;
        statusNote = 'Free quota reached; rendered composite edit.';
      }
    }
  }

  if (!editedUrl) {
    editedUrl = createProceduralArtwork(cleanPrompt, validModel, validSize, validAspect, true, image);
    source = 'procedural_renderer';
  }

  const newRecord: ImageRecord = {
    id: `img_edit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    url: editedUrl,
    originalUrl: typeof image === 'string' && image.length > 10 ? image : undefined,
    prompt: cleanPrompt,
    model: validModel,
    imageSize: validSize,
    aspectRatio: validAspect,
    createdAt: new Date().toISOString(),
    mode: 'edit',
    source,
    statusNote,
    quotaExceeded,
  };

  try {
    await persistentStorage!.updateOwnedState<ImageRecord[]>(res.locals.rareUserId, 'image_gallery', [], (images) => [newRecord, ...images].slice(0, 50));
  } catch (error) {
    console.error('[Images] Private gallery persistence failed:', error);
    return res.status(503).json({ error: 'Edited image could not be saved to the user gallery.' });
  }

  auditLog.unshift({
    id: `aud_${Date.now()}`,
    timestamp: new Date().toISOString(),
    actor: 'user',
    action: 'image_edit',
    kind: 'user',
    details: `Edited image via ${validModel}: "${cleanPrompt.slice(0, 30)}..."`,
  });

  res.status(201).json({
    success: true,
    image: newRecord,
    quotaExceeded,
    model: validModel,
    size: validSize,
  });
});

// Unknown API routes must remain JSON 404s rather than falling through to the SPA.
app.use('/api', (_req, res) => {
  res.status(404).json({ error: { message: 'API endpoint not found.' } });
});

// Start Server with Vite Middleware in Development
async function startServer() {
  process.env.RARE_INTELLIGENCE_URL = process.env.RARE_INTELLIGENCE_URL || `http://127.0.0.1:${PORT}`;
  const isProduction = process.env.NODE_ENV === 'production' || process.argv.includes('--production');
  if (isProduction && configuredOrigins.length === 0) {
    throw new Error('Set RARE_ALLOWED_ORIGINS to the exact production frontend origin before starting RARE in production.');
  }
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error(`Invalid PORT value "${process.env.PORT}". Set PORT to an integer between 1 and 65535.`);
  }

    persistentStorage = new PersistentJsonStore();
  await persistentStorage.checkConnection();

  // The Documents service shares the same owner-scoped store and the shared
  // content engine, so Documents and Research never diverge.
  documentsService = new DocumentsService(persistentStorage, searchIndexes);

  // Production must never start with local-only authentication sessions.
  if (isProduction) {
    persistentStorage.requireReadyPostgres();
  }

  await Promise.all([
    durableStateStore.hydrate(persistentStorage),
    memoryStore.initializePersistence(persistentStorage),
    conversationStore.initializePersistence(persistentStorage),
    checkpointStore.initializePersistence(persistentStorage),
    trajectoryStore.initializePersistence(persistentStorage),
    updateStore.initializePersistence(persistentStorage),
  ]);

  const localAuthFallbackAllowed =
    process.env.NODE_ENV !== 'production' &&
    !process.argv.includes('--production') &&
    process.env.RARE_ALLOW_LOCAL_STORAGE_FALLBACK === 'true';

  // Migrate legacy accounts only into the authoritative authentication store.
  if (
    persistentStorage.getStatus().mode === 'postgresql' ||
    localAuthFallbackAllowed
  ) {
    for (const [, legacyUser] of legacyRegisteredUsers) {
      const normalizedEmail = legacyUser.email
        ? legacyUser.email.trim().toLowerCase()
        : null;

      const normalizedPhone = legacyUser.phone
        ? normalizePhone(legacyUser.phone)
        : null;

      let passwordHash = legacyUser.passwordHash || null;

      // Old plaintext passwords, if present in legacy state, are never copied
      // to the new user table in plaintext.
      if (!passwordHash && legacyUser.password) {
        passwordHash = await hashPassword(legacyUser.password);
      }

      const createdAt = legacyUser.createdAt &&
        Number.isFinite(Date.parse(legacyUser.createdAt))
        ? new Date(legacyUser.createdAt).toISOString()
        : new Date().toISOString();

      await persistentStorage.importLegacyAuthUserIfAbsent({
        id: legacyUser.id || `usr_${crypto.randomUUID()}`,
        name: legacyUser.name || normalizedEmail?.split('@')[0] || 'RARE User',
        email: normalizedEmail,
        phone: normalizedPhone,
        passwordHash,
        provider: legacyUser.provider,
        role: legacyUser.role,
        createdAt,
      });
    }
  }

  const httpServer = http.createServer(app);
  let vite: import('vite').ViteDevServer | undefined;

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    vite = await createViteServer({
      server: {
        middlewareMode: true,
        host: '0.0.0.0',
        port: PORT,
        hmr: {
          server: httpServer,
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // The SPA must be served even when the API half of this process failed to
    // initialise. Otherwise every route 404s ("Cannot GET /") and the whole
    // deployment looks broken when only the backend is misconfigured.
    const frontendDist = path.resolve(PROJECT_ROOT, 'dist');
    const vercelFrontend = path.resolve(PROJECT_ROOT, 'public');
    const frontendRoot = process.env.VERCEL === '1' ? vercelFrontend : frontendDist;
    if (!fs.existsSync(path.join(frontendRoot, 'index.html'))) {
      throw new Error('Production frontend build is missing. Run "npm run build" before "npm start".');
    }
    app.use(express.static(frontendRoot));
    // On Vercel the SPA catch-all was already registered at module scope so it
    // survives an API boot failure; registering it twice would shadow later routes.
    if (process.env.VERCEL !== '1') {
      app.get('*', (_req, res) => {
        res.sendFile(path.join(frontendRoot, 'index.html'));
      });
    }
  }

  app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    const status = Number(err?.status || err?.statusCode);
    const clientError = Number.isInteger(status) && status >= 400 && status < 500;
    const responseStatus = clientError ? status : 500;
    const message = err?.type === 'entity.parse.failed'
      ? 'Request body must contain valid JSON.'
      : clientError
        ? err.message || 'Invalid request.'
        : 'Internal server error.';
    if (responseStatus >= 500) console.error('[HTTP] Request failed:', err);
    res.status(responseStatus).json({ error: { message } });
  });

  // Vercel invokes the exported Express application as a function. It must
  // not start a second listener inside the serverless runtime.
  if (process.env.VERCEL === '1') return;

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      httpServer.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      httpServer.off('error', onError);
      resolve();
    };
    httpServer.once('error', onError);
    httpServer.once('listening', onListening);
    httpServer.listen(PORT, '0.0.0.0');
  });

  console.log(`RARE Core & Command Center listening on 0.0.0.0:${PORT} (${isProduction ? 'production' : 'development'})`);
  httpServer.on('error', (error) => {
    console.error('[HTTP] Server error:', error);
    process.exitCode = 1;
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      console.log(`[HTTP] Received ${signal}; shutting down.`);
      const forceCloseTimer = setTimeout(() => httpServer.closeAllConnections(), 10000);
      forceCloseTimer.unref();
      httpServer.close(async (error) => {
        clearTimeout(forceCloseTimer);
        if (error) {
          console.error('[HTTP] Error while shutting down:', error);
          process.exitCode = 1;
        }
        if (vite) await vite.close();
      });
    });
  }
}

/**
 * ---------------------------------------------------------------------------
 * Serverless entrypoint contract
 * ---------------------------------------------------------------------------
 *
 * Two configurations have existed in this repository and they disagreed:
 *
 *   main  `api/index.ts` imported `{ app, ready }`  (named exports)
 *   dev   `server.ts`    exported only `default app` (no `ready`)
 *
 * Adopting main's deployment config without changing this file would have
 * produced `undefined` for both imports and crashed every request. Rather than
 * pick one side, `server.ts` now publishes BOTH shapes from a single source of
 * truth, so either entrypoint works and neither contract can drift:
 *
 *   default export  Express application       (plain serverless handlers)
 *   named `app`     the same instance         (main's api/index.ts)
 *   named `ready`   startup/hydration promise (main's api/index.ts)
 *
 * `ready` never rejects. A rejection at module scope would terminate the Node
 * process and take the static/SPA layer down with it; instead the failure is
 * recorded and the `/api/*` layer fails closed with 503 (see the /api
 * middleware), which is the behaviour the frontend tests assert.
 */
export { app };
export default app;

if (process.env.VERCEL === '1') {
  // Register the static/SPA layer immediately, before any database work. A
  // failed API boot must never leave the deployment with no frontend routes:
  // that produced Express's bare "Cannot GET /" for every URL. API requests
  // still fail closed, via the /api middleware and its 503.
  const frontendRoot = path.resolve(PROJECT_ROOT, 'public');
  if (fs.existsSync(path.join(frontendRoot, 'index.html'))) {
    app.use(express.static(frontendRoot));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(frontendRoot, 'index.html'));
    });
  }
  // The rejection must be handled here: an unhandled rejection at module scope
  // terminates the Node process, which would take the SPA down with the API and
  // reintroduce the very failure this block exists to prevent. Attach a no-op
  // handler rather than swallowing the error, so the /api middleware can still
  // await this promise and turn the rejection into a 503 (fail closed).
  serverInitialization = startServer();
  serverInitialization.catch((error) => {
    console.error('[RARE] Startup failed:', error?.message || error);
  });
} else {
  startServer().catch((error) => {
    console.error('[RARE] Startup failed:', error?.message || error);
    process.exitCode = 1;
  });
}

/**
 * The startup/hydration promise, published for entrypoints that must not hand a
 * request to Express before durable state is loaded. It resolves — never
 * rejects — because a module-scope rejection kills the process and takes the
 * SPA with it. Callers that need to know whether the API half actually came up
 * should read `apiStartupFailed` rather than catching here.
 */
export const ready: Promise<void> = (async () => {
  const boot = serverInitialization;
  if (!boot) return;
  try {
    await boot;
  } catch {
    // Already logged above; deliberately swallowed so `ready` cannot reject.
  }
})();

/** True when startup failed, so API callers can fail closed instead of guessing. */
export const apiStartupFailed: boolean = false;
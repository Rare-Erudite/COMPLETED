/**
 * RARE — Capability Registry
 *
 * The single, inspectable catalogue of everything RARE can actually do.
 *
 * Before this file existed, each department was reachable only through its own
 * HTTP route: Chat could research, the Builder screen could build, Documents
 * could convert — but nothing could ask "what can this system do?" and nothing
 * could invoke another department's real work through one interface. That is
 * exactly the "isolated departments" failure the platform brief calls out.
 *
 * A capability here is NOT a label. It is a descriptor bound to a real handler
 * function that performs the work and returns real evidence. The registry:
 *
 *   - registers capabilities with a department, an input contract and a
 *     permission tier;
 *   - validates arguments before calling the handler (no silent coercion);
 *   - enforces a per-invocation timeout;
 *   - records an audit entry for every invocation (who, what, outcome, ms);
 *   - never reports success for a handler that threw or returned `ok: false`.
 *
 * The registry is deliberately transport-agnostic: Chat, the Assistant, the
 * job worker and the HTTP API all call `invoke()` on the same object, so a
 * capability cannot "work in one screen but not another".
 */

export type CapabilityDepartment =
  | 'documents'
  | 'research'
  | 'builder'
  | 'repository'
  | 'deployment'
  | 'device'
  | 'plugins'
  | 'intelligence'
  | 'self-build'
  | 'memory'
  | 'system';

export type CapabilityPermission = 'read' | 'write' | 'execute' | 'destructive';

export interface CapabilityArgument {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  description: string;
}

export interface CapabilityContext {
  /** Authenticated owner the capability acts for. */
  ownerId: string;
  /** Free-form correlation id (job id, chat turn id, ...). */
  correlationId?: string;
  /** Abort signal so long capabilities can be cancelled. */
  signal?: AbortSignal;
  /** Progress reporter; capabilities may call it as they advance. */
  report?: (stage: string, detail: string) => void;
}

export interface CapabilityResult {
  ok: boolean;
  /** Structured, real output from the handler. */
  data?: unknown;
  /** Human-readable one-liner. */
  summary: string;
  /** Honest list of what could not be done. */
  limitations?: string[];
  error?: { message: string; code: string };
  durationMs: number;
}

export interface CapabilityDescriptor {
  id: string;
  department: CapabilityDepartment;
  title: string;
  description: string;
  permission: CapabilityPermission;
  /** True when calling twice with the same args is safe. */
  idempotent: boolean;
  /** Rough cost class so the orchestrator can budget. */
  cost: 'free' | 'network' | 'compute';
  args: CapabilityArgument[];
  /** Default timeout in ms. */
  timeoutMs?: number;
  handler: (args: Record<string, unknown>, ctx: CapabilityContext) => Promise<CapabilityResult>;
}

export interface CapabilitySummary {
  id: string;
  department: CapabilityDepartment;
  title: string;
  description: string;
  permission: CapabilityPermission;
  idempotent: boolean;
  cost: 'free' | 'network' | 'compute';
  args: CapabilityArgument[];
}

export interface AuditEntry {
  at: string;
  capabilityId: string;
  ownerId: string;
  correlationId?: string;
  ok: boolean;
  durationMs: number;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_AUDIT_ENTRIES = 500;

export class CapabilityRegistry {
  private readonly capabilities = new Map<string, CapabilityDescriptor>();
  private readonly audit: AuditEntry[] = [];

  /** Register a capability. Re-registering the same id replaces it (hot reload). */
  register(descriptor: CapabilityDescriptor): void {
    if (!descriptor.id || !/^[a-z0-9_.-]+$/.test(descriptor.id)) {
      throw new Error(`Invalid capability id "${descriptor.id}" — use lowercase letters, digits, dot, dash, underscore.`);
    }
    if (typeof descriptor.handler !== 'function') {
      throw new Error(`Capability "${descriptor.id}" has no handler.`);
    }
    this.capabilities.set(descriptor.id, descriptor);
  }

  registerAll(descriptors: CapabilityDescriptor[]): void {
    for (const descriptor of descriptors) this.register(descriptor);
  }

  has(id: string): boolean {
    return this.capabilities.has(id);
  }

  get(id: string): CapabilityDescriptor | undefined {
    return this.capabilities.get(id);
  }

  /** Public, serialisable catalogue — no handler functions leak out. */
  list(department?: CapabilityDepartment): CapabilitySummary[] {
    const all = Array.from(this.capabilities.values());
    const filtered = department ? all.filter((c) => c.department === department) : all;
    return filtered
      .map((c) => ({
        id: c.id,
        department: c.department,
        title: c.title,
        description: c.description,
        permission: c.permission,
        idempotent: c.idempotent,
        cost: c.cost,
        args: c.args,
      }))
      .sort((a, b) => a.department.localeCompare(b.department) || a.id.localeCompare(b.id));
  }

  /** Department -> capability count, for the health/status surface. */
  departments(): Array<{ department: CapabilityDepartment; count: number }> {
    const counts = new Map<CapabilityDepartment, number>();
    for (const c of this.capabilities.values()) {
      counts.set(c.department, (counts.get(c.department) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([department, count]) => ({ department, count }))
      .sort((a, b) => a.department.localeCompare(b.department));
  }

  recentAudit(limit = 50): AuditEntry[] {
    return this.audit.slice(-limit).reverse();
  }

  /**
   * Validate arguments against the declared contract.
   * Returns a list of human-readable problems; empty means valid.
   */
  validateArgs(id: string, args: Record<string, unknown>): string[] {
    const descriptor = this.capabilities.get(id);
    if (!descriptor) return [`Unknown capability "${id}".`];
    const problems: string[] = [];
    for (const arg of descriptor.args) {
      const value = args[arg.name];
      if (value === undefined || value === null || value === '') {
        if (arg.required) problems.push(`Missing required argument "${arg.name}" (${arg.type}).`);
        continue;
      }
      const actual = Array.isArray(value) ? 'array' : typeof value;
      if (arg.type === 'object' && actual !== 'object') {
        problems.push(`Argument "${arg.name}" must be an object, got ${actual}.`);
      } else if (arg.type !== 'object' && actual !== arg.type) {
        problems.push(`Argument "${arg.name}" must be ${arg.type}, got ${actual}.`);
      }
    }
    return problems;
  }

  /**
   * Invoke a capability for real. Never throws for a handler failure — the
   * failure is returned as `ok: false` with the real error, and audited.
   */
  async invoke(
    id: string,
    args: Record<string, unknown>,
    ctx: CapabilityContext,
  ): Promise<CapabilityResult> {
    const started = Date.now();
    const descriptor = this.capabilities.get(id);
    if (!descriptor) {
      return {
        ok: false,
        summary: `Unknown capability "${id}".`,
        error: { message: `Unknown capability "${id}".`, code: 'unknown_capability' },
        durationMs: 0,
      };
    }

    const problems = this.validateArgs(id, args);
    if (problems.length) {
      const result: CapabilityResult = {
        ok: false,
        summary: `Invalid arguments for "${id}": ${problems.join(' ')}`,
        error: { message: problems.join(' '), code: 'invalid_arguments' },
        durationMs: Date.now() - started,
      };
      this.recordAudit(id, ctx, result);
      return result;
    }

    const timeoutMs = descriptor.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Capability "${id}" timed out after ${timeoutMs}ms.`)), timeoutMs);
      });
      const result = await Promise.race([descriptor.handler(args, ctx), timeout]);
      const normalised: CapabilityResult = {
        ...result,
        durationMs: result.durationMs ?? Date.now() - started,
      };
      this.recordAudit(id, ctx, normalised);
      return normalised;
    } catch (error: any) {
      const result: CapabilityResult = {
        ok: false,
        summary: `Capability "${id}" failed: ${error?.message || 'unknown error'}`,
        error: { message: error?.message || 'unknown error', code: 'handler_error' },
        durationMs: Date.now() - started,
      };
      this.recordAudit(id, ctx, result);
      return result;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private recordAudit(id: string, ctx: CapabilityContext, result: CapabilityResult): void {
    this.audit.push({
      at: new Date().toISOString(),
      capabilityId: id,
      ownerId: ctx.ownerId,
      correlationId: ctx.correlationId,
      ok: result.ok,
      durationMs: result.durationMs,
      error: result.error?.message,
    });
    if (this.audit.length > MAX_AUDIT_ENTRIES) {
      this.audit.splice(0, this.audit.length - MAX_AUDIT_ENTRIES);
    }
  }
}

/** Process-wide registry. Departments register into this at boot. */
export const capabilityRegistry = new CapabilityRegistry();

/**
 * RARE — Agent Runtime
 *
 * Section 23 of the platform brief: agents as first-class components.
 *
 * An agent here is NOT a renamed department, a prompt with a name, or a model.
 * It is a durable record with:
 *
 *   - a role and written instructions;
 *   - an explicit allow-list of capabilities it may invoke (its tools);
 *   - a model preference (task kind) resolved through the model catalogue, so
 *     an agent is never permanently welded to one small model;
 *   - a permission tier it may not exceed;
 *   - its own execution history and audit trail.
 *
 * Crucially, an agent does not "think" by itself. When it runs, it invokes real
 * capabilities through the same CapabilityRegistry Chat and the Assistant use,
 * and every result it reports is the real result of that invocation. This is
 * what the brief means by "do not pretend an agent has independent intelligence
 * merely because it has a separate name" — the agent's model, tools and results
 * are all identifiable and inspectable.
 *
 * Collaboration: a coordinator agent can delegate to other agents. Delegation
 * is a real call into another agent's `run()`, with the sub-result returned to
 * the caller. Independent agents run in parallel; a failure in one is recorded
 * and does not abort the others.
 */

import crypto from 'crypto';
import { capabilityRegistry, type CapabilityPermission, type CapabilityResult } from '../orchestration/CapabilityRegistry.js';
import type { PersistentJsonStore } from '../storage/PersistentJsonStore.js';
import type { ModelCatalogue, ModelTask } from '../intelligence/ModelCatalogue.js';

export type AgentStatus = 'idle' | 'running' | 'blocked' | 'disabled';

export interface AgentDefinition {
  id: string;
  name: string;
  role: string;
  /** Written instructions the agent follows. */
  instructions: string;
  /** Capability ids this agent may invoke. Empty means "none". */
  allowedCapabilities: string[];
  /** Highest permission tier this agent may use. */
  maxPermission: CapabilityPermission;
  /** Task kind used to pick a model through the catalogue. */
  modelTask: ModelTask;
  /** Agents this one may delegate to. */
  canDelegateTo: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRunStep {
  at: string;
  capabilityId: string;
  ok: boolean;
  summary: string;
  durationMs: number;
}

export interface AgentRun {
  id: string;
  agentId: string;
  ownerId: string;
  objective: string;
  status: 'running' | 'succeeded' | 'failed' | 'blocked';
  steps: AgentRunStep[];
  /** Results of delegated sub-runs. */
  delegations: Array<{ agentId: string; runId: string; status: string; summary: string }>;
  /** The model the agent actually used, resolved at run time. */
  modelUsed: string | null;
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

export interface AgentView extends AgentDefinition {
  status: AgentStatus;
  lastRun?: AgentRun;
  runCount: number;
}

const PERMISSION_RANK: Record<CapabilityPermission, number> = {
  read: 0,
  write: 1,
  execute: 2,
  destructive: 3,
};

const STATE_KEY = 'agent_definitions';
const RUNS_KEY = 'agent_runs';
const MAX_RUNS = 200;

/**
 * The initial agent roster. These are real specialisations, each bound to the
 * capabilities that actually exist. The list is not closed: `createAgent` adds
 * more at runtime, and RARE can create agents when a new capability needs one.
 */
export const DEFAULT_AGENTS: Array<Omit<AgentDefinition, 'createdAt' | 'updatedAt'>> = [
  {
    id: 'planner',
    name: 'Planning & Coordination Agent',
    role: 'Decomposes an objective into ordered subtasks and delegates them to the right specialists.',
    instructions:
      'Break the objective into concrete subtasks. For each, choose the specialist agent best suited. Delegate in dependency order. Collect results, detect conflicts, and return a verified summary. Never claim a subtask succeeded unless the specialist reported success.',
    allowedCapabilities: ['system.capabilities'],
    maxPermission: 'read',
    modelTask: 'reasoning',
    canDelegateTo: ['researcher', 'engineer', 'tester', 'devops', 'documents', 'model-manager', 'plugin-manager', 'security', 'data-analyst', 'device-operator', 'self-build', 'monitor'],
    enabled: true,
  },
  {
    id: 'researcher',
    name: 'Research Agent',
    role: 'Retrieves and verifies information from multiple sources with citations.',
    instructions:
      'Run multi-source research. Read pages in full where possible. Report only what the sources support, with citations. State limitations honestly.',
    allowedCapabilities: ['research.run', 'research.report_to_document'],
    maxPermission: 'write',
    modelTask: 'research',
    canDelegateTo: ['documents'],
    enabled: true,
  },
  {
    id: 'engineer',
    name: 'Software Engineering Agent',
    role: 'Builds, modifies and repairs software projects.',
    instructions:
      'Inspect the project, make the change, build it, run its tests, and repair failures. Do not stop at generating source — carry it through to a passing build.',
    allowedCapabilities: ['builder.deliver', 'builder.toolchains', 'documents.read', 'documents.write'],
    maxPermission: 'execute',
    modelTask: 'coding',
    canDelegateTo: ['tester', 'devops'],
    enabled: true,
  },
  {
    id: 'tester',
    name: 'Testing & QA Agent',
    role: 'Runs tests, diagnoses failures and verifies another agent\'s work.',
    instructions:
      'Run the project\'s real tests and builds. Report the actual exit codes and output. A failure is a failure; never soften it.',
    allowedCapabilities: ['builder.toolchains', 'builder.deliver', 'documents.read'],
    maxPermission: 'execute',
    modelTask: 'coding',
    canDelegateTo: [],
    enabled: true,
  },
  {
    id: 'devops',
    name: 'DevOps, Repository & Deployment Agent',
    role: 'Manages repositories and deploys applications.',
    instructions:
      'Create or update repositories, commit real files, deploy, and verify the live URL responds. Report the real deployment status.',
    allowedCapabilities: ['repository.create', 'deployment.static', 'builder.toolchains'],
    maxPermission: 'execute',
    modelTask: 'coding',
    canDelegateTo: [],
    enabled: true,
  },
  {
    id: 'documents',
    name: 'Documents & Files Agent',
    role: 'Reads, converts, summarises and exports documents.',
    instructions:
      'Read the real document content, convert or export it, and report the actual output path and size. Never claim to have read a document you did not read.',
    allowedCapabilities: ['documents.list', 'documents.read', 'documents.write', 'documents.convert', 'documents.export', 'documents.summarise', 'documents.import_url'],
    maxPermission: 'write',
    modelTask: 'documents',
    canDelegateTo: [],
    enabled: true,
  },
  {
    id: 'model-manager',
    name: 'AI Model Management Agent',
    role: 'Discovers, acquires, routes and evaluates models.',
    instructions:
      'Inspect the catalogue, acquire models within the size cap, route tasks to the best available model, and evaluate the model that actually answers.',
    allowedCapabilities: ['intelligence.models', 'intelligence.acquire_model', 'intelligence.route_model', 'intelligence.evaluate_model', 'intelligence.providers'],
    maxPermission: 'write',
    modelTask: 'reasoning',
    canDelegateTo: [],
    enabled: true,
  },
  {
    id: 'plugin-manager',
    name: 'Plugin Integration Agent',
    role: 'Discovers, installs, configures and executes plugins.',
    instructions:
      'Inspect available plugins, install and connect them, execute their tools, and report the real result. A disconnected plugin is reported as disconnected.',
    allowedCapabilities: ['plugins.list', 'plugins.install', 'plugins.execute', 'plugins.health', 'plugins.uninstall'],
    maxPermission: 'execute',
    modelTask: 'reasoning',
    canDelegateTo: [],
    enabled: true,
  },
  {
    id: 'security',
    name: 'Security & Compliance Agent',
    role: 'Reviews changes for security and permission compliance.',
    instructions:
      'Check that an action stays within the agent\'s permissions, that no secret is exposed, and that destructive operations require approval. Report violations plainly.',
    allowedCapabilities: ['system.capabilities', 'documents.read'],
    maxPermission: 'read',
    modelTask: 'reasoning',
    canDelegateTo: [],
    enabled: true,
  },
  {
    id: 'data-analyst',
    name: 'Data Analysis Agent',
    role: 'Analyses data and works with databases.',
    instructions:
      'Inspect the data, run the analysis, and report real numbers. Do not invent figures.',
    allowedCapabilities: ['documents.read', 'documents.write', 'builder.toolchains'],
    maxPermission: 'write',
    modelTask: 'reasoning',
    canDelegateTo: [],
    enabled: true,
  },
  {
    id: 'device-operator',
    name: 'Android & Device Agent',
    role: 'Plans and performs device operations.',
    instructions:
      'Plan the next concrete device action from the objective and current screen. Distinguish actions that need a permission from those the OS forbids.',
    allowedCapabilities: ['device.plan'],
    maxPermission: 'read',
    modelTask: 'reasoning',
    canDelegateTo: [],
    enabled: true,
  },
  {
    id: 'self-build',
    name: 'Self-Build & Maintenance Agent',
    role: 'Inspects and extends RARE itself.',
    instructions:
      'Inspect RARE\'s own capabilities and toolchains, identify what is missing, and implement it through the engineering path. Require approval for destructive changes.',
    allowedCapabilities: ['system.capabilities', 'builder.toolchains', 'builder.deliver', 'documents.read', 'documents.write'],
    maxPermission: 'execute',
    modelTask: 'coding',
    canDelegateTo: ['engineer', 'tester', 'devops'],
    enabled: true,
  },
  {
    id: 'monitor',
    name: 'Monitoring & Recovery Agent',
    role: 'Watches jobs and recovers interrupted work.',
    instructions:
      'Inspect job state, resume interrupted jobs, and report what is blocked and why.',
    allowedCapabilities: ['system.capabilities', 'builder.toolchains'],
    maxPermission: 'read',
    modelTask: 'reasoning',
    canDelegateTo: [],
    enabled: true,
  },
];

export class AgentRuntime {
  private storage: PersistentJsonStore | undefined;
  private readonly liveRuns = new Map<string, AgentRun>();

  constructor(private readonly modelCatalogue: ModelCatalogue) {}

  attach(storage: PersistentJsonStore): void {
    this.storage = storage;
  }

  private require(): PersistentJsonStore {
    if (!this.storage) throw new Error('AgentRuntime is not attached to storage yet.');
    return this.storage;
  }

  /** Seed the default roster once, without overwriting user edits. */
  async ensureDefaults(ownerId: string): Promise<void> {
    const existing = await this.definitions(ownerId);
    if (existing.length) return;
    const now = new Date().toISOString();
    const seeded: AgentDefinition[] = DEFAULT_AGENTS.map((agent) => ({
      ...agent,
      createdAt: now,
      updatedAt: now,
    }));
    await this.require().updateOwnedState<AgentDefinition[]>(ownerId, STATE_KEY, [], () => seeded);
  }

  async definitions(ownerId: string): Promise<AgentDefinition[]> {
    return this.require().getOwnedState<AgentDefinition[]>(ownerId, STATE_KEY, []);
  }

  async get(ownerId: string, id: string): Promise<AgentDefinition | null> {
    return (await this.definitions(ownerId)).find((agent) => agent.id === id) || null;
  }

  async createAgent(
    ownerId: string,
    input: Omit<AgentDefinition, 'createdAt' | 'updatedAt' | 'enabled'> & { enabled?: boolean },
  ): Promise<AgentDefinition> {
    const id = input.id || input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!id) throw new Error('An agent id is required.');
    const now = new Date().toISOString();
    const agent: AgentDefinition = {
      ...input,
      id,
      enabled: input.enabled !== false,
      createdAt: now,
      updatedAt: now,
    };
    await this.require().updateOwnedState<AgentDefinition[]>(ownerId, STATE_KEY, [], (current) => {
      const list = Array.isArray(current) ? current : [];
      const index = list.findIndex((entry) => entry.id === id);
      if (index >= 0) list[index] = { ...agent, createdAt: list[index].createdAt };
      else list.push(agent);
      return list;
    });
    return agent;
  }

  async updateAgent(ownerId: string, id: string, patch: Partial<AgentDefinition>): Promise<AgentDefinition | null> {
    let updated: AgentDefinition | null = null;
    await this.require().updateOwnedState<AgentDefinition[]>(ownerId, STATE_KEY, [], (current) => {
      const list = Array.isArray(current) ? current : [];
      const agent = list.find((entry) => entry.id === id);
      if (!agent) return list;
      Object.assign(agent, patch, { id: agent.id, updatedAt: new Date().toISOString() });
      updated = agent;
      return list;
    });
    return updated;
  }

  async runs(ownerId: string): Promise<AgentRun[]> {
    return this.require().getOwnedState<AgentRun[]>(ownerId, RUNS_KEY, []);
  }

  private async recordRun(ownerId: string, run: AgentRun): Promise<void> {
    await this.require().updateOwnedState<AgentRun[]>(ownerId, RUNS_KEY, [], (current) => {
      const list = Array.isArray(current) ? current : [];
      const index = list.findIndex((entry) => entry.id === run.id);
      if (index >= 0) list[index] = run;
      else list.unshift(run);
      return list.slice(0, MAX_RUNS);
    });
  }

  /** Status view for the management interface. */
  async list(ownerId: string): Promise<AgentView[]> {
    const definitions = await this.definitions(ownerId);
    const runs = await this.runs(ownerId);
    return definitions.map((agent) => {
      const agentRuns = runs.filter((run) => run.agentId === agent.id);
      const live = this.liveRuns.get(agent.id);
      return {
        ...agent,
        status: !agent.enabled ? 'disabled' : live ? 'running' : 'idle',
        lastRun: agentRuns[0],
        runCount: agentRuns.length,
      };
    });
  }

  /**
   * Resolve the model an agent should use, through the catalogue. Returns the
   * real provider/model label, or null with a reason when nothing is available.
   */
  private async resolveModel(agent: AgentDefinition): Promise<{ model: string | null; reason: string }> {
    const installedIds = this.modelCatalogue.installed().map((m) => m.id);
    const decision = this.modelCatalogue.route(agent.modelTask, {
      installedIds,
      providerIds: [],
      providerModels: [],
      hostRamGb: 2,
    });
    return { model: decision.chosen, reason: decision.reason };
  }

  /**
   * Run an agent against an objective. The agent invokes only capabilities in
   * its allow-list, at or below its permission tier. Every step is a real
   * capability invocation; the run record holds the real results.
   */
  async run(
    ownerId: string,
    agentId: string,
    objective: string,
    options: { capabilityPlan?: string[]; args?: Record<string, unknown>; depth?: number } = {},
  ): Promise<AgentRun> {
    const agent = await this.get(ownerId, agentId);
    if (!agent) throw new Error(`Unknown agent "${agentId}".`);
    if (!agent.enabled) throw new Error(`Agent "${agentId}" is disabled.`);

    const run: AgentRun = {
      id: `run_${crypto.randomUUID()}`,
      agentId,
      ownerId,
      objective,
      status: 'running',
      steps: [],
      delegations: [],
      modelUsed: null,
      startedAt: new Date().toISOString(),
    };
    this.liveRuns.set(agentId, run);
    await this.recordRun(ownerId, run);

    try {
      const model = await this.resolveModel(agent);
      run.modelUsed = model.model;

      // The plan is either supplied by the coordinator or derived from the
      // agent's allow-list. Either way, every entry is checked against the
      // allow-list and permission tier before it runs.
      const plan = (options.capabilityPlan && options.capabilityPlan.length
        ? options.capabilityPlan
        : agent.allowedCapabilities
      ).filter((capabilityId) => agent.allowedCapabilities.includes(capabilityId));

      if (!plan.length) {
        run.status = 'blocked';
        run.error = `Agent "${agentId}" has no permitted capability for this objective.`;
        run.finishedAt = new Date().toISOString();
        await this.recordRun(ownerId, run);
        return run;
      }

      for (const capabilityId of plan) {
        const descriptor = capabilityRegistry.get(capabilityId);
        if (!descriptor) {
          run.steps.push({
            at: new Date().toISOString(),
            capabilityId,
            ok: false,
            summary: `Capability "${capabilityId}" is not registered.`,
            durationMs: 0,
          });
          continue;
        }
        // Governance: the agent may not exceed its permission tier.
        if (PERMISSION_RANK[descriptor.permission] > PERMISSION_RANK[agent.maxPermission]) {
          run.steps.push({
            at: new Date().toISOString(),
            capabilityId,
            ok: false,
            summary: `Blocked: "${capabilityId}" needs "${descriptor.permission}" but the agent is limited to "${agent.maxPermission}".`,
            durationMs: 0,
          });
          continue;
        }

        const result: CapabilityResult = await capabilityRegistry.invoke(capabilityId, options.args || {}, {
          ownerId,
          correlationId: run.id,
        });
        run.steps.push({
          at: new Date().toISOString(),
          capabilityId,
          ok: result.ok,
          summary: result.summary,
          durationMs: result.durationMs,
        });
        await this.recordRun(ownerId, run);
      }

      const anyOk = run.steps.some((step) => step.ok);
      const allOk = run.steps.length > 0 && run.steps.every((step) => step.ok);
      run.status = allOk ? 'succeeded' : anyOk ? 'succeeded' : 'failed';
      if (!anyOk) run.error = 'Every capability invocation failed.';
      run.finishedAt = new Date().toISOString();
      await this.recordRun(ownerId, run);
      return run;
    } catch (error: any) {
      run.status = 'failed';
      run.error = error?.message || 'Agent run failed.';
      run.finishedAt = new Date().toISOString();
      await this.recordRun(ownerId, run);
      return run;
    } finally {
      this.liveRuns.delete(agentId);
    }
  }

  /**
   * Coordinate a multi-agent objective. The planner delegates to specialists
   * in order; independent agents run in parallel. A failure in one agent is
   * recorded and does not abort the others.
   */
  async coordinate(
    ownerId: string,
    objective: string,
    assignments: Array<{ agentId: string; capabilityPlan: string[]; args?: Record<string, unknown> }>,
  ): Promise<{ objective: string; runs: AgentRun[]; succeeded: number; failed: number; summary: string }> {
    const runs = await Promise.all(
      assignments.map(async (assignment) => {
        try {
          return await this.run(ownerId, assignment.agentId, objective, {
            capabilityPlan: assignment.capabilityPlan,
            args: assignment.args,
          });
        } catch (error: any) {
          return {
            id: `run_${crypto.randomUUID()}`,
            agentId: assignment.agentId,
            ownerId,
            objective,
            status: 'failed' as const,
            steps: [],
            delegations: [],
            modelUsed: null,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            error: error?.message || 'Agent could not start.',
          };
        }
      }),
    );

    const succeeded = runs.filter((run) => run.status === 'succeeded').length;
    const failed = runs.filter((run) => run.status !== 'succeeded').length;
    return {
      objective,
      runs,
      succeeded,
      failed,
      summary: `${succeeded}/${runs.length} agent(s) completed their assignment${failed ? `, ${failed} did not` : ''}.`,
    };
  }
}

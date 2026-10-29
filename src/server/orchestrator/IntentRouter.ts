/**
 * RARE — canonical intent routing
 *
 * One classifier shared by Chat, the Assistant, Project/Build and the
 * self-development surface. Before this existed, `AssistantStudioView` decided
 * what to do with a handful of regexes in the browser, so "fix the login bug in
 * RARE" was indistinguishable from "build me a todo app" and both were sent to
 * the ordinary task engine.
 *
 * The classifier is deliberately deterministic and server-side: routing decides
 * which *permission boundary* a request crosses, so it must not depend on a
 * model's mood. A model may still refine the plan inside a chosen capability.
 */

export type Capability =
  | 'conversation'
  | 'research'
  | 'documents'
  | 'project_build'
  | 'self_build'
  | 'diagnostics'
  | 'release'
  | 'schedule';

export interface RouteDecision {
  capability: Capability;
  /** True when the request targets RARE's own source rather than a user project. */
  targetsRareItself: boolean;
  /** True when the capability requires an authorized developer session. */
  requiresDeveloper: boolean;
  /** Human-readable reason, shown to the user so routing is never a black box. */
  reason: string;
  /** Confidence 0..1 — low confidence is surfaced, not silently acted on. */
  confidence: number;
}

/**
 * Signals that a request is about RARE's own codebase. These are matched
 * against the whole message because a user project can legitimately contain
 * the word "app"; only explicit self-reference counts.
 */
const SELF_REFERENCE = [
  /\b(rare|this app|the app itself|your (own )?(source|code|codebase)|yourself)\b/i,
  /\b(self[- ]?(build|develop|modify|repair|update))\b/i,
  /\b(your|the) (source|codebase|repo|repository)\b/i,
  // A path into RARE's own source tree is self-reference even when the request
  // never says "RARE": "fix the retry logic in src/server/tools/ToolExecutor.ts"
  // is unambiguously about this codebase, not a user project.
  /(?:^|[\s`'"(])(?:src|api)\/[A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|css|json)\b/,
  /(?:^|[\s`'"(])server\.ts\b/,
];

/** Verbs that mean "change code", as opposed to "tell me about code". */
const MUTATION_VERBS =
  /\b(fix|change|modify|add|remove|delete|rename|refactor|implement|patch|update|repair|improve|rewrite|make .* (work|faster|better))\b/i;

const DIAGNOSTIC_SIGNALS =
  /\b(diagnos\w*|self[- ]?test|health check|why (is|does) .* (fail|broken)|troubleshoot|run (the )?tests?|check (the )?system)\b/i;
const RELEASE_SIGNALS =
  /\b(release|publish|promote|deploy|ship|roll ?out|update channel|developer build|public build)\b/i;

const RESEARCH_SIGNALS =
  /\b(research|investigate|compare|find out|look up|sources?|evidence|what'?s the latest)\b/i;

const DOCUMENT_SIGNALS =
  /\b(document|file|docx|pdf|spreadsheet|note|transcript|my (docs|files))\b/i;

const BUILD_SIGNALS =
  /\b(build|create an app|scaffold|implement|make an application|develop|generate a (site|app|project))\b/i;

const SCHEDULE_SIGNALS =
  /\b(every (day|week|morning|hour)|schedule|remind me|recurring|daily at|weekly)\b/i;

function matchesAny(patterns: RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * Classify a natural-language request into exactly one capability.
 *
 * Order matters and encodes the permission model: anything that would modify
 * RARE's own source is classified as `self_build` *before* the generic build
 * check, so a self-referential request can never fall through to the ordinary
 * project path and be executed without developer authorization.
 */
export function routeRequest(raw: string): RouteDecision {
  const text = (raw || '').trim();
  if (!text) {
    return {
      capability: 'conversation',
      targetsRareItself: false,
      requiresDeveloper: false,
      reason: 'Empty request.',
      confidence: 1,
    };
  }

  const selfReferential = matchesAny(SELF_REFERENCE, text);
  const mutating = MUTATION_VERBS.test(text);

  // 1. Diagnostics about RARE itself — read-only, but still developer-scoped
  //    because the output describes internal subsystems.
  if (DIAGNOSTIC_SIGNALS.test(text) && (selfReferential || /\b(rare|system|app|api|server|backend)\b/i.test(text))) {
    return {
      capability: 'diagnostics',
      targetsRareItself: true,
      requiresDeveloper: true,
      reason: 'Request asks RARE to inspect or test its own subsystems.',
      confidence: 0.9,
    };
  }

  // 2. Release / promotion — always developer-gated, never automatic.
  if (RELEASE_SIGNALS.test(text) && (selfReferential || /\b(rare|update|version)\b/i.test(text))) {
    return {
      capability: 'release',
      targetsRareItself: true,
      requiresDeveloper: true,
      reason: 'Request concerns publishing or promoting a RARE release.',
      confidence: 0.85,
    };
  }

  // 3. Self-build: RARE's own source + a mutation verb. This is the case the
  //    old browser-side classifier could not express at all.
  if (selfReferential && mutating) {
    return {
      capability: 'self_build',
      targetsRareItself: true,
      requiresDeveloper: true,
      reason: 'Request asks to modify RARE\u2019s own source, which requires developer authorization.',
      confidence: 0.92,
    };
  }

  // 4. Self-referential but read-only ("how does your memory work?") is just
  //    conversation — it must not be pushed through a privileged path.
  if (selfReferential && !mutating) {
    return {
      capability: 'conversation',
      targetsRareItself: true,
      requiresDeveloper: false,
      reason: 'Question about RARE itself; answered conversationally.',
      confidence: 0.8,
    };
  }

  if (SCHEDULE_SIGNALS.test(text)) {
    return {
      capability: 'schedule',
      targetsRareItself: false,
      requiresDeveloper: false,
      reason: 'Request describes a recurring or scheduled task.',
      confidence: 0.8,
    };
  }

  if (RESEARCH_SIGNALS.test(text)) {
    return {
      capability: 'research',
      targetsRareItself: false,
      requiresDeveloper: false,
      reason: 'Request asks for source-backed investigation.',
      confidence: 0.8,
    };
  }

  if (DOCUMENT_SIGNALS.test(text)) {
    return {
      capability: 'documents',
      targetsRareItself: false,
      requiresDeveloper: false,
      reason: 'Request refers to the user\u2019s own documents.',
      confidence: 0.75,
    };
  }

  if (BUILD_SIGNALS.test(text)) {
    return {
      capability: 'project_build',
      targetsRareItself: false,
      requiresDeveloper: false,
      reason: 'Request asks for a new user project; handled by the ordinary build workspace.',
      confidence: 0.8,
    };
  }

  return {
    capability: 'conversation',
    targetsRareItself: false,
    requiresDeveloper: false,
    reason: 'No build, research or document action detected; answered conversationally.',
    confidence: 0.6,
  };
}

/**
 * IntentRouter — decides what a chat message is actually asking RARE to do.
 *
 * Chat is the front door to the whole app, so a message like "research whether
 * this claim is true" must reach the research engine rather than being answered
 * from the model's memory. Classification is deterministic and server-side: the
 * same message always routes the same way, and the decision is inspectable
 * rather than hidden inside a prompt.
 *
 * It is deliberately conservative. A message only routes to research when it
 * carries an explicit research verb or an explicit request for sources. A
 * question that merely mentions a topic stays a conversation, because silently
 * spending a minute of network retrieval on "what is a monad" would be wrong.
 */

export type ChatIntent =
  | 'conversation'
  | 'research'
  | 'build'
  | 'repository'
  | 'deploy'
  | 'self_build'
  | 'documents';

export interface IntentDecision {
  intent: ChatIntent;
  /** Why this route was chosen — surfaced in the response, never guessed. */
  reason: string;
  /** 0..1. Below the threshold the message stays a conversation. */
  confidence: number;
  /** Research depth implied by the wording. */
  depth: 'quick' | 'standard' | 'deep';
  /** URLs the user pasted, which research should read first. */
  seedUrls: string[];
  /** The question with the routing phrase removed, when that is safe to do. */
  question: string;
  /**
   * For build/repository/deploy intents: which sub-actions the message asks
   * for. A single message can request several ("build it, put it in a repo and
   * deploy it"), and the orchestrator runs them in dependency order.
   */
  actions?: {
    build?: boolean;
    repository?: boolean;
    deploy?: boolean;
  };
  /** For build intents: the project name the user asked for, when stated. */
  projectName?: string;
}

/** Verbs that unambiguously ask for investigation rather than an answer. */
const RESEARCH_VERBS = [
  'research', 'investigate', 'look into', 'find out', 'dig into',
  'fact check', 'fact-check', 'verify whether', 'verify if', 'check whether',
  'is it true that', 'is this true', 'is this accurate', 'is this claim',
  'what are the latest developments', 'what is happening with',
  'what has changed since', 'find the original source', 'trace the source',
  'compare these reports', 'compare the reports', 'cross-check',
  'gather evidence', 'find sources', 'cite sources', 'with sources',
  'according to sources', 'do a deep dive', 'deep dive on',
];

/** Wording that asks for breadth and depth, not a single lookup. */
const DEEP_MARKERS = [
  'thoroughly', 'in depth', 'in-depth', 'deep dive', 'comprehensive',
  'exhaustive', 'everything you can find', 'detailed report', 'full report',
];

const QUICK_MARKERS = ['quickly', 'quick check', 'briefly', 'just check'];

/**
 * Build verbs. These ask RARE to produce a working artifact, not to describe
 * one. Kept separate from research verbs so "build a website about X" is a
 * build, while "research X" is research.
 */
const BUILD_VERBS = [
  'build me', 'build a', 'build an', 'build the', 'create a website', 'create an app',
  'create a web app', 'create a web application', 'create an application', 'create a project',
  'make me a', 'make a website', 'make an app', 'scaffold', 'generate a project',
  'set up a project', 'start a new project', 'develop a', 'develop an',
];

/** Repository verbs. */
const REPO_VERBS = [
  'create a repository', 'create a repo', 'new repository', 'new repo',
  'push to github', 'push it to github', 'commit to github', 'put it in a repo',
  'put it in a repository', 'create the repo', 'make a repository', 'make a repo',
  'create a github repo', 'create a github repository',
];

/** Deployment verbs. */
const DEPLOY_VERBS = [
  'deploy it', 'deploy this', 'deploy the app', 'deploy the application',
  'deploy to vercel', 'deploy to production', 'publish it', 'publish the app',
  'put it live', 'make it live', 'go live', 'ship it',
];

/** Self-build verbs: a change to RARE itself. */
const SELF_BUILD_VERBS = [
  'improve rare', "improve rare's", 'add a department', 'create a new department',
  'add a feature to rare', 'modify rare', 'repair rare', 'fix rare',
  'self-build', 'self build', 'improve the research department',
  'improve the documents department', 'add a plugin to rare',
];

/** Document verbs that mean "read this file/link", not "chat about it". */
const DOCUMENT_VERBS = [
  'read this document', 'read the document', 'read this pdf', 'read the pdf',
  'summarise this document', 'summarize this document', 'summarise the pdf',
  'summarize the pdf', 'extract from this document', 'analyse this document',
  'analyze this document', 'read this file', 'what does this document say',
];

const URL_PATTERN = /https?:\/\/[^\s<>"')]+/g;

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Strip the routing phrase so the research engine searches for the subject
 * rather than for the instruction. Only removes a leading verb phrase; if the
 * result would be too short to be a question, the original text is kept.
 */
function extractQuestion(text: string): string {
  const stripped = text
    .replace(/^\s*(please\s+)?(can you\s+|could you\s+|would you\s+)?/i, '')
    .replace(
      /^\s*(research|investigate|look into|find out|dig into|fact[- ]check|verify|check)\s+(whether|if|that|about|on|into)?\s*/i,
      '',
    )
    .replace(/\s+(thoroughly|in depth|in-depth|comprehensively|for me)\s*$/i, '')
    // Trailing instructions about the output are not part of the subject. A
    // live run searched for "…and cite sources" literally, which pulled in
    // citation-style pages instead of material about the topic.
    .replace(/\s+(and\s+)?(cite|with|include|show|give me|provide)\s+(the\s+)?(sources?|citations?|references?|links?)\s*$/i, '')
    .replace(/\s+(and\s+)?(cite|with)\s+(sources?|citations?|references?)\s*$/i, '')
    .trim();
  return stripped.length >= 8 ? stripped : text.trim();
}

export function routeChatIntent(message: string): IntentDecision {
  const text = message.trim();
  const lower = normalize(text);
  const seedUrls = [...new Set(text.match(URL_PATTERN) || [])];

  const verb = RESEARCH_VERBS.find((phrase) => lower.includes(phrase));
  const deep = DEEP_MARKERS.find((phrase) => lower.includes(phrase));
  const quick = QUICK_MARKERS.find((phrase) => lower.includes(phrase));

  // ---- Action intents -----------------------------------------------------
  // These are checked before research because "build a website about X" is a
  // build, not an investigation, even though it mentions a subject. A single
  // message may ask for several actions; they are collected, not short-circuited.
  const buildVerb = BUILD_VERBS.find((phrase) => lower.includes(phrase));
  const repoVerb = REPO_VERBS.find((phrase) => lower.includes(phrase));
  const deployVerb = DEPLOY_VERBS.find((phrase) => lower.includes(phrase));
  const selfBuildVerb = SELF_BUILD_VERBS.find((phrase) => lower.includes(phrase));
  const documentVerb = DOCUMENT_VERBS.find((phrase) => lower.includes(phrase));

  const actions = {
    build: Boolean(buildVerb),
    repository: Boolean(repoVerb),
    deploy: Boolean(deployVerb),
  };

  // Self-build is a change to RARE itself and takes precedence over a generic
  // build, because "add a department" is not a user project.
  if (selfBuildVerb) {
    return {
      intent: 'self_build',
      reason: `Matched the self-build phrase "${selfBuildVerb}".`,
      confidence: 0.9,
      depth: 'standard',
      seedUrls,
      question: text,
      actions,
    };
  }

  // A build request, optionally with repository and/or deploy in the same
  // message. This is the multi-department workflow the assignment requires.
  if (actions.build || actions.repository || actions.deploy) {
    const parts: string[] = [];
    if (actions.build) parts.push('build');
    if (actions.repository) parts.push('repository');
    if (actions.deploy) parts.push('deploy');
    return {
      intent: 'build',
      reason: `Matched action phrase(s): ${[buildVerb, repoVerb, deployVerb].filter(Boolean).join(', ')}.`,
      confidence: 0.9,
      depth: 'standard',
      seedUrls,
      question: text,
      actions,
      projectName: extractProjectName(text),
    };
  }

  // A document instruction with a link or a named file.
  if (documentVerb) {
    return {
      intent: 'documents',
      reason: `Matched the document phrase "${documentVerb}".`,
      confidence: 0.85,
      depth: 'standard',
      seedUrls,
      question: text,
    };
  }

  // A pasted link plus an instruction to read it is research even without a
  // research verb: "summarise this and check it against the news".
  const linkWithInstruction = seedUrls.length > 0
    && /\b(summar|check|compare|verify|research|investigate|read|analyse|analyze)\b/.test(lower);

  if (!verb && !linkWithInstruction) {
    return {
      intent: 'conversation',
      reason: 'No research verb or source request was present.',
      confidence: 0,
      depth: 'standard',
      seedUrls,
      question: text,
    };
  }

  const depth: IntentDecision['depth'] = deep ? 'deep' : quick ? 'quick' : 'standard';
  const confidence = verb ? (deep ? 0.95 : 0.85) : 0.7;

  return {
    intent: 'research',
    reason: verb
      ? `Matched the research phrase "${verb}".`
      : 'A link was supplied together with an instruction to read or check it.',
    confidence,
    depth,
    seedUrls,
    question: extractQuestion(text),
  };
}

/**
 * Pull an explicit project name out of an instruction, e.g.
 * `build a website called "aurora"` or `create an app named aurora`.
 * Returns undefined when the user did not name one, so the caller can derive
 * a slug from the instruction instead.
 */
function extractProjectName(text: string): string | undefined {
  const quoted = text.match(/(?:called|named)\s+["'“]([^"'”]{2,40})["'”]/i);
  if (quoted) return quoted[1].trim();
  const bare = text.match(/(?:called|named)\s+([a-z0-9][a-z0-9 _-]{1,30})/i);
  if (bare) return bare[1].trim();
  return undefined;
}

/**
 * Map a routed intent onto the concrete capabilities that must run for it.
 *
 * This is the join between "what the user asked for" and "what the system can
 * actually do". It is deliberately a pure function over the IntentDecision so
 * the mapping is inspectable and testable, and it is filtered against the live
 * CapabilityRegistry by the caller — a capability that is not registered is
 * never returned, so Chat can never claim to have routed work to a department
 * that does not exist.
 *
 * Order matters: the returned list is a dependency-ordered plan. Research that
 * must become a document runs research first, then the document write.
 */
export function capabilitiesForIntent(decision: IntentDecision): string[] {
  switch (decision.intent) {
    case 'research':
      return ['research.run'];
    case 'documents':
      return ['documents.list'];
    case 'build': {
      const plan: string[] = ['builder.deliver'];
      return plan;
    }
    case 'repository':
      return ['repository.create'];
    case 'deploy':
      return ['deployment.static'];
    case 'self_build':
      return ['builder.toolchains'];
    case 'conversation':
    default:
      return [];
  }
}

/**
 * True when the message asks for research *and* a document deliverable, e.g.
 * "research this and prepare a PDF report". That combination is a single
 * cross-department workflow, not two independent requests, so it maps to the
 * one capability that performs both stages in order.
 */
export function isResearchToDocument(decision: IntentDecision, message: string): boolean {
  if (decision.intent !== 'research') return false;
  return /\b(pdf|report|document|write[- ]?up|memo|brief)\b/i.test(message);
}

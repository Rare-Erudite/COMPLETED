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

export type ChatIntent = 'conversation' | 'research';

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

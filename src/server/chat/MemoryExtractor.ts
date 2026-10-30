/**
 * MemoryExtractor — turns a real chat turn into durable, owner-scoped memories.
 *
 * Defect this fixes (Stage 1, Chat): the Chat workspace invited the user to
 * "chat casually about any topic — my permanent memory retains everything we
 * discuss", but nothing ever wrote a memory. `GET /api/memories` stayed empty
 * after a conversation, so the promise was false and continuation by memory
 * could never work.
 *
 * Design constraints:
 *  - Deterministic and offline: extraction must not depend on a model provider
 *    being reachable, otherwise memory silently stops working exactly when the
 *    app is degraded.
 *  - Owner-scoped: this module never touches storage. It returns candidate
 *    records; the caller writes them with the authenticated owner id.
 *  - Conservative: only statements the user actually asserts are captured.
 *    Questions, instructions and pleasantries are not memories.
 *  - Sensitive values are never retained (see `isSensitive`).
 */

export type MemoryKind =
  | 'preference'
  | 'identity'
  | 'user_fact'
  | 'project_decision'
  | 'technical_constraint'
  | 'discussion';

export interface ExtractedMemory {
  kind: MemoryKind;
  text: string;
  tags: string[];
  importance: number;
  /** Stable hash of the normalised text, used to dedupe re-sent turns. */
  fingerprint: string;
}

export interface ExtractionOptions {
  /** Conversation the turn belongs to, recorded in the tags for provenance. */
  conversationId?: string;
  /** Maximum memories produced from one turn (default 4). */
  limit?: number;
}

const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(?:password|passwd|passkey|pwd)\b\s*(?:is|:|=)\s*\S+/i, label: 'password' },
  { pattern: /\b(?:\d[ -]*?){13,19}\b/, label: 'card number' },
  { pattern: /\b(?:cvv|cvc|security code)\b\s*(?:is|:|=)?\s*\d{3,4}/i, label: 'card security code' },
  { pattern: /\b(?:iban|account number|routing number)\b\s*(?:is|:|=)?\s*[\d ]{6,}/i, label: 'bank account' },
  { pattern: /\b(?:api[_ -]?key|secret[_ -]?key|access[_ -]?token|bearer)\b\s*(?:is|:|=)\s*\S{8,}/i, label: 'api key' },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: 'private key' },
  { pattern: /\b(?:my )?(?:ssn|social security)\b\s*(?:is|:|=)?\s*\d/i, label: 'national id' },
  { pattern: /\b\d{6}\b\s*(?:is|:)?\s*(?:my )?(?:otp|one[- ]time|verification code)/i, label: 'one-time code' },
];

/** True when the text carries a credential or regulated identifier. */
export function isSensitive(text: string): boolean {
  return SENSITIVE_PATTERNS.some(({ pattern }) => pattern.test(text));
}

/** Lowercased, punctuation-collapsed form used for comparison and hashing. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fingerprint(text: string): string {
  // FNV-1a over the normalised text: dependency-free, stable across processes,
  // and only used for dedupe (never for security).
  const value = normalise(text);
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fp_${hash.toString(16).padStart(8, '0')}`;
}

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'before', 'being', 'could', 'should', 'their',
  'there', 'these', 'those', 'think', 'would', 'where', 'which', 'while',
  'what', 'when', 'with', 'from', 'have', 'does', 'that', 'this', 'your',
  'just', 'like', 'really', 'very', 'much', 'some', 'then', 'than', 'also',
  'into', 'over', 'them', 'they', 'want', 'need', 'make', 'made', 'going',
]);

/** Topical tags derived from the content words of a statement. */
function tagsFor(text: string, extra: string[] = []): string[] {
  const words = normalise(text)
    .split(' ')
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word));
  const unique: string[] = [];
  for (const word of words) {
    if (!unique.includes(word)) unique.push(word);
    if (unique.length >= 6) break;
  }
  return [...new Set([...extra, ...unique])].slice(0, 10);
}

/**
 * Split a user turn into candidate statements. Only declarative first-person or
 * possessive statements are kept: they are the ones the user actually asserts
 * about themselves, their work or their decisions.
 */
function candidateStatements(message: string): string[] {
  return message
    .split(/(?<=[.!?;\n])\s+|\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 12 && part.length <= 400)
    // A question is a request for information, not a fact about the user.
    .filter((part) => !/\?\s*$/.test(part))
    // Instructions to the assistant are tasks, not memories.
    .filter((part) => !/^(?:please|can you|could you|would you|write|build|make|create|generate|find|show|tell me|list|explain)\b/i.test(part));
}

interface Rule {
  kind: MemoryKind;
  importance: number;
  extraTags: string[];
  test: RegExp;
}

/**
 * Declarative patterns that reliably indicate a durable fact about the user.
 * Ordered most-specific first; the first matching rule classifies a statement.
 */
const RULES: Rule[] = [
  {
    kind: 'identity',
    importance: 5,
    extraTags: ['identity'],
    test: /\b(?:my name is|i am|i'm|call me)\s+[A-Z][\p{L}'-]{1,30}\b/iu,
  },
  {
    kind: 'preference',
    importance: 3,
    extraTags: ['preference'],
    test: /\bi\s+(?:really\s+)?(?:love|like|prefer|enjoy|hate|dislike|adore|always use|never use)\b/i,
  },
  {
    kind: 'preference',
    importance: 3,
    extraTags: ['preference'],
    test: /\b(?:my favou?rite|my preferred|i(?:'m| am) (?:a )?(?:fan of))\b/i,
  },
  {
    kind: 'technical_constraint',
    importance: 4,
    extraTags: ['constraint', 'technical'],
    test: /\b(?:must|required to|has to|cannot|can't|do not|don't|never)\b.*\b(?:support|deploy|run|store|use|allow|accept)\b/i,
  },
  {
    kind: 'technical_constraint',
    importance: 4,
    extraTags: ['stack', 'technical'],
    test: /\b(?:we|i)\s+(?:use|are using|run|are running|build with|work in)\b\s+(?:node|typescript|python|react|postgres|supabase|vercel|docker|kotlin|swift|flutter|dart|rust|go|java)\b/i,
  },
  {
    kind: 'project_decision',
    importance: 4,
    extraTags: ['decision', 'project'],
    test: /\b(?:we|i)\s+(?:decided|chose|agreed|settled on|went with|picked)\b/i,
  },
  {
    kind: 'user_fact',
    importance: 3,
    extraTags: ['fact'],
    test: /\b(?:my|our)\s+(?:team|company|project|product|app|client|customer|deadline|budget|goal|role|job|office)\b/i,
  },
  {
    kind: 'user_fact',
    importance: 3,
    extraTags: ['fact'],
    test: /\bi\s+(?:work|live|study|manage|lead|own|run|report)\b/i,
  },
  {
    kind: 'discussion',
    importance: 2,
    extraTags: ['discussion'],
    test: /\b(?:let'?s discuss|let us discuss|we(?:'re| are) (?:talking|discussing|working) (?:about|on))\b/i,
  },
];

/**
 * Extract durable memories from one user turn.
 *
 * Returns an empty array when the turn asserts nothing durable — that is the
 * common case for ordinary conversation, and reporting it honestly is the
 * point: the memory list must reflect what was really captured.
 */
export function extractMemories(
  message: string,
  options: ExtractionOptions = {},
): ExtractedMemory[] {
  const limit = Math.max(1, Math.min(10, options.limit ?? 4));
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text || text.length < 12) return [];
  // A turn dominated by a credential must not be persisted in any form.
  if (isSensitive(text)) return [];

  const out: ExtractedMemory[] = [];
  const seen = new Set<string>();

  for (const statement of candidateStatements(text)) {
    if (isSensitive(statement)) continue;
    const rule = RULES.find((candidate) => candidate.test.test(statement));
    if (!rule) continue;

    const cleaned = statement.replace(/\s+/g, ' ').trim().slice(0, 500);
    const print = fingerprint(cleaned);
    if (seen.has(print)) continue;
    seen.add(print);

    const extra = options.conversationId ? [...rule.extraTags, `conv:${options.conversationId}`] : rule.extraTags;
    out.push({
      kind: rule.kind,
      text: cleaned,
      tags: tagsFor(cleaned, extra),
      importance: rule.importance,
      fingerprint: print,
    });
    if (out.length >= limit) break;
  }

  return out;
}

/**
 * Merge newly extracted memories into an existing owner-scoped memory list,
 * skipping anything already present (by fingerprint or normalised text).
 * Returns the new list and the records that were actually added, so callers
 * can report the truth rather than assuming every candidate was stored.
 */
export function mergeMemories(
  existing: Array<Record<string, any>>,
  candidates: ExtractedMemory[],
  now: () => string = () => new Date().toISOString(),
): { next: Array<Record<string, any>>; added: Array<Record<string, any>> } {
  const known = new Set<string>();
  for (const record of existing) {
    if (!record || typeof record.text !== 'string') continue;
    known.add(record.fingerprint || fingerprint(record.text));
    known.add(fingerprint(record.text));
  }

  const added: Array<Record<string, any>> = [];
  for (const candidate of candidates) {
    if (known.has(candidate.fingerprint)) continue;
    known.add(candidate.fingerprint);
    added.push({
      id: `mem_${candidate.fingerprint.slice(3)}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: now(),
      kind: candidate.kind,
      text: candidate.text,
      tags: candidate.tags,
      importance: candidate.importance,
      source: 'system_inferred',
      verifiedByUser: false,
      fingerprint: candidate.fingerprint,
    });
  }

  return { next: [...added, ...existing], added };
}

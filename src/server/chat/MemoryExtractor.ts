/**
 * MemoryExtractor — deterministic, offline, owner-scoped memory extraction.
 *
 * The product promises a permanent memory that "retains everything we discuss".
 * Before this module existed, nothing ever wrote a memory from a chat turn: the
 * UI read `GET /api/memories`, which stayed empty forever. This closes that gap
 * without a second model call and without fabricating anything.
 *
 * Design rules:
 *  - Conservative. It is better to miss a memory than to store noise. A memory
 *    is only produced when the user states something durable about themselves,
 *    their work, their preferences, their decisions or their constraints.
 *  - Never stores questions, greetings, commands, or short acknowledgements.
 *  - Never stores credentials or secrets, even when they look like a statement.
 *  - Deduplicates against what is already stored.
 */

export type MemoryKind = 'preference' | 'identity' | 'fact' | 'decision' | 'constraint';

export interface ExtractedMemory {
  text: string;
  kind: MemoryKind;
  tags: string[];
  importance: number;
}

const GREETING_ONLY = /^(?:hi|hey|hello|yo|how far|good (?:morning|afternoon|evening)|thanks|thank you|ok|okay|cool|nice|great|sure|yes|no|yeah|nah)[\s!.,?]*$/i;

// Anything that looks like a credential is never persisted, regardless of the
// sentence it appears in.
const SECRET_LIKE = /(?:api[_\s-]?key|secret|password|passcode|token|bearer\s+[a-z0-9._-]{10,}|sk-[a-z0-9]{10,}|ghp_[a-z0-9]{10,})/i;

const IDENTITY_PATTERNS: RegExp[] = [
  /\bmy name is\b/i,
  /\bi am called\b/i,
  /\bcall me\b/i,
  /\bi work (?:as|at|for)\b/i,
  /\bi'?m (?:an?|the) [a-z][\w\s-]{2,40}(?:engineer|developer|designer|manager|student|teacher|doctor|nurse|analyst|scientist|founder|architect|consultant|researcher)\b/i,
  /\bi live in\b/i,
  /\bi'?m based in\b/i,
  /\bi'?m from\b/i,
  /\bmy (?:job|role|profession|occupation) is\b/i,
  /\bmy (?:birthday|timezone|time zone) is\b/i,
  /\bi speak\b/i,
  /\bi'?m learning\b/i,
];

const PREFERENCE_PATTERNS: RegExp[] = [
  /\bi (?:really |also |usually |always |just )?(?:like|love|prefer|enjoy|fancy|adore|hate|dislike|avoid)\b/i,
  /\bmy favou?rite\b/i,
  /\bi'?m (?:a )?(?:big )?fan of\b/i,
  /\bi'?m not (?:a )?(?:big )?fan of\b/i,
  /\bi (?:can'?t|cannot) stand\b/i,
  /\bi'?d (?:rather|prefer)\b/i,
];

const DECISION_PATTERNS: RegExp[] = [
  /\b(?:we|i) (?:decided|agreed|chose|settled on)\b/i,
  /\blet'?s (?:use|go with|stick with|do)\b/i,
  /\b(?:we|i)(?:'| a)?re going (?:to use|with)\b/i,
  /\b(?:we|i) should use\b/i,
  /\bthe plan is\b/i,
];

const CONSTRAINT_PATTERNS: RegExp[] = [
  /\bi (?:always|never)\b/i,
  /\bi (?:must|need to|have to) (?:always|never)\b/i,
  /\b(?:don'?t|do not|never) (?:use|call|touch|change|delete)\b/i,
  /\bi (?:can'?t|cannot) (?:use|work with|access)\b/i,
];

const FACT_PATTERNS: RegExp[] = [
  /\bmy (?:project|team|company|client|product|app|website|repo|repository|deadline|goal|budget) (?:is|called|uses|runs|needs|requires)\b/i,
  /\bi (?:have|own|manage|run|maintain) (?:a|an|the|my)\b/i,
  /\bi'?m (?:building|working on|developing|maintaining)\b/i,
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function deriveTags(text: string, kind: MemoryKind): string[] {
  const tags = new Set<string>([kind]);
  const terms = normalize(text)
    .split(' ')
    .filter((term) => term.length >= 4 && !STOP_WORDS.has(term));
  // Keep the most specific few terms so memory search can match later.
  for (const term of terms.slice(0, 6)) tags.add(term);
  return [...tags];
}

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'before', 'being', 'could', 'should', 'their',
  'there', 'these', 'those', 'think', 'would', 'where', 'which', 'while',
  'what', 'when', 'with', 'from', 'have', 'does', 'that', 'this', 'your',
  'youre', 'really', 'usually', 'always', 'never', 'just', 'like', 'love',
  'prefer', 'enjoy', 'favourite', 'favorite', 'want', 'need', 'make', 'made',
  'very', 'much', 'some', 'then', 'than', 'them', 'they', 'also', 'into',
]);

function classify(sentence: string): { kind: MemoryKind; importance: number } | null {
  if (IDENTITY_PATTERNS.some((pattern) => pattern.test(sentence))) {
    return { kind: 'identity', importance: 5 };
  }
  if (CONSTRAINT_PATTERNS.some((pattern) => pattern.test(sentence))) {
    return { kind: 'constraint', importance: 4 };
  }
  if (DECISION_PATTERNS.some((pattern) => pattern.test(sentence))) {
    return { kind: 'decision', importance: 4 };
  }
  if (PREFERENCE_PATTERNS.some((pattern) => pattern.test(sentence))) {
    return { kind: 'preference', importance: 3 };
  }
  if (FACT_PATTERNS.some((pattern) => pattern.test(sentence))) {
    return { kind: 'fact', importance: 3 };
  }
  return null;
}

/**
 * Extract durable memories from a single user message.
 *
 * @param message        the raw user message text
 * @param existingTexts  normalized texts already stored for this owner, used to dedupe
 */
export function extractMemories(message: string, existingTexts: string[] = []): ExtractedMemory[] {
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text || text.length < 8) return [];
  if (GREETING_ONLY.test(text)) return [];
  if (SECRET_LIKE.test(text)) return [];

  const known = new Set(existingTexts.map((entry) => normalize(entry)));
  const seen = new Set<string>();
  const results: ExtractedMemory[] = [];

  for (const sentence of splitSentences(text)) {
    // A question is not a statement of durable fact.
    if (/\?\s*$/.test(sentence)) continue;
    if (sentence.length < 8 || sentence.length > 500) continue;
    if (GREETING_ONLY.test(sentence)) continue;
    if (SECRET_LIKE.test(sentence)) continue;

    const classification = classify(sentence);
    if (!classification) continue;

    const key = normalize(sentence);
    if (!key || known.has(key) || seen.has(key)) continue;
    seen.add(key);

    results.push({
      text: sentence.replace(/\s+/g, ' ').trim().slice(0, 500),
      kind: classification.kind,
      tags: deriveTags(sentence, classification.kind),
      importance: classification.importance,
    });

    // One memory per turn keeps the store clean and predictable.
    if (results.length >= 1) break;
  }

  return results;
}

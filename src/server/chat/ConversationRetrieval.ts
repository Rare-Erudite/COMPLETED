/**
 * ConversationRetrieval — owner-scoped continuation and retrieval over the
 * user's full conversation history.
 *
 * Defect this fixes (Stage 1, Chat): a user could close the app, come back and
 * say "let's continue our discussion about the shoes" and RARE had no way to
 * find that conversation. `GET /api/conversations?search=` did a naive
 * `title.includes()` / `messages.some(includes())` on the raw query string, so
 * a sentence like "continue our discussion about the shoes" matched nothing
 * unless the literal sentence appeared in the history. Only the last 20
 * messages were ever used as model context, so long conversations silently lost
 * their beginning.
 *
 * This module is pure: it receives already owner-scoped conversations from the
 * caller and never reads storage itself.
 */

import type { ExtractedMemory } from './MemoryExtractor.js';

export interface RetrievableMessage {
  id?: string;
  role: string;
  content: string;
  timestamp?: string;
}

export interface RetrievableConversation {
  id: string;
  title?: string;
  created_at?: string;
  messages?: RetrievableMessage[];
  customTitle?: boolean;
}

export interface RetrievalHit {
  conversationId: string;
  title: string;
  score: number;
  /** Why this conversation matched — used to explain the choice honestly. */
  reasons: string[];
  /** The messages most relevant to the query, oldest first. */
  messages: RetrievableMessage[];
  lastActivity: string;
}

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'before', 'being', 'could', 'should', 'their',
  'there', 'these', 'those', 'think', 'would', 'where', 'which', 'while',
  'what', 'when', 'with', 'from', 'have', 'does', 'that', 'this', 'your',
  'just', 'like', 'really', 'very', 'much', 'some', 'then', 'than', 'also',
  'into', 'over', 'them', 'they', 'want', 'need', 'make', 'made', 'going',
  'continue', 'continuing', 'discussion', 'discuss', 'conversation', 'chat',
  'talk', 'talking', 'earlier', 'previous', 'before', 'again', 'back', 'our',
  'the', 'and', 'for', 'you', 'are', 'can', 'let', 'now', 'did', 'was',
]);

/** Content-bearing terms (length >= 4, not a stop word). */
export function queryTerms(query: string): string[] {
  const raw = (query || '').toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || [];
  return [...new Set(raw.filter((term) => !STOP_WORDS.has(term)))];
}

/**
 * Fold a term to its singular-ish form so "shoe" and "shoes" match.
 * Deliberately conservative: only trailing plural markers, never stemming that
 * could conflate unrelated words ("analysis" must not become "analysi").
 */
export function foldTerm(term: string): string {
  const value = (term || '').toLowerCase().trim();
  if (value.length < 4) return value;
  if (value.endsWith('ies') && value.length > 5) return `${value.slice(0, -3)}y`;
  if (/(?:ches|shes|sses|xes)$/.test(value)) return value.slice(0, -2);
  if (value.endsWith('s') && !value.endsWith('ss') && !value.endsWith('us')) return value.slice(0, -1);
  return value;
}

/**
 * Explicit concept groups for product/domain vocabulary where the user's words
 * and the conversation's words legitimately differ ("shoes" vs "sneakers").
 *
 * This is a hand-written equivalence list, not a semantic model: every entry is
 * a claim someone can inspect and audit. It exists because a term-overlap match
 * is only as good as its vocabulary, and the honest fix is a small explicit map
 * plus a reason that names the substitution — never a silent "semantic" guess.
 */
const CONCEPT_GROUPS: string[][] = [
  ['shoe', 'sneaker', 'trainer', 'footwear', 'boot', 'sandal', 'loafer'],
  ['car', 'vehicle', 'automobile', 'truck', 'suv'],
  ['phone', 'smartphone', 'mobile', 'iphone', 'android'],
  ['laptop', 'notebook', 'computer', 'macbook'],
  ['house', 'home', 'apartment', 'flat', 'property'],
  ['job', 'role', 'position', 'career', 'employment'],
  ['doctor', 'physician', 'clinician', 'gp'],
  ['invoice', 'bill', 'receipt', 'statement'],
  ['recipe', 'dish', 'meal', 'food', 'cooking'],
  ['workout', 'exercise', 'training', 'gym'],
  ['tax', 'taxes', 'filing', 'return'],
  ['diet', 'nutrition', 'eating', 'macros'],
];

const CONCEPT_INDEX: Map<string, string[]> = (() => {
  const index = new Map<string, string[]>();
  for (const group of CONCEPT_GROUPS) {
    const folded = group.map(foldTerm);
    for (const member of folded) {
      const existing = index.get(member) || [];
      index.set(member, [...new Set([...existing, ...folded])]);
    }
  }
  return index;
})();

/**
 * Every form of a query term that should count as a match: the term itself, its
 * folded form, and any word in its documented concept group.
 */
export function termVariants(term: string): string[] {
  const folded = foldTerm(term);
  const group = CONCEPT_INDEX.get(folded) || [];
  return [...new Set([term.toLowerCase(), folded, ...group])];
}

/**
 * Does a piece of text support this query term, either directly or through a
 * documented concept equivalent? Returns the word that matched so callers can
 * explain the result instead of asserting it.
 */
export function findSupportingTerm(text: string, term: string): { matchedTerm: string; direct: boolean } | null {
  const normalised = normalise(text);
  if (!normalised) return null;
  if (normalised.includes(foldTerm(term))) return { matchedTerm: term, direct: true };
  for (const variant of termVariants(term)) {
    if (variant === foldTerm(term)) continue;
    // Word-boundary check keeps "car" out of "cartoon".
    if (new RegExp(`(?:^|[^\\p{L}\\p{N}])${variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^\\p{L}\\p{N}]|$)`, 'u').test(normalised)) {
      return { matchedTerm: variant, direct: false };
    }
  }
  return null;
}

/**
 * Does this user turn ask to continue an existing conversation rather than
 * start a new one? Explicit continuation is the difference between "new chat"
 * and "resume our old chat", which the spec requires us not to conflate.
 */
export function isContinuationRequest(message: string): boolean {
  const text = (message || '').toLowerCase().trim();
  if (!text || text.length > 400) return false;
  const patterns: RegExp[] = [
    /\b(?:let'?s|let us)\s+(?:continue|resume|carry on|pick up)\b/,
    /\bcontinue\s+(?:our|the|my|that|this)\s+(?:discussion|conversation|chat|talk|thread|work)\b/,
    /\bresume\s+(?:our|the|my|that|this)\s+(?:discussion|conversation|chat|talk|thread|work)\b/,
    /\b(?:pick up where we left off|where we left off)\b/,
    /\b(?:go back to|return to|back to)\s+(?:our|the|my|that)\s+(?:discussion|conversation|chat)\b/,
    /\b(?:in|on)\s+our\s+(?:previous|last|earlier|old)\s+(?:chat|conversation|discussion)\b/,
    /\b(?:our|the)\s+(?:previous|last|earlier|old)\s+(?:chat|conversation|discussion)\s+about\b/,
  ];
  return patterns.some((pattern) => pattern.test(text));
}

function normalise(text: string): string {
  return (text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function messageTimestamp(conversation: RetrievableConversation): number {
  const messages = conversation.messages || [];
  const last = messages[messages.length - 1];
  return Date.parse(last?.timestamp || conversation.created_at || '') || 0;
}

/**
 * Score every owner conversation against a query and return the best matches.
 *
 * Scoring is deliberately transparent rather than semantic-sounding: title
 * match, content-term frequency and recency each contribute, and the reasons
 * are returned so the caller can tell the user why a conversation was chosen
 * instead of presenting a guess as certainty.
 */
export function findRelevantConversations(
  conversations: RetrievableConversation[],
  query: string,
  options: { limit?: number; excludeId?: string } = {},
): RetrievalHit[] {
  const terms = queryTerms(query);
  if (!terms.length) return [];
  const limit = Math.max(1, Math.min(20, options.limit ?? 5));
  const now = Date.now();

  const hits: RetrievalHit[] = [];

  for (const conversation of conversations) {
    if (!conversation?.id) continue;
    if (options.excludeId && conversation.id === options.excludeId) continue;

    const title = conversation.title || 'Untitled chat';
    const titleText = normalise(title);
    const messages = (conversation.messages || []).filter(
      (message) => typeof message?.content === 'string' && message.content.trim().length > 0,
    );
    const bodyText = normalise(messages.map((message) => message.content).join(' '));
    if (!bodyText && !titleText) continue;

    const reasons: string[] = [];
    let score = 0;

    for (const term of terms) {
      // Title evidence is stronger than body evidence, but a concept-equivalent
      // word counts for less than the user's exact word so an exact match always
      // outranks an inferred one.
      const titleSupport = findSupportingTerm(titleText, term);
      if (titleSupport) {
        score += titleSupport.direct ? 6 : 4;
        reasons.push(
          titleSupport.direct
            ? `title mentions "${term}"`
            : `title mentions related term "${titleSupport.matchedTerm}" for "${term}"`,
        );
      }

      // Count occurrences in the body, capped so one repeated word cannot
      // dominate the ranking.
      let occurrences = 0;
      const bodySupport = findSupportingTerm(bodyText, term);
      if (bodySupport) {
        let index = bodyText.indexOf(bodySupport.matchedTerm);
        while (index !== -1 && occurrences < 8) {
          occurrences += 1;
          index = bodyText.indexOf(bodySupport.matchedTerm, index + bodySupport.matchedTerm.length);
        }
      }
      if (occurrences > 0) {
        score += Math.min(occurrences, 8) * (bodySupport?.direct ? 2 : 1);
        reasons.push(
          bodySupport?.direct
            ? `message content mentions "${term}" x${occurrences}`
            : `message content mentions related term "${bodySupport?.matchedTerm}" for "${term}" x${occurrences}`,
        );
      }
    }

    if (score === 0) continue;

    // Recency: a conversation touched this week outranks one from months ago
    // when the textual evidence is otherwise equal.
    const lastActivityMs = messageTimestamp(conversation);
    if (lastActivityMs > 0) {
      const ageDays = (now - lastActivityMs) / 86_400_000;
      if (ageDays <= 7) {
        score += 4;
        reasons.push('recent activity (last 7 days)');
      } else if (ageDays <= 30) {
        score += 2;
        reasons.push('recent activity (last 30 days)');
      }
    }

    // A user-named conversation is a stronger signal than an auto-title.
    if (conversation.customTitle) score += 1;

    hits.push({
      conversationId: conversation.id,
      title,
      score,
      reasons: [...new Set(reasons)].slice(0, 6),
      messages: messages.slice(-40),
      lastActivity: new Date(lastActivityMs || now).toISOString(),
    });
  }

  return hits.sort((left, right) => right.score - left.score).slice(0, limit);
}

/**
 * Build the model context for a long conversation.
 *
 * The old behaviour kept only the last 20 messages, which loses the opening of
 * any real discussion. This keeps a bounded window but always includes the
 * first user/assistant exchange (where the topic is usually established) plus
 * any message that matches the current question, so "what did I say about X"
 * can still be answered in a 200-message thread.
 */
export function buildConversationContext(
  messages: RetrievableMessage[],
  prompt: string,
  options: { maxMessages?: number; maxCharsPerMessage?: number } = {},
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const maxMessages = Math.max(4, options.maxMessages ?? 24);
  const maxChars = Math.max(200, options.maxCharsPerMessage ?? 1200);

  const usable = messages.filter(
    (message) =>
      (message.role === 'user' || message.role === 'assistant') &&
      typeof message.content === 'string' &&
      message.content.trim().length > 0,
  );
  if (!usable.length) return [];

  const terms = queryTerms(prompt);
  const selected = new Set<number>();

  // The opening exchange establishes the subject of the conversation.
  selected.add(0);
  if (usable.length > 1) selected.add(1);

  // Recent tail, respecting the budget.
  for (let index = usable.length - 1; index >= 0 && selected.size < maxMessages; index -= 1) {
    selected.add(index);
  }

  // Anything that matches the current question, even if it is old.
  if (terms.length) {
    for (let index = 0; index < usable.length && selected.size < maxMessages + 6; index += 1) {
      const content = normalise(usable[index].content);
      if (terms.some((term) => content.includes(term))) selected.add(index);
    }
  }

  return [...selected]
    .sort((left, right) => left - right)
    .map((index) => ({
      role: usable[index].role as 'user' | 'assistant',
      content: usable[index].content.trim().slice(0, maxChars),
    }));
}

/**
 * Compose a compact "what we were discussing" brief from an existing
 * conversation, so a resumed chat continues rather than restarts.
 */
export function buildResumeBrief(
  conversation: RetrievableConversation,
  memories: ExtractedMemory[] | Array<Record<string, any>> = [],
): string {
  const messages = (conversation.messages || []).filter(
    (message) => typeof message?.content === 'string' && message.content.trim(),
  );
  const userTurns = messages.filter((message) => message.role === 'user');
  const topics = queryTerms(userTurns.slice(0, 4).map((message) => message.content).join(' ')).slice(0, 6);

  const lines: string[] = [];
  lines.push(`Resuming conversation "${conversation.title || 'Untitled chat'}" (${conversation.id}).`);
  if (topics.length) lines.push(`Established topics: ${topics.join(', ')}.`);
  lines.push(`Turns so far: ${messages.length}.`);

  const relevantMemories = memories
    .filter((memory) => typeof (memory as any)?.text === 'string')
    .slice(0, 4)
    .map((memory) => `- ${String((memory as any).text).slice(0, 240)}`);
  if (relevantMemories.length) {
    lines.push('Remembered details:');
    lines.push(...relevantMemories);
  }

  return lines.join('\n');
}

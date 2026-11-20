/**
 * Okapi BM25 ranking for RARE memory retrieval.
 *
 * Adapted from the RARE-INTELLIGENCE engine's `rare_engine/memory/bm25.py`
 * (same repository family, same author) and reimplemented in TypeScript so the
 * server can rank memories without a model or a network call.
 *
 * Formula (standard Okapi BM25):
 *
 *   idf(t)      = ln(1 + (N - df + 0.5) / (df + 0.5))
 *   score(D, q) = Σ over t in q of
 *                 idf(t) * tf(t,D) * (k1 + 1)
 *                 / (tf(t,D) + k1 * (1 - b + b * |D| / avgdl))
 *
 * The `1 +` form of idf is used deliberately: it cannot go negative for terms
 * that appear in more than half the corpus, which the classic form can. A
 * negative weight would make a more relevant document score lower.
 *
 * Defaults k1 = 1.5, b = 0.75 are the values used almost everywhere in the
 * literature and are not tuned to any particular corpus.
 */

export interface Bm25Params {
  k1: number;
  b: number;
}

export const DEFAULT_BM25_PARAMS: Bm25Params = { k1: 1.5, b: 0.75 };

/** Tokenise to lowercase alphanumeric terms. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

export function idf(nDocs: number, docFreq: number): number {
  if (nDocs <= 0 || docFreq <= 0) return 0;
  return Math.log(1 + (nDocs - docFreq + 0.5) / (docFreq + 0.5));
}

export interface RankableDocument {
  /** The text that is indexed and scored. */
  text: string;
}

/**
 * Rank documents against a query with BM25. Returns the documents that share at
 * least one term with the query, best first. Ties keep the input order, so the
 * result is deterministic.
 */
export function rankByBm25<T extends RankableDocument>(
  documents: T[],
  query: string,
  params: Bm25Params = DEFAULT_BM25_PARAMS,
): T[] {
  const queryTerms = Array.from(new Set(tokenize(query)));
  if (queryTerms.length === 0 || documents.length === 0) return [];

  const docTokens = documents.map((doc) => tokenize(doc.text));
  const docLengths = docTokens.map((tokens) => tokens.length);
  const avgdl = docLengths.reduce((sum, len) => sum + len, 0) / documents.length || 1;

  const docFreq = new Map<string, number>();
  for (const tokens of docTokens) {
    for (const term of new Set(tokens)) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
  }

  const scored = documents.map((doc, index) => {
    const tokens = docTokens[index];
    const length = docLengths[index];
    const termFreq = new Map<string, number>();
    for (const token of tokens) termFreq.set(token, (termFreq.get(token) ?? 0) + 1);

    let score = 0;
    for (const term of queryTerms) {
      const tf = termFreq.get(term) ?? 0;
      if (tf === 0) continue;
      const df = docFreq.get(term) ?? 0;
      const termIdf = idf(documents.length, df);
      const denominator = tf + params.k1 * (1 - params.b + (params.b * length) / avgdl);
      score += (termIdf * tf * (params.k1 + 1)) / denominator;
    }
    return { doc, score, index };
  });

  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .map((entry) => entry.doc);
}

/** Convenience wrapper for memory records: index text, tags and kind together. */
export function rankMemoriesByBm25<T extends { text: string; tags: string[]; kind: string }>(
  memories: T[],
  query: string,
): T[] {
  const indexed = memories.map((memory) => ({
    memory,
    text: `${memory.text} ${memory.tags.join(' ')} ${memory.kind}`,
  }));
  return rankByBm25(indexed, query).map((entry) => entry.memory);
}

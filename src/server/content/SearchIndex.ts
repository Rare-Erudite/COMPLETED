/**
 * SearchIndex — per-owner inverted index over extracted content.
 *
 * Deliberately dependency-free and in-process: it is rebuilt from the owner's
 * persisted documents on demand, so a restart never loses the ability to
 * search, and deleting a document removes it from the index. Every entry is
 * keyed by owner, so one user's content can never be retrieved by another.
 */

import { ContentChunk } from './ContentEngine.js';

export interface IndexedDocument {
  /** Stable id within the owner's library (the document path). */
  id: string;
  title: string;
  /** Where the content came from: document, transcript, research, web. */
  origin: 'document' | 'transcript' | 'research' | 'web';
  sourceUrl?: string;
  updatedAt?: string;
  chunks: ContentChunk[];
}

export interface SearchHit {
  documentId: string;
  title: string;
  origin: IndexedDocument['origin'];
  sourceUrl?: string;
  chunkIndex: number;
  page?: number;
  section?: string;
  /** The matching passage, trimmed around the match. */
  snippet: string;
  score: number;
  /** Which strategy produced this hit. */
  matchedBy: 'phrase' | 'terms' | 'both';
}

export interface SearchOptions {
  /** Restrict to specific origins. */
  origins?: Array<IndexedDocument['origin']>;
  /** Maximum hits to return. Defaults to 20. */
  limit?: number;
  /** Require this exact phrase (case-insensitive) to be present. */
  phrase?: string;
  /** Only documents updated at/after this ISO date. */
  updatedAfter?: string;
}

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have', 'in', 'is', 'it', 'its', 'of',
  'on', 'or', 'that', 'the', 'to', 'was', 'were', 'will', 'with', 'what', 'which', 'who', 'how', 'why', 'when',
]);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) || []).filter(
    (token) => token.length > 1 && !STOPWORDS.has(token),
  );
}

interface Posting {
  documentId: string;
  chunkIndex: number;
  termFrequency: number;
}

export class SearchIndex {
  private documents = new Map<string, IndexedDocument>();
  private postings = new Map<string, Posting[]>();
  private documentFrequency = new Map<string, number>();
  private totalChunks = 0;
  private averageChunkLength = 0;
  private chunkLengths = new Map<string, number>();

  /** Replace the whole index for one owner. */
  rebuild(documents: IndexedDocument[]): void {
    this.documents.clear();
    this.postings.clear();
    this.documentFrequency.clear();
    this.chunkLengths.clear();
    this.totalChunks = 0;

    for (const document of documents) this.upsert(document);

    let totalLength = 0;
    for (const length of this.chunkLengths.values()) totalLength += length;
    this.averageChunkLength = this.totalChunks > 0 ? totalLength / this.totalChunks : 0;
  }

  /** Add or replace a single document (incremental indexing). */
  upsert(document: IndexedDocument): void {
    this.remove(document.id);
    this.documents.set(document.id, document);

    for (const chunk of document.chunks) {
      const key = `${document.id}#${chunk.index}`;
      const tokens = tokenize(chunk.text);
      this.chunkLengths.set(key, tokens.length);
      this.totalChunks += 1;

      const frequencies = new Map<string, number>();
      for (const token of tokens) frequencies.set(token, (frequencies.get(token) || 0) + 1);

      for (const [term, frequency] of frequencies) {
        const list = this.postings.get(term) || [];
        list.push({ documentId: document.id, chunkIndex: chunk.index, termFrequency: frequency });
        this.postings.set(term, list);
        this.documentFrequency.set(term, (this.documentFrequency.get(term) || 0) + 1);
      }
    }
  }

  /** Remove a document and all of its postings. */
  remove(documentId: string): void {
    const existing = this.documents.get(documentId);
    if (!existing) return;

    for (const chunk of existing.chunks) {
      const key = `${documentId}#${chunk.index}`;
      this.chunkLengths.delete(key);
      this.totalChunks = Math.max(0, this.totalChunks - 1);
      for (const term of new Set(tokenize(chunk.text))) {
        const list = this.postings.get(term);
        if (!list) continue;
        const filtered = list.filter((posting) => !(posting.documentId === documentId && posting.chunkIndex === chunk.index));
        if (filtered.length === 0) {
          this.postings.delete(term);
          this.documentFrequency.delete(term);
        } else {
          this.postings.set(term, filtered);
          this.documentFrequency.set(term, Math.max(0, (this.documentFrequency.get(term) || 1) - 1));
        }
      }
    }
    this.documents.delete(documentId);
  }

  get size(): number {
    return this.documents.size;
  }

  listDocuments(): Array<Omit<IndexedDocument, 'chunks'> & { chunkCount: number }> {
    return [...this.documents.values()].map(({ chunks, ...rest }) => ({ ...rest, chunkCount: chunks.length }));
  }

  /** BM25 + exact-phrase search across the owner's indexed content. */
  search(query: string, options: SearchOptions = {}): SearchHit[] {
    const limit = options.limit ?? 20;
    const terms = tokenize(query);
    const phrase = (options.phrase || (terms.length > 1 ? query : '')).trim().toLowerCase();
    if (terms.length === 0 && !phrase) return [];

    const k1 = 1.5;
    const b = 0.75;
    const scores = new Map<string, { score: number; matchedBy: SearchHit['matchedBy'] }>();

    const addScore = (key: string, amount: number, by: 'phrase' | 'terms') => {
      const current = scores.get(key) || { score: 0, matchedBy: by as SearchHit['matchedBy'] };
      current.score += amount;
      current.matchedBy = current.matchedBy === by ? by : 'both';
      scores.set(key, current);
    };

    for (const term of terms) {
      const postings = this.postings.get(term);
      if (!postings) continue;
      const df = this.documentFrequency.get(term) || 1;
      const idf = Math.log(1 + (this.totalChunks - df + 0.5) / (df + 0.5));
      for (const posting of postings) {
        const key = `${posting.documentId}#${posting.chunkIndex}`;
        const length = this.chunkLengths.get(key) || 1;
        const denominator = posting.termFrequency + k1 * (1 - b + (b * length) / Math.max(1, this.averageChunkLength));
        addScore(key, idf * ((posting.termFrequency * (k1 + 1)) / denominator), 'terms');
      }
    }

    if (phrase) {
      for (const document of this.documents.values()) {
        for (const chunk of document.chunks) {
          if (chunk.text.toLowerCase().includes(phrase)) {
            addScore(`${document.id}#${chunk.index}`, 5, 'phrase');
          }
        }
      }
    }

    const hits: SearchHit[] = [];
    for (const [key, { score, matchedBy }] of scores) {
      const [documentId, chunkIndexRaw] = key.split('#');
      const document = this.documents.get(documentId);
      if (!document) continue;
      if (options.origins && !options.origins.includes(document.origin)) continue;
      if (options.updatedAfter && document.updatedAt && document.updatedAt < options.updatedAfter) continue;
      const chunk = document.chunks.find((candidate) => candidate.index === Number(chunkIndexRaw));
      if (!chunk) continue;
      hits.push({
        documentId,
        title: document.title,
        origin: document.origin,
        sourceUrl: document.sourceUrl,
        chunkIndex: chunk.index,
        page: chunk.page,
        section: chunk.section,
        snippet: buildSnippet(chunk.text, terms, phrase),
        score: Number(score.toFixed(4)),
        matchedBy,
      });
    }

    return hits.sort((left, right) => right.score - left.score).slice(0, limit);
  }
}

function buildSnippet(text: string, terms: string[], phrase: string): string {
  const lower = text.toLowerCase();
  let position = -1;
  if (phrase) position = lower.indexOf(phrase);
  if (position === -1) {
    for (const term of terms) {
      const found = lower.indexOf(term);
      if (found !== -1 && (position === -1 || found < position)) position = found;
    }
  }
  if (position === -1) return text.slice(0, 300).trim();
  const start = Math.max(0, position - 120);
  const end = Math.min(text.length, position + 220);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/** One index per owner. Never shared across users. */
export class OwnerSearchIndexRegistry {
  private indexes = new Map<string, SearchIndex>();

  forOwner(ownerId: string): SearchIndex {
    let index = this.indexes.get(ownerId);
    if (!index) {
      index = new SearchIndex();
      this.indexes.set(ownerId, index);
    }
    return index;
  }

  /** Drop an owner's index (e.g. on sign-out or account deletion). */
  evict(ownerId: string): void {
    this.indexes.delete(ownerId);
  }
}

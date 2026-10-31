/**
 * DeepResearchEngine — iterative, evidence-grounded research.
 *
 * The loop is: search → retrieve the actual source text → extract claims and
 * references → follow the most relevant references → search again with terms
 * learned from the evidence → stop when the goal is met or a declared budget
 * is exhausted. Everything it did is recorded, including what failed, so the
 * report can state its real scope instead of implying total coverage.
 *
 * It never invents a citation: a source only appears in the report if a
 * provider actually returned it, and a claim is only marked corroborated when
 * two independent sources contain it.
 */

import { ContentResult, processUrl } from '../content/ContentEngine.js';
import { sanitizeUntrustedText } from '../content/UntrustedContent.js';
import { ResearchHit, SourceCategory, getProvider, providersFor } from './ResearchProviders.js';

export type ResearchDepth = 'quick' | 'standard' | 'deep';

export interface ResearchRequest {
  question: string;
  /** URLs the user supplied — always retrieved first. */
  seedUrls?: string[];
  depth?: ResearchDepth;
  /** Restrict discovery to these source categories. */
  categories?: SourceCategory[];
  /** Hard cap on sources retrieved. */
  maxSources?: number;
  /** Extra terms to include in discovery. */
  extraTerms?: string[];
}

export interface RetrievedSource {
  id: string;
  title: string;
  url: string;
  finalUrl?: string;
  provider: string;
  category: SourceCategory;
  credibility: number;
  date?: string;
  authors?: string[];
  identifier?: string;
  /** Snippet from the provider (metadata, not full text). */
  snippet: string;
  /** True when the full text was actually retrieved and read. */
  fullText: boolean;
  /** Characters of full text read. */
  chars: number;
  /** Extracted passages that mention the question's key terms. */
  passages: string[];
  /** References/citations found inside this source. */
  references: string[];
  /** How the text was obtained. */
  method?: string;
  ocr?: boolean;
  warnings: string[];
  error?: string;
}

export interface Claim {
  text: string;
  /** Source ids that support this claim. */
  supportedBy: string[];
  /** True when two or more independent sources support it. */
  corroborated: boolean;
}

export interface ResearchProgress {
  stage: string;
  detail: string;
  at: string;
}

export interface ResearchReport {
  question: string;
  depth: ResearchDepth;
  /** What was actually searched, in plain language. */
  scope: string;
  /** Queries actually issued. */
  queries: string[];
  /** Providers that ran and providers that failed. */
  providersUsed: string[];
  providerErrors: string[];
  sources: RetrievedSource[];
  claims: Claim[];
  /** Sources that were discovered but could not be read. */
  unreadable: Array<{ url: string; reason: string }>;
  /** Explicit gaps and limits. */
  limitations: string[];
  /** Markdown report with inline citations. */
  report: string;
  progress: ResearchProgress[];
  stats: {
    discovered: number;
    retrieved: number;
    fullText: number;
    referencesFollowed: number;
    durationMs: number;
  };
}

const DEPTH_BUDGET: Record<ResearchDepth, { perProvider: number; maxSources: number; followReferences: number; rounds: number }> = {
  quick: { perProvider: 4, maxSources: 6, followReferences: 0, rounds: 1 },
  standard: { perProvider: 6, maxSources: 12, followReferences: 3, rounds: 2 },
  deep: { perProvider: 8, maxSources: 20, followReferences: 6, rounds: 3 },
};

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have', 'in', 'is', 'it', 'its', 'of',
  'on', 'or', 'that', 'the', 'to', 'was', 'were', 'will', 'with', 'what', 'which', 'who', 'how', 'why', 'when',
  'does', 'do', 'did', 'can', 'could', 'should', 'would', 'about', 'into', 'than', 'then', 'there', 'their',
]);

function keyTerms(question: string): string[] {
  return [...new Set(
    (question.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).filter(
      (term) => term.length > 2 && !STOPWORDS.has(term),
    ),
  )].slice(0, 12);
}

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 40 && sentence.length < 600);
}

/**
 * Navigation chrome, cookie banners and metadata lines are not evidence.
 * Rejecting them keeps the findings section to actual prose.
 */
const BOILERPLATE_MARKERS = [
  'skip to main content', 'view a pdf', 'submission history', 'full-text links', 'access paper',
  'cite as', 'focus to learn more', 'press enter to search', 'advanced search', 'sign in',
  'accept all cookies', 'we use cookies', 'privacy policy', 'terms of service', 'all rights reserved',
  'subscribe to', 'download citation', 'export citation', 'share this', 'related articles',
  'table of contents', 'advertisement', 'javascript is disabled', 'enable javascript',
  'guest access', 'ebooks', 'institutional access', 'purchase this', 'buy this', 'rent this',
  'download full', 'view full text', 'open access chapter', 'series studies in',
];

function looksLikeBoilerplate(sentence: string): boolean {
  const lower = sentence.toLowerCase();
  if (BOILERPLATE_MARKERS.some((marker) => lower.includes(marker))) return true;
  // Publisher metadata lines: "Pages 2 - 6 DOI 10.3233/..." and similar.
  if (/\bpages?\s+\d+\s*[-–]\s*\d+/i.test(sentence)) return true;
  if (/\bdoi\s+10\./i.test(sentence)) return true;
  if (/\b(volume|vol\.)\s+\d+:/i.test(sentence)) return true;
  // Metadata lines are dense with separators and short fragments.
  const separators = (sentence.match(/[·|]/g) || []).length;
  if (separators >= 2) return true;
  // Link-heavy text: many URLs or bracketed numbers.
  const urls = (sentence.match(/https?:\/\//g) || []).length;
  if (urls >= 2) return true;
  // Very low alphabetic density means it is a menu, not prose.
  const letters = (sentence.match(/[A-Za-z]/g) || []).length;
  if (letters / Math.max(1, sentence.length) < 0.55) return true;
  // Title-cased fragments with no verb-like lowercase words are headings.
  const words = sentence.split(/\s+/).filter(Boolean);
  const lowercaseWords = words.filter((word) => /^[a-z]/.test(word)).length;
  if (words.length >= 4 && lowercaseWords / words.length < 0.2) return true;
  // Form and consent chrome. A live run surfaced a country list and a
  // newsletter consent block as a "finding", which is exactly the kind of
  // non-evidence this filter exists to keep out of the report.
  if (/\b(email address|e-?mail address|invalid email|confirm email|enter your email)\b/i.test(sentence)) return true;
  if (/\b(i agree|terms (and|&) conditions|privacy (and|&) cookies|i would like to receive)\b/i.test(sentence)) return true;
  if (/\b(subscribe|newsletter|sign up|register now|create an account)\b/i.test(sentence)) return true;
  // A run of country names is a dropdown, not prose.
  const countryRun = (sentence.match(/\b(Wallis and Futuna|Western Sahara|Yemen|Zambia|Zimbabwe|Afghanistan|Albania|Algeria|Andorra|Angola)\b/gi) || []).length;
  if (countryRun >= 2) return true;
  // Long runs of capitalised proper nouns with no sentence punctuation.
  if (words.length >= 8 && !/[.!?]/.test(sentence) && lowercaseWords / words.length < 0.35) return true;
  return false;
}

/** Passages that actually mention the question's terms, best first. */
function relevantPassages(text: string, terms: string[], limit = 6): string[] {
  const scored = sentences(text)
    .filter((sentence) => !looksLikeBoilerplate(sentence))
    .map((sentence) => {
      const lower = sentence.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0);
      return { sentence, score };
    });
  return scored
    .filter((entry) => entry.score > 0)
    // A passage must look like a statement, not a fragment. Requiring a verb-ish
    // shape and a minimum length keeps navigation text out of the findings.
    .filter((entry) => entry.sentence.split(/\s+/).length >= 6)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((entry) => entry.sentence);
}

/** Pull reference-like strings out of a source so they can be followed. */
function extractReferences(text: string, baseUrl: string): string[] {
  const references = new Set<string>();
  // Explicit URLs in the text.
  for (const match of text.matchAll(/https?:\/\/[^\s)\]>"']+/g)) {
    const url = match[0].replace(/[.,;:]+$/, '');
    if (url !== baseUrl) references.add(url);
  }
  // DOI references.
  for (const match of text.matchAll(/\b10\.\d{4,9}\/[^\s,;)"']+/g)) {
    references.add(`https://doi.org/${match[0].replace(/[.,;:]+$/, '')}`);
  }
  // arXiv identifiers.
  for (const match of text.matchAll(/arXiv:\s*(\d{4}\.\d{4,5})/gi)) {
    references.add(`https://arxiv.org/abs/${match[1]}`);
  }
  return [...references].slice(0, 40);
}

function dedupeKey(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname.replace(/\/$/, '')}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export class DeepResearchEngine {
  /**
   * Run a research question to completion. `onProgress` is called with real
   * stage transitions so the UI can show what is actually happening.
   */
  async research(
    request: ResearchRequest,
    onProgress?: (progress: ResearchProgress) => void,
  ): Promise<ResearchReport> {
    const started = Date.now();
    const question = request.question.trim();
    if (!question) throw new Error('A research question is required.');

    const depth: ResearchDepth = request.depth || 'standard';
    const budget = DEPTH_BUDGET[depth];
    const maxSources = Math.min(request.maxSources ?? budget.maxSources, 40);
    const terms = [...new Set([...keyTerms(question), ...(request.extraTerms || [])])];

    const progress: ResearchProgress[] = [];
    const note = (stage: string, detail: string) => {
      const entry = { stage, detail, at: new Date().toISOString() };
      progress.push(entry);
      onProgress?.(entry);
    };

    const sources: RetrievedSource[] = [];
    const unreadable: Array<{ url: string; reason: string }> = [];
    const queries: string[] = [];
    const providersUsed = new Set<string>();
    const providerErrors: string[] = [];
    const seen = new Set<string>();
    let referencesFollowed = 0;

    note('plan', `Question understood; ${terms.length} key terms; depth ${depth}.`);

    // --- 1. User-supplied URLs are always read first ------------------------
    for (const url of request.seedUrls || []) {
      if (sources.length >= maxSources) break;
      const key = dedupeKey(url);
      if (seen.has(key)) continue;
      seen.add(key);
      note('retrieve', `Reading supplied source ${url}`);
      const source = await this.retrieveSource(
        {
          title: url,
          url,
          provider: 'user-supplied',
          category: 'web',
          credibility: 0.6,
          snippet: '',
        },
        terms,
      );
      if (source.fullText) sources.push(source);
      else unreadable.push({ url, reason: source.error || 'No readable text.' });
    }

    // --- 2. Discovery rounds ------------------------------------------------
    const providers = providersFor(request.categories);
    if (providers.length === 0) {
      providerErrors.push('No research provider is available for the requested source categories.');
    }

    let round = 0;
    let discoveryQuery = question;
    while (round < budget.rounds && sources.length < maxSources) {
      round += 1;
      note('search', `Discovery round ${round}: "${discoveryQuery}"`);
      queries.push(discoveryQuery);

      const results = await Promise.allSettled(
        providers.map(async (provider) => {
          const hits = await provider.search({ query: discoveryQuery, limit: budget.perProvider, expandedTerms: terms });
          return { provider: provider.id, hits };
        }),
      );

      const discovered: ResearchHit[] = [];
      for (const result of results) {
        if (result.status === 'fulfilled') {
          providersUsed.add(result.value.provider);
          discovered.push(...result.value.hits);
        } else {
          providerErrors.push(result.reason instanceof Error ? result.reason.message : 'A provider failed.');
        }
      }

      // Rank: credibility first, then whether the title/snippet matches terms.
      const ranked = discovered
        .map((hit) => {
          const haystack = `${hit.title} ${hit.snippet}`.toLowerCase();
          const matches = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
          return { hit, score: hit.credibility * 2 + matches };
        })
        .sort((left, right) => right.score - left.score)
        .map((entry) => entry.hit);

      let addedThisRound = 0;
      for (const hit of ranked) {
        if (sources.length >= maxSources) break;
        const key = dedupeKey(hit.url);
        if (seen.has(key)) continue;
        seen.add(key);
        note('retrieve', `Reading ${hit.provider}: ${hit.title.slice(0, 80)}`);
        const source = await this.retrieveSource(hit, terms);
        if (source.fullText) {
          sources.push(source);
          addedThisRound += 1;
        } else {
          unreadable.push({ url: hit.url, reason: source.error || 'No readable text.' });
        }
      }

      // --- 3. Follow references from what we read --------------------------
      if (round <= budget.followReferences && sources.length < maxSources) {
        const candidates = sources
          .flatMap((source) => source.references)
          .filter((url) => !seen.has(dedupeKey(url)))
          .slice(0, budget.followReferences);
        for (const url of candidates) {
          if (sources.length >= maxSources) break;
          const key = dedupeKey(url);
          if (seen.has(key)) continue;
          seen.add(key);
          referencesFollowed += 1;
          note('follow', `Following a reference: ${url}`);
          const source = await this.retrieveSource(
            { title: url, url, provider: 'reference', category: 'web', credibility: 0.65, snippet: '' },
            terms,
          );
          if (source.fullText) sources.push(source);
          else unreadable.push({ url, reason: source.error || 'No readable text.' });
        }
      }

      if (addedThisRound === 0) break;
      // Refine the next query with terminology learned from the evidence.
      const learned = this.learnedTerms(sources, terms);
      if (learned.length === 0) break;
      discoveryQuery = `${question} ${learned.slice(0, 3).join(' ')}`.trim();
    }

    // --- 4. Claims and corroboration ---------------------------------------
    note('analyse', `Extracting claims from ${sources.length} source(s).`);
    const claims = this.buildClaims(sources, terms);

    // --- 5. Report ---------------------------------------------------------
    note('report', 'Composing the cited report.');
    const limitations = this.buildLimitations(sources, unreadable, providerErrors, depth);
    const report = this.composeReport(question, depth, sources, claims, limitations, queries, providersUsed, unreadable);

    return {
      question,
      depth,
      scope: this.describeScope(sources, providersUsed, queries),
      queries,
      providersUsed: [...providersUsed],
      providerErrors,
      sources,
      claims,
      unreadable,
      limitations,
      report,
      progress,
      stats: {
        discovered: seen.size,
        retrieved: sources.length + unreadable.length,
        fullText: sources.length,
        referencesFollowed,
        durationMs: Date.now() - started,
      },
    };
  }

  /** Retrieve and read one source. Never claims success without real text. */
  private async retrieveSource(hit: ResearchHit, terms: string[]): Promise<RetrievedSource> {
    const base: RetrievedSource = {
      id: `src_${dedupeKey(hit.url).replace(/[^a-z0-9]+/g, '_').slice(0, 60)}`,
      title: hit.title,
      url: hit.url,
      provider: hit.provider,
      category: hit.category,
      credibility: hit.credibility,
      date: hit.date,
      authors: hit.authors,
      identifier: hit.identifier,
      snippet: hit.snippet,
      fullText: false,
      chars: 0,
      passages: [],
      references: [],
      warnings: [],
    };

    let result: ContentResult;
    try {
      result = await processUrl(hit.url, { maxBytes: 6 * 1024 * 1024, timeoutMs: 20_000 });
    } catch (error) {
      return { ...base, error: error instanceof Error ? error.message : 'Retrieval failed.' };
    }

    if (!result.ok) {
      return { ...base, error: result.error?.message || 'No readable text.', warnings: result.warnings };
    }

    const sanitized = sanitizeUntrustedText(result.text);
    return {
      ...base,
      title: result.title || hit.title,
      finalUrl: result.finalUrl,
      fullText: true,
      chars: result.text.length,
      passages: relevantPassages(sanitized.text, terms),
      references: extractReferences(result.text, result.finalUrl || hit.url),
      method: result.method,
      ocr: result.ocr,
      warnings: sanitized.flagged > 0
        ? [...result.warnings, `${sanitized.flagged} instruction-like passage(s) neutralised (${sanitized.findings.join(', ')}).`]
        : result.warnings,
    };
  }

  /** Terms that appear repeatedly in the evidence but were not in the question. */
  private learnedTerms(sources: RetrievedSource[], original: string[]): string[] {
    const counts = new Map<string, number>();
    for (const source of sources) {
      for (const passage of source.passages) {
        for (const term of passage.toLowerCase().match(/[\p{L}][\p{L}-]{4,}/gu) || []) {
          if (original.includes(term) || STOPWORDS.has(term)) continue;
          counts.set(term, (counts.get(term) || 0) + 1);
        }
      }
    }
    return [...counts.entries()]
      .filter(([, count]) => count >= 2)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([term]) => term);
  }

  /**
   * Build claims from real passages. A claim is only corroborated when two
   * different sources contain a closely matching sentence.
   */
  private buildClaims(sources: RetrievedSource[], terms: string[]): Claim[] {
    const claims: Claim[] = [];
    const normalized = new Map<string, { text: string; sources: Set<string> }>();

    for (const source of sources) {
      for (const passage of source.passages) {
        const key = passage.toLowerCase().replace(/[^a-z0-9 ]+/g, '').split(/\s+/).slice(0, 12).join(' ');
        if (!key) continue;
        const existing = normalized.get(key);
        if (existing) existing.sources.add(source.id);
        else normalized.set(key, { text: passage, sources: new Set([source.id]) });
      }
    }

    for (const { text, sources: supporting } of normalized.values()) {
      const lower = text.toLowerCase();
      const matches = terms.filter((term) => lower.includes(term)).length;
      if (matches === 0) continue;
      claims.push({
        text,
        supportedBy: [...supporting],
        corroborated: supporting.size > 1,
      });
    }

    return claims
      .sort((left, right) => Number(right.corroborated) - Number(left.corroborated) || right.supportedBy.length - left.supportedBy.length)
      .slice(0, 25);
  }

  private buildLimitations(
    sources: RetrievedSource[],
    unreadable: Array<{ url: string; reason: string }>,
    providerErrors: string[],
    depth: ResearchDepth,
  ): string[] {
    const limitations: string[] = [];
    if (sources.length === 0) limitations.push('No source could be read, so no finding in this report is evidenced.');
    if (unreadable.length > 0) limitations.push(`${unreadable.length} discovered source(s) could not be read (paywall, JavaScript-only page, or retrieval error).`);
    if (providerErrors.length > 0) limitations.push(`${providerErrors.length} discovery provider(s) failed; coverage is narrower than requested.`);
    const metadataOnly = sources.filter((source) => source.chars < 500).length;
    if (metadataOnly > 0) limitations.push(`${metadataOnly} source(s) yielded only a short excerpt, not full text.`);
    if (depth === 'quick') limitations.push('Quick depth: discovery was limited to one round and references were not followed.');
    const injected = sources.filter((source) => source.warnings.some((warning) => warning.includes('instruction-like')));
    if (injected.length > 0) {
      limitations.push(
        `${injected.length} source(s) contained text that tried to act as instructions; it was treated as evidence and neutralised, never followed.`,
      );
    }
    limitations.push('Only public web sources reachable from this server were searched; private databases, paywalled archives and print-only material were not.');
    return limitations;
  }

  private describeScope(sources: RetrievedSource[], providers: Set<string>, queries: string[]): string {
    const categories = [...new Set(sources.map((source) => source.category))];
    return [
      `${sources.length} source(s) read in full`,
      `providers: ${[...providers].join(', ') || 'none'}`,
      `categories: ${categories.join(', ') || 'none'}`,
      `${queries.length} discovery quer${queries.length === 1 ? 'y' : 'ies'}`,
    ].join(' · ');
  }

  private composeReport(
    question: string,
    depth: ResearchDepth,
    sources: RetrievedSource[],
    claims: Claim[],
    limitations: string[],
    queries: string[],
    providers: Set<string>,
    unreadable: Array<{ url: string; reason: string }>,
  ): string {
    const citation = (id: string) => {
      const index = sources.findIndex((source) => source.id === id);
      return index === -1 ? '' : `[${index + 1}]`;
    };

    const lines: string[] = [];
    lines.push(`# Research report: ${question}`, '');
    lines.push(`_Depth: ${depth} · ${sources.length} source(s) read · generated ${new Date().toISOString()}_`, '');
    lines.push('## Scope and method', '');
    lines.push(`Discovery providers used: ${[...providers].join(', ') || 'none'}.`);
    lines.push(`Queries issued: ${queries.map((query) => `"${query}"`).join(', ') || 'none'}.`);
    lines.push('');

    lines.push('## Findings', '');
    if (claims.length === 0) {
      lines.push('_No claim could be grounded in retrieved text._', '');
    } else {
      for (const claim of claims) {
        const refs = claim.supportedBy.map(citation).filter(Boolean).join(' ');
        lines.push(`- ${claim.text} ${refs}${claim.corroborated ? ' _(corroborated by multiple sources)_' : ''}`);
      }
      lines.push('');
    }

    lines.push('## Sources', '');
    if (sources.length === 0) {
      lines.push('_No sources were read._', '');
    } else {
      sources.forEach((source, index) => {
        const meta = [
          source.authors?.length ? source.authors.join(', ') : '',
          source.date || '',
          source.identifier || '',
        ].filter(Boolean).join(' · ');
        lines.push(`${index + 1}. **${source.title}** — ${source.finalUrl || source.url}`);
        if (meta) lines.push(`   ${meta}`);
        lines.push(`   _${source.provider} · ${source.category} · ${source.chars.toLocaleString()} chars read${source.ocr ? ' · OCR' : ''}_`);
      });
      lines.push('');
    }

    if (unreadable.length > 0) {
      lines.push('## Sources that could not be read', '');
      for (const entry of unreadable) lines.push(`- ${entry.url} — ${entry.reason}`);
      lines.push('');
    }

    lines.push('## Limitations', '');
    for (const limitation of limitations) lines.push(`- ${limitation}`);
    lines.push('');

    return lines.join('\n');
  }
}

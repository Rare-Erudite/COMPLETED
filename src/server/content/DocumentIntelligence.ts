/**
 * DocumentIntelligence — grounded question answering, comparison, summarisation
 * and editing over the owner's own document corpus.
 *
 * The central discipline here is provenance. Every answer is built from numbered
 * chunks that were actually retrieved, and every claim the model makes is
 * checked back against those chunks before it is labelled `explicit`. Anything
 * the model adds that is not in the source is labelled `derived` and shown
 * separately, so a reader can always tell what the document said from what RARE
 * concluded.
 *
 * This is what stops the assistant from answering "the report says revenue was
 * £2.1m" when the report says nothing of the kind.
 */

import { ContentChunk } from './ContentEngine.js';
import { SearchHit } from './SearchIndex.js';

/** A retrieved passage that an answer may cite. */
export interface SourcePassage {
  /** 1-based citation number used in the prompt and the answer. */
  marker: number;
  documentPath: string;
  documentTitle: string;
  chunkIndex: number;
  page?: number;
  section?: string;
  text: string;
  sourceUrl?: string;
  score: number;
}

export interface Citation {
  marker: number;
  documentPath: string;
  documentTitle: string;
  page?: number;
  section?: string;
  clock?: string;
  sourceUrl?: string;
  /** The exact passage cited, so the UI can show it beside the claim. */
  quote: string;
}

export interface GroundedAnswer {
  answer: string;
  citations: Citation[];
  /** Claims the model asserted that could be traced to a retrieved passage. */
  explicitClaims: string[];
  /** Claims the model asserted that are not supported by any passage. */
  derivedClaims: string[];
  /** Every passage the answer was allowed to use. */
  sources: SourcePassage[];
  /** Documents consulted, in retrieval order. */
  documentsUsed: string[];
  /** True when no passage matched the question at all. */
  noRelevantContent: boolean;
  model: string;
  warnings: string[];
}

/** The narrow provider contract this module needs. */
export interface GroundingProvider {
  generate(
    prompt: string,
    context?: string,
    options?: { maxTokens?: number; temperature?: number; systemPrompt?: string },
  ): Promise<{ reply: string; modelUsed: string }>;
}

export interface AskOptions {
  /** Restrict to specific document paths. */
  documentPaths?: string[];
  /** Maximum passages to retrieve. Default 10. */
  maxPassages?: number;
  /** Ask the model to reason beyond the text (still labelled derived). */
  allowReasoning?: boolean;
}

const RETRIEVAL_STOPWORDS = new Set([
  'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how', 'does', 'did', 'do',
  'is', 'are', 'was', 'were', 'the', 'and', 'for', 'from', 'that', 'this', 'with', 'about',
  'tell', 'me', 'can', 'you', 'please', 'summarise', 'summarize', 'explain', 'document', 'documents',
  'file', 'files', 'according', 'say', 'says', 'said', 'there', 'their', 'have', 'has', 'had',
]);

/** Words that carry the actual information need out of a natural-language question. */
export function questionTerms(question: string): string[] {
  return (question.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) || []).filter(
    (term) => term.length > 1 && !RETRIEVAL_STOPWORDS.has(term),
  );
}

/**
 * Normalise a phrase for containment checks: collapse whitespace, strip
 * punctuation and case, so "Revenue  was £2.1m." matches "revenue was £2.1m".
 */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^\p{L}\p{N}£$€%.,' -]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Is `claim` supported by `passage`?
 *
 * A whole sentence rarely appears verbatim, so this checks whether the claim's
 * distinctive terms and, when present, its numbers all occur in the passage.
 * Numbers are the strict part: an answer that invents a figure fails here even
 * if it sounds plausible.
 */
export function isClaimSupported(claim: string, passage: string): boolean {
  const claimText = normalise(claim);
  const passageText = normalise(passage);
  if (claimText.length < 4 || passageText.length < 4) return false;

  // Every number in the claim must appear in the passage.
  const claimNumbers = claimText.match(/\d+(?:[.,]\d+)?/g) || [];
  for (const number of claimNumbers) {
    if (!passageText.includes(number)) return false;
  }

  const terms = claimText
    .split(' ')
    .filter((word) => word.length > 3 && !RETRIEVAL_STOPWORDS.has(word));
  if (terms.length === 0) return passageText.includes(claimText);
  const hits = terms.filter((term) => passageText.includes(term)).length;
  return hits / terms.length >= 0.6;
}

/**
 * Split an answer into individual claims (sentences), dropping list markers and
 * citation markers so the text compared against passages is clean.
 */
export function splitClaims(answer: string): string[] {
  return answer
    .replace(/^\s*[-*•]\s*/gm, '')
    .replace(/\[\d+\]/g, '')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 12 && !/^(sources?|references?)[:.]?$/i.test(sentence));
}

/** Build the numbered source block given to the model. */
function renderSources(passages: SourcePassage[]): string {
  return passages
    .map((passage) => {
      const location = [
        passage.page ? `page ${passage.page}` : null,
        passage.section ? `section "${passage.section}"` : null,
      ].filter(Boolean).join(', ');
      return `[${passage.marker}] ${passage.documentTitle}${location ? ` (${location})` : ''}\n${passage.text}`;
    })
    .join('\n\n');
}

/**
 * Answer a question from retrieved passages.
 *
 * `retrieve` is injected so the caller decides which corpus is searched (whole
 * library, one document, a project collection) without this module knowing
 * about storage.
 */
export async function answerFromPassages(
  question: string,
  passages: SourcePassage[],
  provider: GroundingProvider,
  options: { allowReasoning?: boolean; systemPrompt?: string } = {},
): Promise<GroundedAnswer> {
  const warnings: string[] = [];

  if (passages.length === 0) {
    return {
      answer: '',
      citations: [],
      explicitClaims: [],
      derivedClaims: [],
      sources: [],
      documentsUsed: [],
      noRelevantContent: true,
      model: '',
      warnings: [
        'No passage in your documents matched this question, so there is nothing to answer from. Nothing was invented.',
      ],
    };
  }

  const sourceBlock = renderSources(passages);
  const reasoningRule = options.allowReasoning
    ? 'You may add reasoning beyond the passages, but bracket any such sentence with (derived) at the start — those sentences must not be presented as if the document said them.'
    : 'Do NOT add information that is not in the passages. If the passages do not answer the question, say so plainly.';

  const prompt = [
    'You are answering a question using ONLY the numbered passages below.',
    'Rules:',
    '1. Cite the passage number in square brackets after every factual sentence, e.g. [2].',
    '2. Quote figures, names and dates exactly as they appear. Never round or estimate.',
    '3. If the passages disagree, say so and cite both.',
    '4. If the passages do not contain the answer, say "The documents do not contain that information" and add nothing else.',
    `5. ${reasoningRule}`,
    '',
    'Passages:',
    sourceBlock,
    '',
    `Question: ${question}`,
    '',
    'Answer:',
  ].join('\n');

  let reply = '';
  let model = '';
  try {
    const generated = await provider.generate(prompt, undefined, {
      maxTokens: 1400,
      temperature: 0.2,
      ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
    });
    reply = (generated.reply || '').trim();
    model = generated.modelUsed || '';
  } catch (error) {
    // No provider is not an excuse to fabricate an answer.
    return {
      answer: '',
      citations: [],
      explicitClaims: [],
      derivedClaims: [],
      sources: passages,
      documentsUsed: [...new Set(passages.map((passage) => passage.documentPath))],
      noRelevantContent: false,
      model: '',
      warnings: [
        `No model is available to compose an answer (${error instanceof Error ? error.message : 'provider unavailable'}). The matching passages are returned instead so you can read them directly.`,
      ],
    };
  }

  if (!reply) {
    warnings.push('The model returned an empty answer.');
  }

  // Verify every claim against the passages it could have come from.
  const claims = splitClaims(reply);
  const explicitClaims: string[] = [];
  const derivedClaims: string[] = [];
  for (const claim of claims) {
    const markedDerived = /^\(derived\)/i.test(claim) || /\s\((?:derived|inferred|likely)\)$/i.test(claim);
    const supported = passages.some((passage) => isClaimSupported(claim.replace(/^\(derived\)\s*/i, ''), passage.text));
    if (markedDerived || !supported) derivedClaims.push(claim);
    else explicitClaims.push(claim);
  }
  if (derivedClaims.length > 0) {
    warnings.push(
      `${derivedClaims.length} sentence(s) could not be traced back to a passage and are labelled as reasoning, not document content.`,
    );
  }

  // Citations are only the passages actually referenced, in marker order.
  const citedMarkers = [...new Set((reply.match(/\[(\d+)\]/g) || []).map((token) => Number(token.slice(1, -1))))]
    .filter((marker) => passages.some((passage) => passage.marker === marker));
  const citations: Citation[] = (citedMarkers.length > 0 ? citedMarkers : passages.map((passage) => passage.marker))
    .map((marker) => passages.find((passage) => passage.marker === marker)!)
    .filter(Boolean)
    .map((passage) => ({
      marker: passage.marker,
      documentPath: passage.documentPath,
      documentTitle: passage.documentTitle,
      ...(passage.page ? { page: passage.page } : {}),
      ...(passage.section ? { section: passage.section } : {}),
      ...(passage.sourceUrl ? { sourceUrl: passage.sourceUrl } : {}),
      quote: passage.text.slice(0, 600),
    }));

  return {
    answer: reply,
    citations,
    explicitClaims,
    derivedClaims,
    sources: passages,
    documentsUsed: [...new Set(passages.map((passage) => passage.documentPath))],
    noRelevantContent: false,
    model,
    warnings,
  };
}

/** Convert search hits into numbered passages, one per hit. */
export function passagesFromHits(hits: SearchHit[], lookup: (documentId: string) => { title: string; sourceUrl?: string }): SourcePassage[] {
  return hits.map((hit, index) => {
    const meta = lookup(hit.documentId);
    return {
      marker: index + 1,
      documentPath: hit.documentId,
      documentTitle: meta.title || hit.title,
      chunkIndex: hit.chunkIndex,
      ...(hit.page ? { page: hit.page } : {}),
      ...(hit.section ? { section: hit.section } : {}),
      text: hit.snippet,
      ...(meta.sourceUrl || hit.sourceUrl ? { sourceUrl: meta.sourceUrl || hit.sourceUrl } : {}),
      score: hit.score,
    };
  });
}

// ---------------------------------------------------------------------------
// Long-document reading — hierarchical, so nothing is silently discarded
// ---------------------------------------------------------------------------

export interface SectionSummary {
  index: number;
  heading?: string;
  page?: number;
  charCount: number;
  summary: string;
  /** False when the model could not be reached and the summary is extractive. */
  modelSummarised: boolean;
}

export interface HierarchicalSummary {
  overview: string;
  sections: SectionSummary[];
  /** Total characters the source contained. */
  totalChars: number;
  /** Characters the summaries were actually built from. */
  coveredChars: number;
  truncated: boolean;
  model: string;
  warnings: string[];
}

/**
 * Summarise a long document section by section, then summarise the summaries.
 *
 * A single prompt over a 200-page report either truncates or is silently
 * summarised from its first pages only. Working section by section means the
 * whole document is read, and the result can state which sections it covers.
 */
export async function summariseHierarchically(
  chunks: ContentChunk[],
  provider: GroundingProvider,
  options: { maxSections?: number; title?: string } = {},
): Promise<HierarchicalSummary> {
  const warnings: string[] = [];
  const maxSections = options.maxSections ?? 60;
  const selected = chunks.slice(0, maxSections);
  if (chunks.length > maxSections) {
    warnings.push(
      `This document has ${chunks.length} sections; the first ${maxSections} were summarised. The rest was not read.`,
    );
  }

  const sections: SectionSummary[] = [];
  let model = '';

  for (const [index, chunk] of selected.entries()) {
    const heading = chunk.section || (chunk.page ? `Page ${chunk.page}` : `Section ${index + 1}`);
    let summary = '';
    let modelSummarised = false;
    try {
      const generated = await provider.generate(
        [
          'Summarise this single section of a longer document in 2–3 sentences.',
          'Use only what the text says. Preserve every figure, name and date exactly. Do not add context from outside this section.',
          '',
          chunk.text,
        ].join('\n'),
        undefined,
        { maxTokens: 320, temperature: 0.1 },
      );
      summary = (generated.reply || '').trim();
      model = generated.modelUsed || model;
      modelSummarised = summary.length > 0;
    } catch {
      // Fall through to extractive summary below.
    }

    if (!modelSummarised) {
      // Extractive fallback: the section's own leading sentences. Clearly not
      // a model summary, so the caller can label it.
      summary = chunk.text
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => sentence.trim().length > 0)
        .slice(0, 3)
        .join(' ')
        .slice(0, 700);
      if (summary) warnings.push(`Section ${index + 1} was summarised extractively because no model was reachable.`);
    }

    sections.push({
      index,
      ...(chunk.section ? { heading: chunk.section } : {}),
      ...(chunk.page ? { page: chunk.page } : {}),
      charCount: chunk.text.length,
      summary,
      modelSummarised,
    });
  }

  let overview = '';
  if (sections.length > 0) {
    const joined = sections
      .map((section) => `[${section.index + 1}] ${section.heading ? `${section.heading}: ` : ''}${section.summary}`)
      .join('\n');
    try {
      const generated = await provider.generate(
        [
          `Write a coherent overview of this document${options.title ? ` (${options.title})` : ''} from its section summaries.`,
          'Cover what the document is, its main findings and its conclusions. Preserve figures exactly. Do not invent anything not present below.',
          'Cite section numbers in square brackets.',
          '',
          joined,
        ].join('\n'),
        undefined,
        { maxTokens: 700, temperature: 0.2 },
      );
      overview = (generated.reply || '').trim();
      model = generated.modelUsed || model;
    } catch {
      overview = sections.map((section) => section.summary).join(' ').slice(0, 1200);
    }
  }

  return {
    overview: overview || 'No summary could be produced.',
    sections,
    totalChars: chunks.reduce((sum, chunk) => sum + chunk.text.length, 0),
    coveredChars: selected.reduce((sum, chunk) => sum + chunk.text.length, 0),
    truncated: chunks.length > maxSections,
    model,
    warnings: [...new Set(warnings)],
  };
}

// ---------------------------------------------------------------------------
// Document comparison
// ---------------------------------------------------------------------------

export interface DocumentComparison {
  left: { path: string; title: string; chars: number; chunks: number };
  right: { path: string; title: string; chars: number; chunks: number };
  /** Sentences present in one document but not the other. */
  onlyInLeft: string[];
  onlyInRight: string[];
  /** Sentences present in both (above a length threshold). */
  shared: string[];
  /** Numbers that appear in both documents but with different associated text. */
  numericConflicts: Array<{ topic: string; left: string; right: string }>;
  /** Model-written narrative, when a provider is reachable. */
  narrative?: string;
  model: string;
  warnings: string[];
}

/**
 * Compare two documents.
 *
 * The structural comparison (what is only in one, what is shared, which figures
 * disagree) is computed directly from the text, so it is available even with no
 * model. The narrative is built on top of those findings rather than replacing
 * them, so the summary cannot claim a difference the text does not contain.
 */
export async function compareDocuments(
  left: { path: string; title: string; text: string },
  right: { path: string; title: string; text: string },
  provider: GroundingProvider | null,
): Promise<DocumentComparison> {
  const warnings: string[] = [];

  const sentencesOf = (text: string): string[] =>
    text
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length >= 30 && sentence.length <= 400);

  const leftSentences = [...new Set(sentencesOf(left.text))];
  const rightSentences = [...new Set(sentencesOf(right.text))];

  const normalisedKey = (sentence: string) => normalise(sentence).slice(0, 140);
  const rightKeys = new Set(rightSentences.map(normalisedKey));
  const leftKeys = new Set(leftSentences.map(normalisedKey));

  const onlyInLeft = leftSentences.filter((sentence) => !rightKeys.has(normalisedKey(sentence))).slice(0, 200);
  const onlyInRight = rightSentences.filter((sentence) => !leftKeys.has(normalisedKey(sentence))).slice(0, 200);
  const shared = leftSentences.filter((sentence) => rightKeys.has(normalisedKey(sentence))).slice(0, 200);

  // Figures that disagree. Numbers are matched to the noun phrase preceding
  // them, so "revenue was £2.1m" vs "revenue was £1.8m" is a conflict while two
  // unrelated figures are not.
  const figurePattern = /([\p{L}][\p{L}\s-]{3,40}?)\s*(?:was|is|were|are|of|:|=|reached|totalled|totaled)\s*[£$€]?\s*(\d[\d,]*(?:\.\d+)?\s*(?:%|m|bn|b|k|million|billion|thousand)?)/giu;
  const figuresOf = (text: string) => {
    const found = new Map<string, string>();
    for (const match of text.matchAll(figurePattern)) {
      const topic = normalise(match[1]).replace(/^(the|a|an)\s+/, '').trim();
      if (topic.length < 3) continue;
      if (!found.has(topic)) found.set(topic, match[2].trim());
    }
    return found;
  };
  const leftFigures = figuresOf(left.text);
  const rightFigures = figuresOf(right.text);
  const numericConflicts: DocumentComparison['numericConflicts'] = [];
  for (const [topic, leftValue] of leftFigures) {
    const rightValue = rightFigures.get(topic);
    if (rightValue && rightValue !== leftValue) {
      numericConflicts.push({ topic, left: leftValue, right: rightValue });
    }
  }

  let narrative: string | undefined;
  let model = '';
  if (provider) {
    try {
      const generated = await provider.generate(
        [
          'Compare these two documents using the pre-computed findings below.',
          'Rules: describe only what the findings show. Do not introduce differences that are not listed. Preserve figures exactly.',
          '',
          `Document A: ${left.title} (${left.text.length} chars)`,
          `Document B: ${right.title} (${right.text.length} chars)`,
          '',
          `Shared statements (${shared.length}):`,
          shared.slice(0, 12).map((sentence) => `- ${sentence}`).join('\n') || '(none)',
          '',
          `Only in A (${onlyInLeft.length}), sample:`,
          onlyInLeft.slice(0, 12).map((sentence) => `- ${sentence}`).join('\n') || '(none)',
          '',
          `Only in B (${onlyInRight.length}), sample:`,
          onlyInRight.slice(0, 12).map((sentence) => `- ${sentence}`).join('\n') || '(none)',
          '',
          `Conflicting figures (${numericConflicts.length}):`,
          numericConflicts.slice(0, 12).map((conflict) => `- ${conflict.topic}: A says ${conflict.left}, B says ${conflict.right}`).join('\n') || '(none)',
          '',
          'Write: (1) what the two documents agree on, (2) what differs, (3) any contradictions, especially in figures.',
        ].join('\n'),
        undefined,
        { maxTokens: 900, temperature: 0.2 },
      );
      narrative = (generated.reply || '').trim() || undefined;
      model = generated.modelUsed || '';
    } catch {
      warnings.push('No model was reachable, so only the computed structural comparison is available.');
    }
  } else {
    warnings.push('No model was reachable, so only the computed structural comparison is available.');
  }

  if (numericConflicts.length > 0) {
    warnings.push(`${numericConflicts.length} figure(s) differ between the two documents.`);
  }

  return {
    left: { path: left.path, title: left.title, chars: left.text.length, chunks: 0 },
    right: { path: right.path, title: right.title, chars: right.text.length, chunks: 0 },
    onlyInLeft,
    onlyInRight,
    shared,
    numericConflicts,
    ...(narrative ? { narrative } : {}),
    model,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Extraction of structured facts
// ---------------------------------------------------------------------------

export interface ExtractedEntities {
  dates: string[];
  figures: string[];
  emails: string[];
  urls: string[];
  names: string[];
  /** Lines that look like action items, with their location. */
  actionItems: Array<{ text: string; clock?: string; page?: number }>;
}

/**
 * Extract dates, figures, contacts and action items directly from text.
 *
 * Deterministic, so the result is reproducible and every entry can be found in
 * the source with a simple search.
 */
export function extractEntities(text: string): ExtractedEntities {
  const dates = [
    ...new Set(
      (text.match(
        /\b(?:\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s*\d{0,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s*\d{4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/gi,
      ) || []).map((match) => match.trim()),
    ),
  ].slice(0, 200);

  // Figures include bare numbers with a magnitude word ("2100000 pounds",
  // "45 million") as well as currency-prefixed amounts, because a report
  // usually states its numbers without a symbol.
  const figures = [
    ...new Set(
      (
        text.match(
          /(?:[£$€]\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:m|bn|b|k|million|billion|thousand))?|\b\d[\d,]*(?:\.\d+)?\s?(?:%|m|bn|million|billion|thousand|pounds?|dollars?|euros?|naira)\b)/gi,
        ) || []
      ).map((match) => match.trim()),
    ),
  ].slice(0, 300);

  const emails = [...new Set(text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/gi) || [])].slice(0, 100);
  const urls = [...new Set(text.match(/https?:\/\/[^\s<>"')]+/gi) || [])].slice(0, 100);

  // Capitalised sequences that are not sentence-initial gerunds: a rough but
  // reproducible proxy for personal and organisation names.
  const names = [
    ...new Set(
      (text.match(/\b(?:[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){1,2})\b/g) || []).filter(
        (candidate) => !/^(The|This|That|These|Those|However|Therefore|Furthermore|Additionally|Chapter|Section|Figure|Table|Page)\b/.test(candidate),
      ),
    ),
  ].slice(0, 200);

  const actionItems: ExtractedEntities['actionItems'] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 12 || trimmed.length > 400) continue;
    if (
      /^(?:[-*•]\s*)?(?:\[?\d+[.)\]]?\s*)?(?:action|to-?do|next step|follow[- ]?up)\b/i.test(trimmed) ||
      /\b(?:by|before)\s+(?:monday|tuesday|wednesday|thursday|friday|end of|next week|\d{1,2})/i.test(trimmed)
    ) {
      actionItems.push({ text: trimmed.replace(/^[-*•]\s*/, '') });
    }
  }

  return { dates, figures, emails, urls, names, actionItems: actionItems.slice(0, 100) };
}

/**
 * RARE — Conversation Mode (persona) definitions.
 *
 * This is the SINGLE source of truth for the four conversation modes. Every
 * reasoning path imports from here so a mode cannot drift between the online
 * providers, the standalone cognitive engine, and the voice path.
 *
 * A mode changes HOW RARE approaches and delivers a response. It never changes
 * what RARE is: identity, factual standards, safety rules and capability
 * honesty are invariant and are stated separately in `RARE_INVARIANTS`.
 */

export type PersonaMode = 'casual' | 'professional' | 'creative' | 'concise';

export const PERSONA_MODES: PersonaMode[] = ['casual', 'professional', 'creative', 'concise'];

export const DEFAULT_PERSONA_MODE: PersonaMode = 'casual';

export interface PersonaDefinition {
  id: PersonaMode;
  /** Label shown in the UI. */
  label: string;
  /** One-line description of the delivery style. */
  summary: string;
  /**
   * Instruction injected into a model-backed provider's system prompt.
   * Written as behavioural guidance, not as a template of canned text.
   */
  systemInstruction: string;
  /**
   * Structural guidance for the standalone (non-model) engine, which cannot
   * follow a prose instruction and instead applies concrete shaping rules.
   */
  shaping: {
    /** Target maximum sentences for a substantive answer. */
    maxSentences: number;
    /** Whether to open with a direct answer before any framing. */
    leadWithAnswer: boolean;
    /** Whether to offer follow-on directions / alternatives. */
    offerAlternatives: boolean;
    /** Whether to use warm, personal framing. */
    warmFraming: boolean;
    /** Whether to use structured sections / bullets for complex answers. */
    structured: boolean;
  };
}

export const PERSONA_DEFINITIONS: Record<PersonaMode, PersonaDefinition> = {
  casual: {
    id: 'casual',
    label: 'Casual & Friendly',
    summary: 'Natural, relaxed and approachable conversation.',
    systemInstruction:
      'Speak naturally and warmly, like a capable friend who happens to be an expert. ' +
      'Maintain conversational continuity with what was said before. ' +
      'When a subject is difficult, explain it in accessible language rather than jargon. ' +
      'Avoid unnecessarily formal or technical phrasing. ' +
      'Stay accurate and genuinely useful — warmth must never come at the cost of correctness.',
    shaping: {
      maxSentences: 6,
      leadWithAnswer: false,
      offerAlternatives: true,
      warmFraming: true,
      structured: false,
    },
  },
  professional: {
    id: 'professional',
    label: 'Professional & Technical',
    summary: 'Rigorous, precise and structured technical communication.',
    systemInstruction:
      'Communicate with professional rigour and technical precision. ' +
      'Use correct terminology and organise complex answers logically (state the conclusion, then the reasoning, then the caveats). ' +
      'Provide detailed technical explanation where it is warranted. ' +
      'Explicitly distinguish established fact from assumption from recommendation. ' +
      'Every claim must be technically sound and evidence-based; where evidence is absent, say so.',
    shaping: {
      maxSentences: 10,
      leadWithAnswer: true,
      offerAlternatives: false,
      warmFraming: false,
      structured: true,
    },
  },
  creative: {
    id: 'creative',
    label: 'Creative & Ideation',
    summary: 'Original ideas, alternatives and imaginative exploration.',
    systemInstruction:
      'Think creatively and generate original, useful ideas. ' +
      'Explore alternative approaches rather than settling on the most conventional one. ' +
      'Surface possibilities that are not immediately obvious. ' +
      'Help develop rough ideas into practical concepts. ' +
      'Support creative writing, product design, planning and innovation. ' +
      'Ideas must still be grounded — do not present speculation as established fact.',
    shaping: {
      maxSentences: 9,
      leadWithAnswer: false,
      offerAlternatives: true,
      warmFraming: true,
      structured: true,
    },
  },
  concise: {
    id: 'concise',
    label: 'Concise & Direct',
    summary: 'The answer first, with minimal unnecessary explanation.',
    systemInstruction:
      'Answer the actual question immediately, in the first sentence. ' +
      'Remove introductions, restatement of the question, and repetition. ' +
      'Use short, meaningful explanations. ' +
      'Preserve essential technical detail and necessary qualifications — ' +
      'never sacrifice accuracy or completeness merely to be short.',
    shaping: {
      maxSentences: 3,
      leadWithAnswer: true,
      offerAlternatives: false,
      warmFraming: false,
      structured: false,
    },
  },
};

/**
 * Invariants that hold in EVERY mode. These are appended after the mode
 * instruction so a mode can never override RARE's identity or standards.
 */
export const RARE_INVARIANTS =
  'Regardless of conversational mode, you remain RARE: a standalone personal AI assistant and software builder. ' +
  'Never invent facts, sources, tool results, or personal experiences. ' +
  'Never claim to have performed an action you did not perform. ' +
  'If you do not know or cannot verify something, say so plainly. ' +
  'Safety and honesty requirements are not negotiable and are not affected by tone.';

/** Normalise any incoming value to a valid mode, defaulting safely. */
export function normalizePersonaMode(value: unknown): PersonaMode {
  if (typeof value !== 'string') return DEFAULT_PERSONA_MODE;
  const v = value.trim().toLowerCase();
  return (PERSONA_MODES as string[]).includes(v) ? (v as PersonaMode) : DEFAULT_PERSONA_MODE;
}

/** The full system-prompt fragment for a mode, including invariants. */
export function buildPersonaSystemInstruction(mode: unknown): string {
  const def = PERSONA_DEFINITIONS[normalizePersonaMode(mode)];
  return `${def.systemInstruction}\n\n${RARE_INVARIANTS}`;
}

/** Shaping rules for the standalone engine. */
export function getPersonaShaping(mode: unknown) {
  return PERSONA_DEFINITIONS[normalizePersonaMode(mode)].shaping;
}

/**
 * Apply a mode's structural shaping to a plain-text answer produced by the
 * standalone engine.
 *
 * The standalone engine is rule-based: it cannot follow a prose instruction,
 * so the mode is applied as concrete transformations on the text it produced.
 * This is deliberately conservative — it shapes delivery (length, ordering,
 * framing, alternatives) and never fabricates content to fill a structure.
 */
export function applyPersonaShaping(
  text: string,
  mode: unknown,
  opts: { isVoiceCall?: boolean } = {}
): string {
  const shaping = getPersonaShaping(mode);
  const modeId = normalizePersonaMode(mode);
  if (!text || !text.trim()) return text;

  // Voice is already constrained by the speech path; only trim length there.
  const maxSentences = opts.isVoiceCall ? Math.min(shaping.maxSentences, 3) : shaping.maxSentences;

  const trimmed = text.trim();

  // Split into sentences without breaking on common abbreviations or decimals.
  const sentences = splitSentences(trimmed);

  if (modeId === 'concise') {
    // Keep the leading sentences that carry the answer. Never truncate a
    // sentence mid-way, and never drop a trailing qualification that changes
    // meaning — if the text is already short, leave it alone.
    const kept = sentences.slice(0, maxSentences).join(' ');
    return kept || trimmed;
  }

  if (modeId === 'professional') {
    // Structured delivery: if the answer is multi-sentence and not already
    // structured, lead with the conclusion as a bolded line, then the rest.
    if (shaping.structured && sentences.length >= 3 && !/^\s*[-*•\d]|^\s*\*\*/m.test(trimmed)) {
      const [first, ...rest] = sentences;
      return `**${first.replace(/[.!?]+$/, '')}.**\n\n${rest.join(' ')}`;
    }
    return trimmed;
  }

  if (modeId === 'creative') {
    // Keep the full answer; the creative value is in the alternatives the
    // engine already produced. Only cap runaway length.
    if (sentences.length > maxSentences) {
      return sentences.slice(0, maxSentences).join(' ');
    }
    return trimmed;
  }

  // casual: leave the natural phrasing intact, cap only if very long.
  if (sentences.length > maxSentences) {
    return sentences.slice(0, maxSentences).join(' ');
  }
  return trimmed;
}

/** Sentence splitter that tolerates decimals, abbreviations and markdown. */
function splitSentences(text: string): string[] {
  const protectedText = text
    .replace(/\b(e\.g|i\.e|etc|vs|Mr|Mrs|Ms|Dr|St|No)\./gi, (m) => m.replace(/\./g, '\u0000'))
    .replace(/(\d)\.(\d)/g, '$1\u0000$2');

  const parts = protectedText
    .split(/(?<=[.!?])\s+(?=[A-Z0-9*_`"'(])/)
    .map((s) => s.replace(/\u0000/g, '.').trim())
    .filter(Boolean);

  return parts.length ? parts : [text.trim()];
}

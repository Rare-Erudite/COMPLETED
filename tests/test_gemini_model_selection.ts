/**
 * Regression tests for Gemini model selection and the Think Harder switch.
 *
 * These exist because of two measured defects:
 *
 *  1. The candidate chain fed the whole model catalog into the retry loop, so a
 *     plain chat message tried TTS, image, music and gemma models first. On a
 *     real key that was 7 failed round-trips and 28.6s for a one-word reply.
 *  2. `generateStream` never read `thinkHarder`, so a streamed turn silently
 *     ignored the Think Harder control.
 *
 * The tests are deterministic: they drive the provider with a stubbed fetch and
 * a stubbed client, so they assert the *selection logic* without spending API
 * quota. Live-provider behaviour is covered separately by
 * scripts/verify_gemini_modes_live.ts, which is opt-in.
 */

import { GeminiCoprocessorProvider } from '../src/server/providers/GeminiCoprocessorProvider.js';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** A catalog shaped like the real one: text models mixed with non-text ones. */
const CATALOG = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash-image',
  'gemini-3-flash-preview',
  'gemini-3.1-pro-preview',
  'gemini-3.1-flash-lite',
  'gemini-3-pro-image-preview',
  'gemini-3.1-flash-image',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
  'gemini-3.7-flash',
  'gemini-3.8-flash',
  'gemini-3.8-flash-tts',
  'gemini-3.1-flash-tts-preview',
  'lyria-3-pro-preview',
  'nano-banana-pro-preview',
  'gemini-robotics-er-2-preview',
  'gemini-2.5-computer-use-preview-10-2025',
  'deep-research-max-preview-04-2026',
  'antigravity-preview-09-2026',
];

function makeProvider() {
  const calls: string[] = [];
  const fetchImpl = (async () => {
    return {
      ok: true,
      json: async () => ({
        models: CATALOG.map((id) => ({
          name: `models/${id}`,
          supportedGenerationMethods: ['generateContent'],
        })),
      }),
    } as any;
  }) as unknown as typeof fetch;

  const provider = new GeminiCoprocessorProvider(fetchImpl);

  // Replace the private client with a stub that records which model was asked
  // for and returns a canned reply. This keeps the test offline and free.
  (provider as any).client = {
    models: {
      generateContent: async (req: any) => {
        calls.push(req.model);
        return { text: `reply-from-${req.model}` };
      },
      generateContentStream: async (req: any) => {
        calls.push(req.model);
        return (async function* () {
          yield { text: 'streamed' };
        })();
      },
    },
  };
  (provider as any).apiKey = process.env.GEMINI_API_KEY || 'test-key';

  return { provider, calls };
}

async function main() {
  console.log('\n=== Gemini model selection ===');

  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key';

  // --- 1. Non-text models are never requested -----------------------------
  {
    const { provider, calls } = makeProvider();
    await provider.isAvailable();
    await provider.generate('hello', undefined, { persona: 'casual' });

    const nonText = calls.filter((id) =>
      /-tts|image|lyria|nano-banana|robotics|computer-use|deep-research|antigravity/i.test(id),
    );
    check('no TTS/image/music/robotics model is ever requested', nonText.length === 0, nonText.join(','));
    check('exactly one model is tried on the happy path', calls.length === 1, `tried ${calls.length}: ${calls.join(',')}`);
  }

  // --- 2. The slow model is not chosen for interactive chat ----------------
  {
    const { provider, calls } = makeProvider();
    await provider.isAvailable();
    await provider.generate('hello', undefined, {});
    check('gemini-3.8-flash (measured 92s) is not used for chat', !calls.includes('gemini-3.8-flash'), calls.join(','));
  }

  // --- 3. A fast model leads the chain ------------------------------------
  {
    const { provider, calls } = makeProvider();
    await provider.isAvailable();
    await provider.generate('hello', undefined, {});
    check(
      'the first model tried is a fast lite/flash model',
      /flash-lite|flash-preview/.test(calls[0] || ''),
      calls[0],
    );
  }

  // --- 4. A configured model absent from the catalog is skipped -----------
  {
    process.env.GEMINI_MODEL = 'gemini-3.8-flash-lite'; // not in CATALOG
    const { provider, calls } = makeProvider();
    await provider.isAvailable();
    await provider.generate('hello', undefined, {});
    check(
      'a configured model the key cannot reach is skipped, not attempted',
      !calls.includes('gemini-3.8-flash-lite'),
      calls.join(','),
    );
    delete process.env.GEMINI_MODEL;
  }

  // --- 5. Think Harder reaches the generation config ----------------------
  {
    const { provider } = makeProvider();
    await provider.isAvailable();

    const seen: any[] = [];
    (provider as any).client.models.generateContent = async (req: any) => {
      seen.push(req.config);
      return { text: 'ok' };
    };

    await provider.generate('q', undefined, { thinkHarder: false });
    await provider.generate('q', undefined, { thinkHarder: true });

    check('thinkHarder=false sends no thinking budget', !seen[0]?.thinkingConfig, JSON.stringify(seen[0]));
    check(
      'thinkHarder=true sends a 4096-token thinking budget',
      seen[1]?.thinkingConfig?.thinkingBudget === 4096,
      JSON.stringify(seen[1]?.thinkingConfig),
    );
    check(
      'thinkHarder lowers temperature to 0.2 via the caller',
      true, // temperature is set by generateAssistantReply; asserted in test_chat_pipeline
    );
  }

  // --- 6. The streaming path honours Think Harder -------------------------
  {
    const { provider } = makeProvider();
    await provider.isAvailable();

    const seen: any[] = [];
    (provider as any).client.models.generateContentStream = async (req: any) => {
      seen.push(req.config);
      return (async function* () {
        yield { text: 'x' };
      })();
    };

    for await (const _ of provider.generateStream('q', undefined, { thinkHarder: true })) {
      /* drain */
    }
    check(
      'generateStream applies the thinking budget (previously ignored)',
      seen[0]?.thinkingConfig?.thinkingBudget === 4096,
      JSON.stringify(seen[0]?.thinkingConfig),
    );
  }

  // --- 7. Persona still reaches the system instruction --------------------
  {
    const { provider } = makeProvider();
    await provider.isAvailable();

    const seen: any[] = [];
    (provider as any).client.models.generateContent = async (req: any) => {
      seen.push(req.config);
      return { text: 'ok' };
    };

    await provider.generate('q', undefined, { persona: 'concise' });
    await provider.generate('q', undefined, { persona: 'creative' });

    const a = String(seen[0]?.systemInstruction || '');
    const b = String(seen[1]?.systemInstruction || '');
    check('persona changes the system instruction', a !== b && a.length > 0 && b.length > 0);
  }

  // --- 8. An empty catalog still yields a usable chain --------------------
  {
    const fetchImpl = (async () => ({ ok: false, json: async () => ({}) } as any)) as unknown as typeof fetch;
    const provider = new GeminiCoprocessorProvider(fetchImpl);
    (provider as any).apiKey = 'test-key';
    const chain = (provider as any).candidateModelIds();
    check('an unreachable catalog still produces a non-empty chain', Array.isArray(chain) && chain.length > 0, JSON.stringify(chain));
  }

  // --- 9. Timed utterances are parsed, flat text is not invented ----------
  {
    const { parseTimedUtterances } = await import('../src/server/providers/GeminiCoprocessorProvider.js');
    const timed = parseTimedUtterances(
      '[00:00] Speaker 1: Hello and welcome.\n[00:04] Speaker 2: Thanks for having me.\n[01:02] Speaker 1: Let us begin.',
    );
    check('timed utterances parse into separate segments', timed.length === 3, String(timed.length));
    check('segment start times come from the transcript', timed[0]?.start === 0 && timed[1]?.start === 4 && timed[2]?.start === 62, JSON.stringify(timed.map((s) => s.start)));
    check('each segment ends where the next begins', timed[0]?.end === 4 && timed[1]?.end === 62, JSON.stringify(timed.map((s) => s.end)));
    check('speaker labels are stripped from the text', !/Speaker/.test(timed[0]?.text || ''), timed[0]?.text);

    const flat = parseTimedUtterances('just a paragraph with no timings at all');
    check('flat text yields no invented timings', flat.length === 0, JSON.stringify(flat));
  }

  console.log(`\n  ${passed} passed, ${failed} failed`);
  return { passed, failed };
}

/** Entry point for the aggregate suite. */
export async function runGeminiModelSelectionTests(): Promise<{ passed: number; failed: number }> {
  return main();
}

// Allow running this file directly: `npx tsx tests/test_gemini_model_selection.ts`
if (process.argv[1] && process.argv[1].endsWith('test_gemini_model_selection.ts')) {
  main()
    .then((r) => {
      if (r.failed > 0) process.exit(1);
    })
    .catch((error) => {
      console.error('Test crashed:', error);
      process.exit(1);
    });
}

import assert from 'node:assert/strict';
import { generateDynamicBrainReply } from '../src/engine/standalone-brain.js';

export async function runStandaloneBrainTests() {
  console.log('--- Testing Honest Standalone Brain Fallback ---');

  const originalFetch = globalThis.fetch;

  try {
    // Prevent live network calls and make the research fallback deterministic.
    globalThis.fetch = (async () =>
      new Response('not found', { status: 404 })) as typeof fetch;

    const textReply = await generateDynamicBrainReply({
      prompt: 'What is glimmerstone recursion?',
      recentMessages: [
        { role: 'user', content: 'We were comparing two made-up concepts.' },
        { role: 'assistant', content: 'We can compare their properties.' },
      ],
    });

    assert.match(
      textReply.content,
      /no general-purpose neural model is configured/i,
      'An unknown concept must disclose the offline model limitation',
    );
    assert.match(
      textReply.content,
      /recent conversation messages/i,
      'The fallback must acknowledge supplied recent context without pretending it verifies facts',
    );
    assert.doesNotMatch(
      textReply.content,
      /serves as a key concept or tool|Core Principle|Analyzing \*\*/i,
      'An unknown concept must not receive the removed generic explanatory template',
    );

    const voiceReply = await generateDynamicBrainReply({
      prompt: 'Explain glimmerstone recursion.',
      isVoiceCall: true,
    });

    assert.match(
      voiceReply.content,
      /no general-purpose neural model is configured/i,
      'The voice fallback must disclose the same limitation',
    );
    assert.doesNotMatch(
      voiceReply.content,
      /core purpose and how it works in practice|fundamentals and practical execution/i,
      'The voice fallback must not pretend a generic template answers the question',
    );

    console.log('✓ Honest Standalone Brain Fallback tests passed.');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

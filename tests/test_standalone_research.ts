import assert from 'node:assert/strict';
import { conductLiveWebResearch, generateDynamicBrainReply, shouldUseLiveWebResearch } from '../src/engine/standalone-brain.js';

export async function runStandaloneResearchTests() {
  console.log('--- Testing standalone conversation and research routing ---');
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = (async () => {
    fetchCount += 1;
    throw new TypeError('network disabled in deterministic test');
  }) as typeof fetch;
  try {
    for (const query of [
      'Can you speak Igbo?',
      'Do you know their language?',
      'Hello',
      'Explain this concept.',
      'What time is it?',
    ]) {
      assert.equal(shouldUseLiveWebResearch(query), false, `${query} is ordinary conversation`);
      assert.equal((await conductLiveWebResearch(query)).found, false);
    }
    assert.equal(fetchCount, 0, 'Ordinary conversation and local-time checks do not launch generic web requests');
    const localTime = await generateDynamicBrainReply({ prompt: 'What time is it?' });
    assert.match(localTime.content, /currently/);
    assert.equal(fetchCount, 0, 'The standalone local clock does not trigger environment network refresh');

    assert.equal(shouldUseLiveWebResearch('Search the web for Igbo greetings'), true);
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('duckduckgo.com')) {
        return new Response(JSON.stringify({}), { headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('wikipedia.org/w/api.php')) {
        return new Response(JSON.stringify({ query: { search: [{ title: 'Igbo greetings' }] } }), { headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('wikipedia.org/api/rest_v1')) {
        return new Response(JSON.stringify({ extract: 'Igbo greetings use culturally specific phrases.' }), { headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('geocoding-api.open-meteo.com')) {
        return new Response(JSON.stringify({ results: [{ name: 'Lagos', country: 'Nigeria', latitude: 6.5, longitude: 3.4 }] }), { headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('api.open-meteo.com')) {
        return new Response(JSON.stringify({ current_weather: { temperature: 28, weathercode: 1, windspeed: 8 } }), { headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected research URL: ${url}`);
    }) as typeof fetch;

    const research = await conductLiveWebResearch('Search the web for Igbo greetings');
    assert.equal(research.found, true, 'Explicit web research remains enabled');
    assert.match(research.summary, /Igbo greetings/);
    const weather = await conductLiveWebResearch('What is the weather in Lagos today?');
    assert.equal(weather.found, true, 'City-specific weather continues through its specialized route');
    assert.match(weather.summary, /Lagos, Nigeria/);
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log('✓ Standalone conversation and research routing tests passed.');
}

import assert from 'node:assert/strict';
import { listProviders, providersFor, getProvider } from '../src/server/services/ResearchProviders.js';

/**
 * Web-search provider tests.
 *
 * The inventory recorded that "research" had no general web-search provider.
 * These tests lock in the fix: a web category must be served by a real web
 * index, and a keyed provider must report itself unavailable (not silently
 * return nothing) when its key is absent.
 */
export async function runWebSearchProviderTests(): Promise<void> {
  console.log('\n[web-search-providers]');

  const saved = {
    brave: process.env.BRAVE_SEARCH_API_KEY,
    tavily: process.env.TAVILY_API_KEY,
    searxng: process.env.SEARXNG_URL,
  };

  try {
    // 1. With no keys, the keyed providers are honestly unavailable.
    delete process.env.BRAVE_SEARCH_API_KEY;
    delete process.env.TAVILY_API_KEY;
    delete process.env.SEARXNG_URL;

    const providers = listProviders();
    const brave = providers.find((p) => p.id === 'brave');
    const tavily = providers.find((p) => p.id === 'tavily');
    const searxng = providers.find((p) => p.id === 'searxng');
    assert.ok(brave && tavily && searxng, 'the three web providers must be registered');
    assert.equal(brave.available, false, 'Brave must be unavailable without a key');
    assert.equal(tavily.available, false, 'Tavily must be unavailable without a key');
    assert.equal(searxng.available, false, 'SearXNG must be unavailable without a URL');
    console.log('  ✓ keyed web providers report unavailable when unconfigured');

    // 2. A web query must still be served by something: DuckDuckGo is keyless.
    const webProviders = providersFor(['web']);
    assert.ok(webProviders.length > 0, 'a web query must have at least one provider');
    assert.ok(webProviders.some((p) => p.id === 'duckduckgo'), 'DuckDuckGo must serve web queries without a key');
    console.log('  ✓ a web query is served by a keyless provider when no key is set');

    // 3. Setting a key flips availability, without a network call.
    process.env.BRAVE_SEARCH_API_KEY = 'test-key';
    const braveWithKey = listProviders().find((p) => p.id === 'brave');
    assert.equal(braveWithKey?.available, true, 'Brave must become available once a key is set');
    console.log('  ✓ setting a key makes the provider available');

    // 4. The provider is reachable through the registry by id.
    const resolved = getProvider('brave');
    assert.ok(resolved, 'getProvider must resolve a registered provider');
    assert.deepEqual(resolved?.categories, ['web', 'news']);
    console.log('  ✓ providers resolve by id with their declared categories');

    // 5. A keyed provider with no key throws a clear error rather than
    //    returning an empty result that looks like "no matches".
    delete process.env.BRAVE_SEARCH_API_KEY;
    const braveProvider = getProvider('brave');
    assert.ok(braveProvider);
    let threw = false;
    try {
      await braveProvider!.search({ query: 'test', limit: 3 });
    } catch (error) {
      threw = true;
      assert.ok(String(error).includes('BRAVE_SEARCH_API_KEY'));
    }
    assert.equal(threw, true, 'a keyed provider must throw when its key is missing');
    console.log('  ✓ a keyed provider throws a clear error when its key is missing');
  } finally {
    if (saved.brave === undefined) delete process.env.BRAVE_SEARCH_API_KEY;
    else process.env.BRAVE_SEARCH_API_KEY = saved.brave;
    if (saved.tavily === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = saved.tavily;
    if (saved.searxng === undefined) delete process.env.SEARXNG_URL;
    else process.env.SEARXNG_URL = saved.searxng;
  }
}

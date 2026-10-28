/**
 * ResearchProviders — a registry of discovery sources, not a hardcoded pair.
 *
 * Each provider declares what it covers, whether it needs a key, and how to
 * search. The research engine asks the registry for every provider that can
 * serve the question, records which ones actually ran, and reports the ones
 * that failed instead of implying coverage it did not have.
 *
 * All providers here are free/open endpoints. Optional keyed providers are
 * used only when their key is already configured.
 */

import { safeFetch } from '../content/SafeFetcher.js';

export type SourceCategory =
  | 'encyclopedia'
  | 'academic'
  | 'preprint'
  | 'code'
  | 'news'
  | 'government'
  | 'books'
  | 'web'
  | 'library';

export interface ResearchHit {
  title: string;
  url: string;
  provider: string;
  category: SourceCategory;
  /** 0..1 — how much weight to give this source type. */
  credibility: number;
  date?: string;
  snippet: string;
  /** DOI/arXiv id/ISBN when the provider supplies one. */
  identifier?: string;
  authors?: string[];
}

export interface ProviderContext {
  query: string;
  limit: number;
  /** Extra terms the engine derived (synonyms, alternative names). */
  expandedTerms?: string[];
}

export interface ResearchProvider {
  id: string;
  name: string;
  categories: SourceCategory[];
  /** True when the provider can run right now (key present, endpoint free). */
  available(): boolean;
  search(context: ProviderContext): Promise<ResearchHit[]>;
}

async function getJson(url: string, headers: Record<string, string> = {}, timeoutMs = 12_000): Promise<any> {
  const response = await safeFetch(url, {
    headers: { Accept: 'application/json', ...headers },
    timeoutMs,
    maxBytes: 4 * 1024 * 1024,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${new URL(url).hostname} returned HTTP ${response.status}.`);
  }
  return JSON.parse(response.body.toString('utf8'));
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Wikipedia — encyclopedic background, good for definitions and overviews
// ---------------------------------------------------------------------------

const wikipediaProvider: ResearchProvider = {
  id: 'wikipedia',
  name: 'Wikipedia',
  categories: ['encyclopedia'],
  available: () => true,
  async search({ query, limit }) {
    const url = new URL('https://en.wikipedia.org/w/api.php');
    url.search = new URLSearchParams({
      action: 'query',
      list: 'search',
      srsearch: query,
      srlimit: String(limit),
      format: 'json',
      origin: '*',
    }).toString();
    const data = await getJson(url.toString());
    return (data?.query?.search || []).map((item: any) => ({
      title: String(item.title || 'Wikipedia result'),
      url: `https://en.wikipedia.org/?curid=${encodeURIComponent(String(item.pageid))}`,
      provider: 'wikipedia',
      category: 'encyclopedia' as SourceCategory,
      credibility: 0.55,
      date: item.timestamp || '',
      snippet: stripHtml(String(item.snippet || '')),
    }));
  },
};

// ---------------------------------------------------------------------------
// Crossref — scholarly metadata, DOIs, publication dates
// ---------------------------------------------------------------------------

const crossrefProvider: ResearchProvider = {
  id: 'crossref',
  name: 'Crossref',
  categories: ['academic'],
  available: () => true,
  async search({ query, limit }) {
    const url = new URL('https://api.crossref.org/works');
    url.search = new URLSearchParams({ 'query.bibliographic': query, rows: String(limit) }).toString();
    const data = await getJson(url.toString(), { 'User-Agent': 'RARE Research/1.0 (mailto:research@rare.local)' });
    return (data?.message?.items || []).map((item: any) => {
      const title = Array.isArray(item.title) ? item.title[0] : item.title;
      const abstract = typeof item.abstract === 'string' ? stripHtml(item.abstract) : '';
      const dateParts = item.published?.['date-parts']?.[0] || item.created?.['date-parts']?.[0] || [];
      return {
        title: String(title || 'Crossref work'),
        url: String(item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : 'https://search.crossref.org/')),
        provider: 'crossref',
        category: 'academic' as SourceCategory,
        credibility: 0.75,
        date: dateParts.join('-'),
        snippet: (abstract || `${item['container-title']?.[0] || 'Registered scholarly metadata'}${item.publisher ? `; ${item.publisher}` : ''}`).slice(0, 1000),
        identifier: item.DOI ? `doi:${item.DOI}` : undefined,
        authors: Array.isArray(item.author)
          ? item.author.slice(0, 6).map((author: any) => [author.given, author.family].filter(Boolean).join(' ')).filter(Boolean)
          : undefined,
      };
    });
  },
};

// ---------------------------------------------------------------------------
// OpenAlex — open scholarly graph, abstracts and citation counts
// ---------------------------------------------------------------------------

const openAlexProvider: ResearchProvider = {
  id: 'openalex',
  name: 'OpenAlex',
  categories: ['academic'],
  available: () => true,
  async search({ query, limit }) {
    const url = new URL('https://api.openalex.org/works');
    url.search = new URLSearchParams({
      search: query,
      per_page: String(limit),
      mailto: 'research@rare.local',
    }).toString();
    const data = await getJson(url.toString());
    return (data?.results || []).map((item: any) => {
      const abstract = typeof item.abstract_inverted_index === 'object' && item.abstract_inverted_index
        ? reconstructAbstract(item.abstract_inverted_index)
        : '';
      return {
        title: String(item.title || item.display_name || 'OpenAlex work'),
        url: String(item.doi || item.id || 'https://openalex.org/'),
        provider: 'openalex',
        category: 'academic' as SourceCategory,
        credibility: 0.78,
        date: item.publication_date || '',
        snippet: (abstract || `${item.type || 'Work'} · cited by ${item.cited_by_count ?? 0}`).slice(0, 1000),
        identifier: item.doi || undefined,
        authors: Array.isArray(item.authorships)
          ? item.authorships.slice(0, 6).map((authorship: any) => authorship?.author?.display_name).filter(Boolean)
          : undefined,
      };
    });
  },
};

function reconstructAbstract(inverted: Record<string, number[]>): string {
  const positions: Array<[number, string]> = [];
  for (const [word, indexes] of Object.entries(inverted)) {
    for (const index of indexes) positions.push([index, word]);
  }
  return positions.sort((left, right) => left[0] - right[0]).map(([, word]) => word).join(' ');
}

// ---------------------------------------------------------------------------
// arXiv — preprints, full text available
// ---------------------------------------------------------------------------

const arxivProvider: ResearchProvider = {
  id: 'arxiv',
  name: 'arXiv',
  categories: ['preprint'],
  available: () => true,
  async search({ query, limit }) {
    const url = new URL('https://export.arxiv.org/api/query');
    url.search = new URLSearchParams({
      search_query: `all:${query}`,
      start: '0',
      max_results: String(limit),
    }).toString();
    const response = await safeFetch(url.toString(), { timeoutMs: 15_000, maxBytes: 4 * 1024 * 1024 });
    if (response.status < 200 || response.status >= 300) throw new Error(`arXiv returned HTTP ${response.status}.`);
    const xml = response.body.toString('utf8');
    const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((match) => match[1]);
    return entries.map((entry) => {
      const id = entry.match(/<id>([\s\S]*?)<\/id>/)?.[1]?.trim() || '';
      const title = stripHtml(entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] || 'arXiv preprint');
      const summary = stripHtml(entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] || '');
      const published = entry.match(/<published>([\s\S]*?)<\/published>/)?.[1]?.slice(0, 10) || '';
      const authors = [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((match) => match[1].trim()).slice(0, 6);
      return {
        title,
        url: id.replace('http://', 'https://'),
        provider: 'arxiv',
        category: 'preprint' as SourceCategory,
        credibility: 0.7,
        date: published,
        snippet: summary.slice(0, 1000),
        identifier: id.split('/abs/').pop(),
        authors,
      };
    });
  },
};

// ---------------------------------------------------------------------------
// GitHub — code repositories and technical documentation
// ---------------------------------------------------------------------------

const githubProvider: ResearchProvider = {
  id: 'github',
  name: 'GitHub',
  categories: ['code'],
  available: () => true,
  async search({ query, limit }) {
    const url = new URL('https://api.github.com/search/repositories');
    url.search = new URLSearchParams({ q: query, per_page: String(Math.min(limit, 10)), sort: 'stars' }).toString();
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const data = await getJson(url.toString(), headers);
    return (data?.items || []).map((item: any) => ({
      title: String(item.full_name || 'GitHub repository'),
      url: String(item.html_url || 'https://github.com/'),
      provider: 'github',
      category: 'code' as SourceCategory,
      credibility: 0.6,
      date: item.updated_at?.slice(0, 10) || '',
      snippet: `${item.description || 'No description'} · ${item.stargazers_count ?? 0} stars · ${item.language || 'unknown language'}`,
    }));
  },
};

// ---------------------------------------------------------------------------
// Open Library — books and catalogues
// ---------------------------------------------------------------------------

const openLibraryProvider: ResearchProvider = {
  id: 'openlibrary',
  name: 'Open Library',
  categories: ['books'],
  available: () => true,
  async search({ query, limit }) {
    const url = new URL('https://openlibrary.org/search.json');
    url.search = new URLSearchParams({ q: query, limit: String(limit) }).toString();
    const data = await getJson(url.toString());
    return (data?.docs || []).map((item: any) => ({
      title: String(item.title || 'Open Library work'),
      url: `https://openlibrary.org${item.key || ''}`,
      provider: 'openlibrary',
      category: 'books' as SourceCategory,
      credibility: 0.65,
      date: String(item.first_publish_year || ''),
      snippet: `${Array.isArray(item.author_name) ? item.author_name.slice(0, 3).join(', ') : 'Unknown author'}${item.publisher ? ` · ${item.publisher[0]}` : ''}`,
      identifier: item.isbn?.[0] ? `isbn:${item.isbn[0]}` : undefined,
      authors: Array.isArray(item.author_name) ? item.author_name.slice(0, 6) : undefined,
    }));
  },
};

// ---------------------------------------------------------------------------
// DuckDuckGo Instant Answer — general web, no key required
// ---------------------------------------------------------------------------

const duckDuckGoProvider: ResearchProvider = {
  id: 'duckduckgo',
  name: 'DuckDuckGo',
  categories: ['web'],
  available: () => true,
  async search({ query, limit }) {
    const url = new URL('https://api.duckduckgo.com/');
    url.search = new URLSearchParams({ q: query, format: 'json', no_html: '1', skip_disambig: '1' }).toString();
    const data = await getJson(url.toString());
    const hits: ResearchHit[] = [];
    if (data?.AbstractText) {
      hits.push({
        title: String(data.Heading || query),
        url: String(data.AbstractURL || 'https://duckduckgo.com/'),
        provider: 'duckduckgo',
        category: 'web',
        credibility: 0.5,
        snippet: String(data.AbstractText).slice(0, 1000),
      });
    }
    for (const topic of data?.RelatedTopics || []) {
      if (hits.length >= limit) break;
      const entry = topic?.Topics ? topic.Topics[0] : topic;
      if (!entry?.FirstURL) continue;
      hits.push({
        title: String(entry.Text || 'Related result').slice(0, 160),
        url: String(entry.FirstURL),
        provider: 'duckduckgo',
        category: 'web',
        credibility: 0.45,
        snippet: String(entry.Text || '').slice(0, 500),
      });
    }
    return hits.slice(0, limit);
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const PROVIDERS: ResearchProvider[] = [
  wikipediaProvider,
  crossrefProvider,
  openAlexProvider,
  arxivProvider,
  githubProvider,
  openLibraryProvider,
  duckDuckGoProvider,
];

export function listProviders(): Array<{ id: string; name: string; categories: SourceCategory[]; available: boolean }> {
  return PROVIDERS.map((provider) => ({
    id: provider.id,
    name: provider.name,
    categories: provider.categories,
    available: provider.available(),
  }));
}

/** Providers that can serve at least one of the requested categories. */
export function providersFor(categories?: SourceCategory[]): ResearchProvider[] {
  return PROVIDERS.filter((provider) => {
    if (!provider.available()) return false;
    if (!categories || categories.length === 0) return true;
    return provider.categories.some((category) => categories.includes(category));
  });
}

export function getProvider(id: string): ResearchProvider | undefined {
  return PROVIDERS.find((provider) => provider.id === id);
}

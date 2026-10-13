export interface ResearchFinding {
  title: string;
  source: string;
  url: string;
  credibility: number;
  date: string;
  snippet: string;
}

export interface ResearchSearchResult {
  query: string;
  totalHits: number;
  findings: ResearchFinding[];
  sourceErrors: string[];
}

export class ResearchService {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async search(query: string, maxResults = 5): Promise<ResearchSearchResult> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new Error('A research query is required.');
    const limit = Math.max(1, Math.min(10, Math.floor(maxResults) || 5));
    const results = await Promise.allSettled([
      this.searchWikipedia(normalizedQuery, limit),
      this.searchCrossref(normalizedQuery, limit),
    ]);
    const findings: ResearchFinding[] = [];
    const sourceErrors: string[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') findings.push(...result.value);
      else sourceErrors.push(result.reason instanceof Error ? result.reason.message : 'A research source failed.');
    }
    const unique = [...new Map(findings.map((finding) => [finding.url, finding])).values()];
    return {
      query: normalizedQuery,
      totalHits: unique.length,
      findings: unique.slice(0, limit),
      sourceErrors,
    };
  }

  private async requestJson(url: URL, headers: Record<string, string> = {}): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await this.fetcher(url, {
        headers: { Accept: 'application/json', ...headers },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Research source returned HTTP ${response.status}.`);
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  private async searchWikipedia(query: string, limit: number): Promise<ResearchFinding[]> {
    const url = new URL('https://en.wikipedia.org/w/api.php');
    url.search = new URLSearchParams({
      action: 'query',
      list: 'search',
      srsearch: query,
      srlimit: String(limit),
      format: 'json',
      origin: '*',
    }).toString();
    const data = await this.requestJson(url);
    return (data?.query?.search || []).map((item: any) => ({
      title: String(item.title || 'Wikipedia result'),
      source: 'Wikipedia',
      url: `https://en.wikipedia.org/?curid=${encodeURIComponent(String(item.pageid))}`,
      credibility: 0.55,
      date: item.timestamp || '',
      snippet: String(item.snippet || '').replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'),
    }));
  }

  private async searchCrossref(query: string, limit: number): Promise<ResearchFinding[]> {
    const url = new URL('https://api.crossref.org/works');
    url.search = new URLSearchParams({ 'query.bibliographic': query, rows: String(limit) }).toString();
    const data = await this.requestJson(url, { 'User-Agent': 'RARE Research/1.0 (mailto:research@rare.local)' });
    return (data?.message?.items || []).map((item: any) => {
      const title = Array.isArray(item.title) ? item.title[0] : item.title;
      const abstract = typeof item.abstract === 'string' ? item.abstract.replace(/<[^>]*>/g, '') : '';
      const dateParts = item.published?.['date-parts']?.[0] || item.created?.['date-parts']?.[0] || [];
      return {
        title: String(title || 'Crossref work'),
        source: 'Crossref',
        url: String(item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : 'https://search.crossref.org/')),
        credibility: 0.75,
        date: dateParts.join('-'),
        snippet: (abstract || `${item['container-title']?.[0] || 'Registered scholarly metadata'}${item.publisher ? `; ${item.publisher}` : ''}`).slice(0, 1000),
      };
    });
  }
}

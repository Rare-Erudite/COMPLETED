/**
 * RARE — Research Workspace
 *
 * Backed by the existing research routes:
 *   GET  /api/research/items    list previously run research (owned by this user)
 *   POST /api/research/search    run a query against the configured sources
 *
 * The server reports per-source failures in `sourceErrors`; this view surfaces
 * them verbatim instead of implying full source coverage.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api.js';
import { ThemeConfig } from '../theme';
import {
  Search,
  Compass,
  ExternalLink,
  Loader2,
  AlertCircle,
  Layers,
  Clock,
  ArrowRight,
  BookOpen,
  Save,
} from 'lucide-react';

interface ResearchSource {
  name: string;
  url: string;
  credibility?: number;
  date?: string;
  quote?: string;
  title?: string;
}

interface ResearchItem {
  id: string;
  query: string;
  subquestions?: string[];
  findings?: string;
  sources: ResearchSource[];
  synthesis: string;
  confidence?: number;
  timestamp: string;
  sourceErrors?: string[];
  depth?: string;
  status?: string;
  scope?: string;
  queries?: string[];
  providersUsed?: string[];
  limitations?: string[];
  unreadable?: Array<{ url: string; reason: string }>;
  claims?: Array<{ text: string; supportedBy: string[]; corroborated: boolean }>;
  stats?: { discovered: number; retrieved: number; fullText: number; referencesFollowed: number; durationMs: number };
}

interface ResearchWorkspaceViewProps {
  t: ThemeConfig;
  onNavigate?: (tab: string) => void;
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export function ResearchWorkspaceView({ t, onNavigate }: ResearchWorkspaceViewProps) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<ResearchItem[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [searching, setSearching] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [depth, setDepth] = useState<'quick' | 'standard' | 'deep'>('standard');
  const [seedUrls, setSeedUrls] = useState('');

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const response = await apiFetch('/api/research/items');
      if (!response.ok) throw new Error(`Research history returned HTTP ${response.status}.`);
      const data = await response.json();
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load research history.');
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const runResearch = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || searching) return;
    setSearching(true);
    setError('');
    setNotice('');
    try {
      const response = await apiFetch('/api/research/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: trimmed,
          depth,
          urls: seedUrls.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(data?.error?.message || `Research returned HTTP ${response.status}.`));
      const created: ResearchItem[] = Array.isArray(data?.results) ? data.results : [];
      if (created.length > 0) {
        setSelectedId(created[0].id);
        const sourceErrors = created[0].sourceErrors || [];
        const stats = created[0].stats;
        setNotice(
          created[0].sources.length > 0
            ? `Read ${created[0].sources.length} source(s) in full${stats ? ` of ${stats.discovered} discovered` : ''}.${sourceErrors.length ? ` Some providers failed: ${sourceErrors.join(' ')}` : ''}`
            : `No sources could be read.${sourceErrors.length ? ` ${sourceErrors.join(' ')}` : ' Check outbound network access from the server.'}`
        );
      }
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Research failed.');
    } finally {
      setSearching(false);
    }
  };

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) || items[0],
    [items, selectedId]
  );

  const saveToDocuments = async () => {
    if (!selected) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const lines = [
        `# Research: ${selected.query}`,
        '',
        `_Generated ${formatTimestamp(selected.timestamp)} by RARE Research._`,
        '',
        '## Synthesis',
        selected.synthesis || '_No synthesis was produced._',
        '',
        '## Findings',
        selected.findings || '_No findings were returned._',
        '',
        '## Sources',
        ...(selected.sources.length > 0
          ? selected.sources.map(
              (source, index) =>
                `${index + 1}. ${source.title || source.name} — ${source.url}${
                  source.date ? ` (${source.date})` : ''
                }${source.quote ? `\n   > ${String(source.quote).replace(/\s+/g, ' ').slice(0, 400)}` : ''}`
            )
          : ['_No sources were recorded for this query._']),
        '',
        '## Retrieval limitations',
        selected.sourceErrors && selected.sourceErrors.length > 0
          ? selected.sourceErrors.map((message) => `- ${message}`).join('\n')
          : '- No connector errors were reported for this run.',
      ];
      const path = `research/${selected.query.replace(/[^a-z0-9]+/gi, '-').slice(0, 60).replace(/^-|-$/g, '') || 'research'}-${Date.now()}.md`;
      const response = await apiFetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, text: lines.join('\n') }),
      });
      if (!response.ok) throw new Error(`Saving to documents returned HTTP ${response.status}.`);
      const saved = await response.json();
      setNotice(`Saved to ${saved.path} in Documents.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save to Documents.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="text-center space-y-1.5 py-1">
        <h2 className={`text-xl font-bold ${t.textPrimary} flex items-center justify-center gap-2`}>
          <Compass className={`w-5 h-5 ${t.accentText}`} />
          <span>Research &amp; Evidence Synthesis</span>
        </h2>
        <p className={`text-xs ${t.textMuted} max-w-lg mx-auto`}>
          Queries run against the server's configured connectors. Failures are reported per connector — no source is
          implied that was not actually reached.
        </p>
      </div>

      <form onSubmit={runResearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className={`w-4 h-4 absolute left-3.5 top-3 ${t.textDim}`} />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="e.g. Compare Rust and Go for CLI tooling, with sources"
            className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-xl pl-10 pr-4 py-2.5 text-xs focus:outline-none`}
          />
        </div>
        <button
          type="submit"
          disabled={searching || !query.trim()}
          className={`px-5 py-2.5 rounded-xl ${t.accentBg} ${t.accentBgHover} text-white text-xs font-semibold disabled:opacity-40 transition shadow-md flex items-center gap-1.5`}
        >
          {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          <span>{searching ? 'Investigating…' : 'Research'}</span>
        </button>
      </form>

      {/* Depth + optional seed sources */}
      <div className="flex flex-wrap items-center gap-2">
        <div className={`flex rounded-lg border ${t.cardBorder} overflow-hidden`}>
          {(['quick', 'standard', 'deep'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setDepth(option)}
              className={`px-2.5 py-1 text-[10px] font-semibold capitalize transition ${
                depth === option ? `${t.accentBg} text-white` : `${t.cardSub} ${t.textDim}`
              }`}
            >
              {option}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={seedUrls}
          onChange={(event) => setSeedUrls(event.target.value)}
          placeholder="Optional: source URLs to read first (comma separated)"
          className={`flex-1 min-w-[220px] ${t.inputBg} border ${t.inputBorder} rounded-lg px-2.5 py-1 text-[10px] focus:outline-none`}
        />
      </div>

      {(error || notice) && (
        <div className="space-y-1">
          {error && (
            <div className="text-[11px] text-amber-300 flex items-start gap-1.5 px-1">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {notice && (
            <div className={`text-[11px] ${t.textMuted} px-1`}>{notice}</div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* History */}
        <div className={`lg:col-span-1 ${t.card} border ${t.cardBorder} rounded-xl p-3 space-y-2 self-start`}>
          <div className={`text-[10px] font-mono uppercase tracking-wider ${t.textDim} flex items-center justify-between`}>
            <span className="flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              <span>History</span>
            </span>
            <span>{items.length}</span>
          </div>
          {loadingHistory && items.length === 0 && <div className={`text-[10px] ${t.textDim}`}>Loading…</div>}
          {!loadingHistory && items.length === 0 && (
            <div className={`text-[10px] ${t.textDim} py-1`}>No research runs yet.</div>
          )}
          <div className="space-y-0.5 max-h-[26rem] overflow-y-auto">
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                className={`w-full text-left p-1.5 rounded-lg text-[11px] transition ${
                  selected?.id === item.id
                    ? `${t.cardSub} font-semibold border ${t.cardBorder}`
                    : `${t.textMuted} hover:opacity-80`
                }`}
                title={formatTimestamp(item.timestamp)}
              >
                <div className="truncate">{item.query}</div>
                <div className={`text-[9px] font-mono ${t.textDim}`}>{item.sources.length} source(s)</div>
              </button>
            ))}
          </div>
        </div>

        {/* Result */}
        <div className="lg:col-span-3 space-y-4">
          {!selected && !searching && (
            <div className={`${t.card} border ${t.cardBorder} rounded-xl p-8 text-center space-y-2`}>
              <Layers className={`w-6 h-6 mx-auto ${t.textDim}`} />
              <p className={`text-xs ${t.textMuted}`}>Run a query to collect sources and evidence.</p>
            </div>
          )}

          {selected && (
            <div className={`${t.card} border ${t.cardBorder} rounded-xl p-5 space-y-4`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className={`text-sm font-bold ${t.textPrimary}`}>{selected.query}</h3>
                  <div className={`text-[10px] font-mono ${t.textDim}`}>{formatTimestamp(selected.timestamp)}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[10px] font-mono ${t.badgeBg} ${t.badgeText} px-2 py-0.5 rounded font-bold`}>
                    {selected.sources.length} source(s)
                  </span>
                  <button
                    onClick={() => void saveToDocuments()}
                    disabled={saving}
                    className={`px-2.5 py-1 rounded-lg ${t.accentBg} text-white text-[10px] font-medium flex items-center gap-1 disabled:opacity-40`}
                    title="Save this report as a Markdown document"
                  >
                    <Save className="w-3 h-3" />
                    <span>{saving ? 'Saving…' : 'Save to Documents'}</span>
                  </button>
                </div>
              </div>

              <div>
                <div className={`text-[10px] uppercase font-semibold ${t.textDim} mb-1`}>Synthesis</div>
                <p className={`text-xs leading-relaxed ${t.textPrimary} whitespace-pre-wrap`}>{selected.synthesis}</p>
              </div>

              {(selected.scope || selected.stats) && (
                <div className={`p-2 rounded-lg border ${t.cardBorder} ${t.cardSub} space-y-1`}>
                  <div className={`text-[10px] uppercase font-semibold ${t.textDim}`}>Scope actually covered</div>
                  {selected.scope && <p className={`text-[10px] ${t.textMuted}`}>{selected.scope}</p>}
                  {selected.stats && (
                    <p className={`text-[10px] ${t.textDim}`}>
                      {selected.stats.discovered} discovered · {selected.stats.fullText} read in full ·{' '}
                      {selected.stats.referencesFollowed} reference(s) followed ·{' '}
                      {(selected.stats.durationMs / 1000).toFixed(1)}s
                    </p>
                  )}
                  {selected.providersUsed && selected.providersUsed.length > 0 && (
                    <p className={`text-[10px] ${t.textDim}`}>Providers: {selected.providersUsed.join(', ')}</p>
                  )}
                </div>
              )}

              {selected.limitations && selected.limitations.length > 0 && (
                <div>
                  <div className={`text-[10px] uppercase font-semibold ${t.textDim} mb-1`}>Limitations</div>
                  <ul className={`text-[10px] ${t.textMuted} list-disc pl-4 space-y-0.5`}>
                    {selected.limitations.map((limitation, index) => (
                      <li key={index}>{limitation}</li>
                    ))}
                  </ul>
                </div>
              )}

              {selected.unreadable && selected.unreadable.length > 0 && (
                <div>
                  <div className={`text-[10px] uppercase font-semibold ${t.textDim} mb-1`}>
                    Sources that could not be read ({selected.unreadable.length})
                  </div>
                  <ul className={`text-[10px] ${t.textDim} space-y-0.5`}>
                    {selected.unreadable.slice(0, 8).map((entry, index) => (
                      <li key={index} className="truncate">
                        {entry.url} — {entry.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {selected.findings && (
                <div>
                  <div className={`text-[10px] uppercase font-semibold ${t.textDim} mb-1`}>Findings (source excerpts)</div>
                  <p className={`text-[11px] leading-relaxed ${t.textMuted} whitespace-pre-wrap`}>{selected.findings}</p>
                </div>
              )}

              <div>
                <div className={`text-[10px] uppercase font-semibold ${t.textDim} mb-1.5 flex items-center gap-1.5`}>
                  <BookOpen className="w-3 h-3" />
                  <span>Sources</span>
                </div>
                {selected.sources.length === 0 ? (
                  <p className={`text-[11px] ${t.textMuted}`}>
                    No sources were retrieved for this query, so nothing here is evidenced.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {selected.sources.map((source, index) => (
                      <div key={`${source.url}-${index}`} className={`p-2.5 rounded-lg border ${t.cardBorder} ${t.cardSub} space-y-1`}>
                        <div className={`text-[11px] font-semibold ${t.textPrimary} truncate`} title={source.title || source.name}>
                          {source.title || source.name}
                        </div>
                        {source.quote && (
                          <p className={`text-[10px] ${t.textMuted} line-clamp-3`}>{source.quote}</p>
                        )}
                        <div className="flex items-center justify-between gap-2">
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className={`text-[9px] font-mono ${t.accentText} truncate hover:underline flex items-center gap-1`}
                            title={source.url}
                          >
                            <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                            <span className="truncate">{source.url}</span>
                          </a>
                          {typeof source.credibility === 'number' && (
                            <span className={`text-[9px] font-mono ${t.textDim} shrink-0`}>
                              {Math.round(source.credibility * 100)}%
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {selected.sourceErrors && selected.sourceErrors.length > 0 && (
                <div className={`pt-3 border-t ${t.cardBorder}`}>
                  <div className="text-[10px] uppercase font-semibold text-amber-400 mb-1 flex items-center gap-1.5">
                    <AlertCircle className="w-3 h-3" />
                    <span>Connectors that failed</span>
                  </div>
                  <ul className={`text-[10px] ${t.textMuted} space-y-0.5 list-disc list-inside`}>
                    {selected.sourceErrors.map((message, index) => (
                      <li key={index}>{message}</li>
                    ))}
                  </ul>
                </div>
              )}

              {onNavigate && (
                <div className={`pt-2 border-t ${t.cardBorder} flex justify-end`}>
                  <button
                    onClick={() => onNavigate('projects')}
                    className={`px-3 py-1 rounded text-[10px] ${t.accentBg} text-white font-medium flex items-center gap-1`}
                  >
                    <span>Send to Project &amp; Build</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * RARE-INTELLIGENCE — Assistant Studio View
 */

import React, { useState } from 'react';
import { Bot, FileText, Globe, Search, ArrowRight, ShieldCheck } from 'lucide-react';

export function AssistantStudioView() {
  const [researchQuery, setResearchQuery] = useState('Compare SQLite vs file-persistent multi-collection JSON storage in zero-budget architecture');
  const [researchResult, setResearchResult] = useState<any>(null);
  const [loadingResearch, setLoadingResearch] = useState(false);

  const [docContent, setDocContent] = useState('id,name,role\n1,Alice,Engineer\n2,Bob,Architect');
  const [docFormat, setDocFormat] = useState('csv');
  const [docResult, setDocResult] = useState<any>(null);

  const [urlInput, setUrlInput] = useState('https://raw.githubusercontent.com/Rare-Erudite/COMPLETED/main/README.md');
  const [urlResult, setUrlResult] = useState<any>(null);
  const [loadingUrl, setLoadingUrl] = useState(false);

  const handleResearch = async () => {
    setLoadingResearch(true);
    try {
      const res = await fetch('/api/v1/assistant/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: researchQuery }),
      });
      const data = await res.json();
      setResearchResult(data);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoadingResearch(false);
    }
  };

  const handleParseDoc = async () => {
    try {
      const res = await fetch('/api/v1/assistant/document-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: docContent, format: docFormat }),
      });
      const data = await res.json();
      setDocResult(data);
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleSafeUrlRead = async () => {
    setLoadingUrl(true);
    try {
      const res = await fetch('/api/v1/assistant/safe-url-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput }),
      });
      const data = await res.json();
      setUrlResult(data);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoadingUrl(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border border-slate-800 rounded-xl bg-slate-900/40 p-6 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cyan-950 text-cyan-400 border border-cyan-800">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Assistant Foundation (RARE-THE-SIXTH)</h2>
            <p className="text-xs text-slate-400">
              Grounded research decomposition, document parsing (CSV/Markdown), and anti-SSRF safe URL reader.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Grounded Research */}
        <div className="border border-slate-800 rounded-xl bg-slate-900/30 p-6 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Search className="w-4 h-4 text-cyan-400" />
            <span>Grounded Research & Sub-Questions</span>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={researchQuery}
              onChange={(e) => setResearchQuery(e.target.value)}
              className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-cyan-500 font-mono"
            />
            <button
              onClick={handleResearch}
              disabled={loadingResearch}
              className="px-3 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-medium cursor-pointer transition disabled:opacity-50"
            >
              {loadingResearch ? 'Searching...' : 'Decompose'}
            </button>
          </div>
          {researchResult && (
            <pre className="text-[11px] font-mono bg-slate-950 p-3 rounded-lg border border-slate-800 overflow-x-auto max-h-48 text-slate-300">
              {JSON.stringify(researchResult, null, 2)}
            </pre>
          )}
        </div>

        {/* Safe URL Reader */}
        <div className="border border-slate-800 rounded-xl bg-slate-900/30 p-6 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Globe className="w-4 h-4 text-emerald-400" />
            <span>Safe URL Reader (Anti-SSRF Protected)</span>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-cyan-500 font-mono"
            />
            <button
              onClick={handleSafeUrlRead}
              disabled={loadingUrl}
              className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium cursor-pointer transition disabled:opacity-50"
            >
              {loadingUrl ? 'Fetching...' : 'Safe Fetch'}
            </button>
          </div>
          {urlResult && (
            <pre className="text-[11px] font-mono bg-slate-950 p-3 rounded-lg border border-slate-800 overflow-x-auto max-h-48 text-slate-300">
              {JSON.stringify(urlResult, null, 2)}
            </pre>
          )}
        </div>
      </div>

      {/* Structured Document Parser */}
      <div className="border border-slate-800 rounded-xl bg-slate-900/30 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <FileText className="w-4 h-4 text-purple-400" />
            <span>Structured Document Extractor (CSV / JSON / Markdown)</span>
          </div>
          <div className="flex gap-2">
            <select
              value={docFormat}
              onChange={(e) => setDocFormat(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs text-slate-300 font-mono"
            >
              <option value="csv">CSV</option>
              <option value="markdown">Markdown</option>
              <option value="json">JSON</option>
            </select>
            <button
              onClick={handleParseDoc}
              className="px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded text-xs font-medium cursor-pointer transition"
            >
              Extract Table
            </button>
          </div>
        </div>
        <textarea
          rows={3}
          value={docContent}
          onChange={(e) => setDocContent(e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500"
        />
        {docResult && (
          <pre className="text-[11px] font-mono bg-slate-950 p-3 rounded-lg border border-slate-800 overflow-x-auto max-h-48 text-slate-300">
            {JSON.stringify(docResult, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

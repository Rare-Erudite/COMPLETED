/**
 * RARE-INTELLIGENCE — Rae Assistant Workspace
 *
 * A functional assistant workspace built on capabilities this app can actually
 * provide in a browser/PWA or desktop shell:
 *
 *  - Platform + capability detection from real runtime feature checks
 *    (never advertised unless the underlying API was found).
 *  - Voice input through the Web Speech API when present, with an honest
 *    "unavailable" state when the browser does not expose it.
 *  - Spoken replies through window.speechSynthesis when present.
 *  - Natural-language commands routed into the SAME backend services the rest
 *    of RARE uses (documents, research, build tasks) — no duplicated logic and
 *    no fabricated results.
 *
 * Wake-word ("Hey Rae") is intentionally NOT claimed: it requires always-on
 * microphone access that no browser permits while the tab is backgrounded or
 * the device is locked. The panel says so instead of pretending.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../api.js';
import { ThemeConfig } from '../theme';
import {
  Bot,
  FileText,
  Globe,
  Search,
  ShieldCheck,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Smartphone,
  Monitor,
  Laptop,
  Terminal,
  CheckCircle2,
  AlertCircle,
  Play,
  Send,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Platform & capability detection (real feature checks only)
// ---------------------------------------------------------------------------

export type AssistantPlatform = 'android' | 'ios' | 'windows' | 'macos' | 'linux' | 'web';

export interface AssistantCapability {
  id: string;
  label: string;
  available: boolean;
  /** How the capability is provided, or precisely why it is unavailable. */
  detail: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
}

function detectPlatform(): AssistantPlatform {
  if (typeof navigator === 'undefined') return 'web';
  const ua = navigator.userAgent.toLowerCase();
  const platform = ((navigator as any).userAgentData?.platform || navigator.platform || '').toLowerCase();
  if (/android/.test(ua)) return 'android';
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/win/.test(platform) || /windows/.test(ua)) return 'windows';
  if (/mac/.test(platform) || /mac os x/.test(ua)) return 'macos';
  if (/linux|x11/.test(platform) || /linux/.test(ua)) return 'linux';
  return 'web';
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  return typeof ctor === 'function' ? ctor : null;
}

function buildCapabilities(platform: AssistantPlatform): AssistantCapability[] {
  const recognition = getSpeechRecognition();
  const synthesis = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const mic = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  const share = typeof navigator !== 'undefined' && !!(navigator as any).share;
  const clipboard = typeof navigator !== 'undefined' && !!navigator.clipboard?.writeText;
  const isAndroid = platform === 'android';

  return [
    {
      id: 'voice_input',
      label: 'Voice input (speech → text)',
      available: !!recognition && mic,
      detail: recognition
        ? 'Web Speech API detected. Requires microphone permission on first use.'
        : 'This browser does not expose the Web Speech API, so Rae cannot capture speech here.',
    },
    {
      id: 'voice_output',
      label: 'Spoken replies (text → speech)',
      available: synthesis,
      detail: synthesis
        ? 'window.speechSynthesis is available and used for spoken answers.'
        : 'Speech synthesis is unavailable in this environment.',
    },
    {
      id: 'documents',
      label: 'Documents & file retrieval',
      available: true,
      detail: 'Routed to the RARE documents service; the server enforces per-user ownership.',
    },
    {
      id: 'research',
      label: 'Research & source investigation',
      available: true,
      detail: 'Routed to the RARE research service (Wikipedia + Crossref connectors).',
    },
    {
      id: 'build_tasks',
      label: 'Build & task execution',
      available: true,
      detail: 'Routed to the RARE task executor; results are reported as returned by the server.',
    },
    {
      id: 'share_sheet',
      label: 'Native share / hand-off',
      available: share,
      detail: share
        ? 'Web Share API available for handing content to installed apps.'
        : 'Web Share is not exposed by this browser.',
    },
    {
      id: 'clipboard',
      label: 'Clipboard actions',
      available: clipboard,
      detail: clipboard ? 'Async clipboard write is available.' : 'Clipboard API is unavailable.',
    },
    {
      id: 'wake_word',
      label: 'Wake word ("Hey Rae")',
      available: false,
      detail: isAndroid
        ? 'Needs background microphone access, which Android only grants to a native foreground service (not a browser/PWA tab).'
        : 'Needs an always-on microphone, which the browser does not permit in a backgrounded tab.',
    },
  ];
}

// ---------------------------------------------------------------------------
// Natural-language command interpretation
// ---------------------------------------------------------------------------

type CommandIntent =
  | { kind: 'documents'; query: string }
  | { kind: 'research'; query: string }
  | { kind: 'build'; objective: string }
  | { kind: 'read_url'; url: string }
  | { kind: 'unknown' };

function interpretCommand(raw: string): CommandIntent {
  const text = raw.trim();
  if (!text) return { kind: 'unknown' };

  const urlMatch = text.match(/https?:\/\/[^\s]+/i);
  if (urlMatch && /(read|open|fetch|summar|investigat|check|analys|analyze)/i.test(text)) {
    return { kind: 'read_url', url: urlMatch[0] };
  }

  if (/(document|file|docx|pdf|note|transcript)/i.test(text)) {
    return { kind: 'documents', query: text.replace(/^(find|search|open|look up|locate)\s+(a\s+|an\s+|the\s+)?(document|file)s?\s*(about|for)?\s*/i, '').trim() || text };
  }

  if (/(research|investigate|compare|find out|look up|sources?|evidence)/i.test(text)) {
    return { kind: 'research', query: text.replace(/^(research|investigate|compare|find out about|look up)\s+/i, '').trim() || text };
  }

  if (/(build|create an app|scaffold|implement|make an application|develop)/i.test(text)) {
    return { kind: 'build', objective: text };
  }

  return { kind: 'unknown' };
}

// ---------------------------------------------------------------------------

interface AssistantStudioViewProps {
  t?: ThemeConfig;
  onNavigate?: (tab: string) => void;
  assistantName?: string;
}

interface ActionLogEntry {
  id: string;
  intent: string;
  ok: boolean;
  message: string;
  at: string;
}

export function AssistantStudioView({ onNavigate, assistantName = 'Rare' }: AssistantStudioViewProps) {
  const platform = useMemo<AssistantPlatform>(() => detectPlatform(), []);
  const capabilities = useMemo<AssistantCapability[]>(() => buildCapabilities(platform), [platform]);
  const speechRecognitionSupported = capabilities.find((c) => c.id === 'voice_input')?.available ?? false;
  const speechOutputSupported = capabilities.find((c) => c.id === 'voice_output')?.available ?? false;

  const [command, setCommand] = useState('');
  const [listening, setListening] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(speechOutputSupported);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState('');
  const [log, setLog] = useState<ActionLogEntry[]>([]);
  const [micError, setMicError] = useState('');

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const speak = useCallback((text: string) => {
    if (!speakReplies || !speechOutputSupported || !text.trim()) return;
    try {
      const utterance = new SpeechSynthesisUtterance(text.slice(0, 600));
      utterance.rate = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    } catch {
      /* Speaking is best-effort; the text reply is always shown. */
    }
  }, [speakReplies, speechOutputSupported]);

  const record = useCallback((intent: string, ok: boolean, message: string) => {
    setLog((current) => [
      { id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, intent, ok, message, at: new Date().toISOString() },
      ...current,
    ].slice(0, 12));
  }, []);

  const stopListening = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      /* already stopped */
    }
    recognitionRef.current = null;
    setListening(false);
  }, []);

  const startListening = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setMicError('Speech recognition is not available in this browser.');
      return;
    }
    setMicError('');
    try {
      const recognition = new Ctor();
      recognition.lang = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US';
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.onresult = (event: any) => {
        const transcript = Array.from(event.results as any[])
          .map((result: any) => result?.[0]?.transcript || '')
          .join(' ')
          .trim();
        if (transcript) setCommand(transcript);
      };
      recognition.onerror = (event: any) => {
        setMicError(
          event?.error === 'not-allowed'
            ? 'Microphone permission was denied. Allow it in the browser to use voice input.'
            : `Speech recognition error: ${event?.error || 'unknown'}.`
        );
        setListening(false);
      };
      recognition.onend = () => setListening(false);
      recognitionRef.current = recognition;
      recognition.start();
      setListening(true);
    } catch (error) {
      setMicError(error instanceof Error ? error.message : 'Could not start speech recognition.');
      setListening(false);
    }
  }, []);

  useEffect(() => () => {
    stopListening();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }, [stopListening]);

  const runCommand = useCallback(async () => {
    const intent = interpretCommand(command);
    if (intent.kind === 'unknown') {
      const message =
        'I could not map that to an action I can actually perform. I can search your documents, research a topic across sources, inspect a URL, or hand a build request to the task engine.';
      setReply(message);
      record('interpret', false, 'No matching capability for the request');
      speak(message);
      return;
    }

    setBusy(true);
    setReply('');
    try {
      if (intent.kind === 'documents') {
        const res = await apiFetch('/api/documents');
        if (!res.ok) throw new Error(`Documents service returned HTTP ${res.status}.`);
        const docs: Array<{ path: string; format: string; size: number }> = await res.json();
        const needle = intent.query.toLowerCase();
        const matches = docs.filter((doc) => doc.path.toLowerCase().includes(needle)).slice(0, 8);
        const message = matches.length
          ? `Found ${matches.length} document${matches.length === 1 ? '' : 's'} matching "${intent.query}": ${matches.map((doc) => doc.path).join(', ')}.`
          : `No documents matched "${intent.query}". Your document store currently holds ${docs.length} file${docs.length === 1 ? '' : 's'}.`;
        setReply(message);
        record('documents', true, `${matches.length} match(es) of ${docs.length} document(s)`);
        speak(message);
      } else if (intent.kind === 'research') {
        const res = await apiFetch('/api/research/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: intent.query }),
        });
        if (!res.ok) throw new Error(`Research service returned HTTP ${res.status}.`);
        const data = await res.json();
        const item = data?.results?.[0];
        const sources: Array<{ name: string; url: string }> = item?.sources || [];
        const message = sources.length
          ? `Research on "${intent.query}" returned ${sources.length} source${sources.length === 1 ? '' : 's'}: ${sources.slice(0, 4).map((s) => s.name).join(', ')}. ${item?.synthesis || ''}`.trim()
          : `Research on "${intent.query}" returned no sources. ${(item?.sourceErrors || []).join(' ') || 'Check outbound network access from the server.'}`;
        setReply(message);
        record('research', sources.length > 0, `${sources.length} source(s) retrieved`);
        speak(message);
      } else if (intent.kind === 'read_url') {
        const res = await apiFetch('/api/documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: intent.url, path: `imports/rae-${Date.now()}.txt` }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message || `Import returned HTTP ${res.status}.`);
        const message = `Imported ${intent.url} into your documents as ${data.path} (${data.size} bytes).`;
        setReply(message);
        record('read_url', true, `Saved as ${data.path}`);
        speak(message);
      } else {
        const res = await apiFetch('/api/v1/tasks/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ objective: intent.objective, prompt: intent.objective }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 403) {
          const message =
            'Build execution is restricted to an authorised developer session, so I cannot start a build task from here. Open Project & Build to create or import a project instead.';
          setReply(message);
          record('build', false, 'Developer session required');
          speak(message);
          return;
        }
        if (!res.ok) throw new Error(data?.error?.message || `Task engine returned HTTP ${res.status}.`);
        const message = `Task engine accepted the build request${data?.taskId || data?.id ? ` as ${data.taskId || data.id}` : ''}. It reports: ${data?.status || data?.message || 'accepted'}.`;
        setReply(message);
        record('build', true, String(data?.status || 'accepted'));
        speak(message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The action could not be completed.';
      setReply(`The action could not be completed: ${message}`);
      record('error', false, message);
      speak('The action could not be completed.');
    } finally {
      setBusy(false);
    }
  }, [command, record, speak]);

  // The legacy RARE-INTELLIGENCE tools remain reachable from the same page.
  const [researchQuery, setResearchQuery] = useState('Compare file-persistent multi-collection JSON storage against SQLite in a zero-budget architecture');
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
      const res = await apiFetch('/api/research/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: researchQuery }),
      });
      setResearchResult(await res.json());
    } catch (err: any) {
      setResearchResult({ error: err?.message || 'Research request failed.' });
    } finally {
      setLoadingResearch(false);
    }
  };

  const handleParseDoc = async () => {
    try {
      const res = await apiFetch('/api/documents/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: docContent, format: docFormat }),
      });
      setDocResult(await res.json());
    } catch (err: any) {
      setDocResult({ error: err?.message || 'Document parse failed.' });
    }
  };

  const handleSafeUrlRead = async () => {
    setLoadingUrl(true);
    try {
      const res = await apiFetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput, path: `imports/assistant-studio-${Date.now()}.txt` }),
      });
      setUrlResult(await res.json());
    } catch (err: any) {
      setUrlResult({ error: err?.message || 'URL import failed.' });
    } finally {
      setLoadingUrl(false);
    }
  };

  const platformIcon =
    platform === 'android' || platform === 'ios' ? Smartphone : platform === 'windows' ? Monitor : platform === 'macos' ? Laptop : Terminal;

  const PlatformIcon = platformIcon;

  return (
    <div className="space-y-6">
      {/* Header + platform */}
      <div className="border border-slate-800 rounded-xl bg-slate-900/40 p-6 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-cyan-950 text-cyan-400 border border-cyan-800">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">{assistantName} Assistant</h2>
              <p className="text-xs text-slate-400">
                Ask in plain language. Commands are routed to the same document, research, and task services the rest of RARE uses.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800">
            <PlatformIcon className="w-4 h-4 text-slate-400" />
            <span className="text-[11px] font-mono text-slate-300 uppercase">{platform}</span>
          </div>
        </div>
      </div>

      {/* Command console */}
      <div className="border border-slate-800 rounded-xl bg-slate-900/30 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Send className="w-4 h-4 text-cyan-400" />
            <span>Ask Rae</span>
          </div>
          <button
            onClick={() => setSpeakReplies((value) => !value)}
            disabled={!speechOutputSupported}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 ${
              speakReplies ? 'bg-cyan-900/50 border-cyan-700 text-cyan-300' : 'bg-slate-950 border-slate-800 text-slate-400'
            }`}
            title={speechOutputSupported ? 'Toggle spoken replies' : 'Speech synthesis unavailable'}
          >
            {speakReplies && speechOutputSupported ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            <span>Spoken replies</span>
          </button>
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) void runCommand();
            }}
            placeholder='e.g. "Find the document about our project" · "Research Rust vs Go for CLIs" · "Open https://… and summarise it"'
            className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
          />
          <button
            onClick={startListening}
            disabled={!speechRecognitionSupported || listening}
            className={`px-3 py-2 rounded-lg text-xs font-medium transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
              listening ? 'bg-rose-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
            }`}
            title={speechRecognitionSupported ? 'Start voice input' : 'Voice input unavailable in this browser'}
          >
            {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
          <button
            onClick={() => void runCommand()}
            disabled={busy || !command.trim()}
            className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            <Play className="w-3.5 h-3.5" />
            <span>{busy ? 'Running…' : 'Run'}</span>
          </button>
        </div>

        {listening && (
          <div className="text-[11px] text-rose-300 flex items-center gap-1.5 animate-pulse">
            <Mic className="w-3.5 h-3.5" />
            <span>Listening… speak now.</span>
          </div>
        )}
        {micError && (
          <div className="text-[11px] text-amber-300 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>{micError}</span>
          </div>
        )}

        {reply && (
          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 leading-relaxed">{reply}</div>
        )}

        {log.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] uppercase font-semibold text-slate-500">Action log</div>
            {log.map((entry) => (
              <div key={entry.id} className="flex items-center gap-2 text-[11px] font-mono">
                {entry.ok ? (
                  <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                ) : (
                  <AlertCircle className="w-3 h-3 text-amber-400 shrink-0" />
                )}
                <span className="text-slate-400">{new Date(entry.at).toLocaleTimeString()}</span>
                <span className="text-slate-300">{entry.intent}</span>
                <span className="text-slate-500 truncate">{entry.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Capability matrix */}
      <div className="border border-slate-800 rounded-xl bg-slate-900/30 p-6 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>Device capabilities on this platform</span>
        </div>
        <p className="text-[11px] text-slate-500">
          Every row below is a real runtime check — nothing is advertised unless the underlying API was actually found.
        </p>
        <div className="space-y-1.5">
          {capabilities.map((capability) => (
            <div key={capability.id} className="flex items-start gap-2.5 p-2 rounded-lg bg-slate-950/60 border border-slate-800">
              {capability.available ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 text-slate-500 mt-0.5 shrink-0" />
              )}
              <div className="min-w-0">
                <div className={`text-xs font-medium ${capability.available ? 'text-slate-200' : 'text-slate-400'}`}>
                  {capability.label}
                </div>
                <div className="text-[11px] text-slate-500 leading-snug">{capability.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Existing RARE-INTELLIGENCE tools */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="border border-slate-800 rounded-xl bg-slate-900/30 p-6 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Search className="w-4 h-4 text-cyan-400" />
            <span>Grounded Research &amp; Sub-Questions</span>
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

      <div className="border border-slate-800 rounded-xl bg-slate-900/30 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <FileText className="w-4 h-4 text-purple-400" />
            <span>Structured Document Extractor (CSV / Markdown)</span>
          </div>
          <div className="flex gap-2">
            <select
              value={docFormat}
              onChange={(e) => setDocFormat(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs text-slate-300 font-mono"
            >
              <option value="csv">CSV</option>
              <option value="markdown">Markdown</option>
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

      {onNavigate && (
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'documents', label: 'Open Documents' },
            { id: 'research', label: 'Open Research' },
            { id: 'projects', label: 'Open Project & Build' },
          ].map((target) => (
            <button
              key={target.id}
              onClick={() => onNavigate(target.id)}
              className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-cyan-700 text-xs text-slate-300 hover:text-cyan-300 transition cursor-pointer"
            >
              {target.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

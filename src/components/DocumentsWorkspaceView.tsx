/**
 * RARE — Documents Workspace
 *
 * Backed entirely by the existing server routes:
 *   GET  /api/documents            list owned documents
 *   GET  /api/documents/*          read one owned document
 *   POST /api/documents            save text, or import a public URL
 *   POST /api/documents/convert    convert to txt/md/json/html
 *   POST /api/documents/transcribe real audio → transcript document
 *
 * Every request carries the session cookie + CSRF header through apiFetch, and
 * the server enforces per-user ownership, so this view never widens access.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../api.js';
import { ThemeConfig } from '../theme';
import {
  FileText,
  Upload,
  Link2,
  Save,
  Download,
  Trash2,
  Search,
  FileAudio,
  Loader2,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Repeat,
} from 'lucide-react';

interface DocumentSummary {
  path: string;
  size: number;
  format: string;
  updated_at?: string;
  kind?: string;
  label?: string;
  title?: string;
  sourceUrl?: string;
  ocr?: boolean;
  origin?: string;
  version?: number;
}

interface DocumentHistoryEntry {
  content: string;
  updatedAt: string;
  version: number;
}

interface DocumentRecord extends DocumentSummary {
  content: string;
  updatedAt?: string;
  finalUrl?: string;
  method?: string;
  warnings?: string[];
  derivedFrom?: string;
  history?: DocumentHistoryEntry[];
}

interface SearchHit {
  documentId: string;
  title: string;
  origin?: string;
  sourceUrl?: string;
  chunkIndex: number;
  page?: number;
  section?: string;
  snippet: string;
  score: number;
  matchedBy: 'phrase' | 'terms' | 'both';
}

interface CapabilityReport {
  runtime?: string;
  extractors?: Array<{ format: string; available: boolean; method?: string; note?: string }>;
  transcription?: { available: boolean; provider?: string; note?: string };
  browserRendering?: { available: boolean; note?: string };
}

interface DocumentsWorkspaceViewProps {
  t: ThemeConfig;
  onNavigate?: (tab: string) => void;
}

const MAX_INLINE_BYTES = 2 * 1024 * 1024;
const ACCEPTED_AUDIO = 'audio/webm,audio/ogg,audio/wav,audio/mpeg,audio/mp3,audio/aac,audio/flac';
const EDITABLE_EXTENSIONS = ['.md', '.txt', '.text', '.json', '.html', '.htm', '.csv', '.xml', '.yaml', '.yml', '.log'];

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function isEditable(path: string): boolean {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? false : EDITABLE_EXTENSIONS.includes(path.slice(dot).toLowerCase());
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const data = await response.json();
    return String(data?.error?.message || data?.message || `HTTP ${response.status}`);
  } catch {
    return `HTTP ${response.status}`;
  }
}

export function DocumentsWorkspaceView({ t, onNavigate }: DocumentsWorkspaceViewProps) {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [activePath, setActivePath] = useState('');
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [importUrl, setImportUrl] = useState('');
  const [transcriptBusy, setTranscriptBusy] = useState(false);
  const [transcriptNote, setTranscriptNote] = useState('');

  // Server-side search (indexed content, not just path matching).
  const [searchHits, setSearchHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchIndexed, setSearchIndexed] = useState<number | null>(null);

  // Rename / delete.
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Version history for the open document.
  const [history, setHistory] = useState<DocumentHistoryEntry[]>([]);
  const [currentVersion, setCurrentVersion] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  // What this deployment can actually read.
  const [capabilities, setCapabilities] = useState<CapabilityReport | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dirty = content !== originalContent;

  const loadList = useCallback(async () => {
    setLoadingList(true);
    try {
      const response = await apiFetch('/api/documents');
      if (!response.ok) throw new Error(await readErrorMessage(response));
      const data = (await response.json()) as DocumentSummary[];
      setDocuments(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not list documents.');
    } finally {
      setLoadingList(false);
    }
  }, []);

  const openDocument = useCallback(async (path: string) => {
    setLoadingDoc(true);
    setError('');
    try {
      // encodeURI leaves '#' and '?' raw, which would truncate the request path.
      const response = await apiFetch(`/api/documents/${encodeURIComponent(path)}`);
      if (!response.ok) throw new Error(await readErrorMessage(response));
      const data = (await response.json()) as DocumentRecord;
      setActivePath(data.path || path);
      setContent(String(data.content ?? ''));
      setOriginalContent(String(data.content ?? ''));
      setHistory(Array.isArray(data.history) ? data.history : []);
      setCurrentVersion(typeof data.version === 'number' ? data.version : null);
      setShowHistory(false);
      setConfirmDelete(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the document.');
    } finally {
      setLoadingDoc(false);
    }
  }, []);

  const loadCapabilities = useCallback(async () => {
    try {
      const response = await apiFetch('/api/documents/capabilities');
      if (!response.ok) return;
      setCapabilities((await response.json()) as CapabilityReport);
    } catch {
      // Capability display is informational only; never block the workspace on it.
    }
  }, []);

  // Debounced server-side search over indexed document content.
  const runSearch = useCallback((term: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const trimmed = term.trim();
    if (!trimmed) {
      setSearchHits(null);
      setSearchIndexed(null);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const response = await apiFetch(`/api/search?q=${encodeURIComponent(trimmed)}&limit=25`);
        if (!response.ok) throw new Error(await readErrorMessage(response));
        const data = (await response.json()) as { hits: SearchHit[]; indexedDocuments: number };
        setSearchHits(Array.isArray(data.hits) ? data.hits : []);
        setSearchIndexed(typeof data.indexedDocuments === 'number' ? data.indexedDocuments : null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Search failed.');
        setSearchHits([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, []);

  const renameDocument = async () => {
    if (!activePath) return;
    const target = renameValue.trim();
    if (!target || target === activePath) {
      setRenaming(false);
      return;
    }
    setBusy('rename');
    setError('');
    setNotice('');
    try {
      const response = await apiFetch('/api/documents/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: activePath, newPath: target }),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      setRenaming(false);
      await loadList();
      await openDocument(target);
      setNotice(`Renamed to ${target}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rename failed.');
    } finally {
      setBusy('');
    }
  };

  const deleteDocument = async () => {
    if (!activePath) return;
    setBusy('delete');
    setError('');
    setNotice('');
    try {
      const response = await apiFetch(`/api/documents/${encodeURIComponent(activePath)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      const removedPath = activePath;
      setConfirmDelete(false);
      setActivePath('');
      setContent('');
      setOriginalContent('');
      setHistory([]);
      setCurrentVersion(null);
      await loadList();
      setNotice(`Deleted ${removedPath}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.');
    } finally {
      setBusy('');
    }
  };

  const restoreVersion = async (version: number) => {
    if (!activePath) return;
    setBusy('restore');
    setError('');
    setNotice('');
    try {
      const response = await apiFetch('/api/documents/restore-version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: activePath, version }),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      const data = (await response.json()) as { version: number };
      await openDocument(activePath);
      await loadList();
      setNotice(`Restored version ${version} as the current revision ${data.version}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed.');
    } finally {
      setBusy('');
    }
  };

  useEffect(() => {
    void loadList();
    void loadCapabilities();
  }, [loadList, loadCapabilities]);

  // Auto-open the first document once the list arrives.
  useEffect(() => {
    if (documents.length === 0) return;
    if (activePath && documents.some((document) => document.path === activePath)) return;
    void openDocument(documents[0].path);
  }, [documents, activePath, openDocument]);

  const filtered = useMemo(
    () =>
      documents.filter((document) =>
        searchTerm.trim() ? document.path.toLowerCase().includes(searchTerm.trim().toLowerCase()) : true
      ),
    [documents, searchTerm]
  );

  const totalBytes = useMemo(
    () => documents.reduce((sum, document) => sum + (document.size || 0), 0),
    [documents]
  );

  const saveDocument = async () => {
    if (!activePath) {
      setError('Choose or create a document first.');
      return;
    }
    if (!isEditable(activePath)) {
      setError(`.${activePath.split('.').pop()} cannot be saved as editable text here. Use Convert to produce a text format.`);
      return;
    }
    setBusy('save');
    setError('');
    setNotice('');
    try {
      const response = await apiFetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: activePath, text: content }),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      setOriginalContent(content);
      setNotice('Saved.');
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setBusy('');
    }
  };

  const createDocument = async () => {
    const requested = window.prompt('New document path (inside your document space):', 'notes/new-document.md');
    if (!requested) return;
    setBusy('create');
    setError('');
    setNotice('');
    try {
      const response = await apiFetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: requested, text: '' }),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      const created = await response.json();
      setActivePath(created.path);
      setContent('');
      setOriginalContent('');
      setNotice(`Created ${created.path}.`);
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the document.');
    } finally {
      setBusy('');
    }
  };

  const importFromUrl = async () => {
    if (!importUrl.trim()) return;
    setBusy('import');
    setError('');
    setNotice('');
    try {
      // The server sniffs the real content type and picks the extractor, so no
      // extension is forced here.
      const response = await apiFetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: importUrl.trim() }),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      const imported = await response.json();
      setImportUrl('');
      const detail = [
        imported.label || imported.kind,
        imported.method ? `via ${imported.method}` : '',
        imported.pages ? `${imported.pages} page(s)` : '',
        imported.ocr ? 'OCR' : '',
      ].filter(Boolean).join(' · ');
      setNotice(`Imported ${imported.path}${detail ? ` (${detail})` : ''}.`);
      if (Array.isArray(imported.warnings) && imported.warnings.length > 0) {
        setError(imported.warnings.join(' · '));
      }
      await loadList();
      await openDocument(imported.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'URL import failed.');
    } finally {
      setBusy('');
    }
  };

  const importManyUrls = async () => {
    const urls = importUrl
      .split(/[\n,]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (urls.length < 2) {
      setError('Paste two or more URLs (one per line) to import them together.');
      return;
    }
    setBusy('import-many');
    setError('');
    setNotice('');
    try {
      const response = await apiFetch('/api/documents/import-many', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls, limit: 8 }),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      const outcome = await response.json();
      const failures = (outcome.results || [])
        .filter((item: any) => !item.ok)
        .map((item: any) => `${item.sourceUrl || 'source'}: ${item.error?.message || 'failed'}`);
      setNotice(`Imported ${outcome.succeeded} of ${outcome.visited.length} source(s).`);
      if (failures.length > 0) setError(failures.join(' · '));
      setImportUrl('');
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Batch import failed.');
    } finally {
      setBusy('');
    }
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy('upload');
    setError('');
    setNotice('');
    const failures: string[] = [];
    let saved = 0;
    for (const file of Array.from(files)) {
      try {
        if (file.size > 25 * 1024 * 1024) {
          failures.push(`${file.name}: exceeds the 25 MB upload limit.`);
          continue;
        }
        // Send the raw bytes: the server sniffs the real format and picks the
        // right extractor, so any supported format works here.
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = String(reader.result || '');
            const comma = result.indexOf(',');
            resolve(comma === -1 ? result : result.slice(comma + 1));
          };
          reader.onerror = () => reject(new Error('Could not read the file.'));
          reader.readAsDataURL(file);
        });
        const response = await apiFetch('/api/documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileBase64: base64, filename: file.name, mimeType: file.type }),
        });
        if (!response.ok) throw new Error(await readErrorMessage(response));
        saved += 1;
      } catch (err) {
        failures.push(`${file.name}: ${err instanceof Error ? err.message : 'upload failed'}`);
      }
    }
    if (saved > 0) setNotice(`Imported ${saved} file${saved === 1 ? '' : 's'}.`);
    if (failures.length > 0) setError(failures.join(' · '));
    await loadList();
    setBusy('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const transcribeAudio = async (file: File) => {
    setTranscriptBusy(true);
    setTranscriptNote('');
    setError('');
    try {
      if (file.size > 14 * 1024 * 1024) throw new Error('Audio must be 14 MB or smaller.');
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || '');
          const comma = result.indexOf(',');
          resolve(comma === -1 ? result : result.slice(comma + 1));
        };
        reader.onerror = () => reject(new Error('Could not read the audio file.'));
        reader.readAsDataURL(file);
      });
      const response = await apiFetch('/api/documents/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioBase64: base64,
          mimeType: file.type || 'audio/webm',
          audioName: file.name,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(data?.error?.message || `HTTP ${response.status}`));
      setTranscriptNote(
        `Transcript saved as ${data.path} using ${data.transcriptionModel || 'the configured model'}` +
          (data.uncertaintyCount ? ` · ${data.uncertaintyCount} passage(s) flagged as unclear.` : '.')
      );
      await loadList();
      await openDocument(data.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transcription failed.');
    } finally {
      setTranscriptBusy(false);
      if (audioInputRef.current) audioInputRef.current.value = '';
    }
  };

  const convertDocument = async (targetFormat: string) => {
    if (!activePath) return;
    setBusy('convert');
    setError('');
    setNotice('');
    try {
      const response = await apiFetch('/api/documents/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: activePath, targetFormat }),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      const converted = await response.json();
      setNotice(`Converted to ${converted.convertedPath}.`);
      await loadList();
      await openDocument(converted.convertedPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Conversion failed.');
    } finally {
      setBusy('');
    }
  };

  const downloadDocument = () => {
    if (!activePath) return;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = activePath.split('/').pop() || 'document.txt';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const activeSummary = documents.find((document) => document.path === activePath);

  return (
    <div className={`h-[calc(100vh-8rem)] flex rounded-xl border ${t.cardBorder} overflow-hidden ${t.card}`}>
      {/* Sidebar */}
      <div className={`w-72 border-r ${t.cardBorder} ${t.cardSub} flex flex-col p-3 shrink-0 space-y-3`}>
        <div className="flex items-center justify-between">
          <div className={`text-[10px] font-mono uppercase tracking-wider ${t.textDim}`}>
            {documents.length} doc · {formatBytes(totalBytes)}
          </div>
          <button
            onClick={() => void loadList()}
            className={`p-1 rounded ${t.textMuted} hover:opacity-80`}
            title="Refresh document list"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingList ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="relative">
          <Search className={`w-3.5 h-3.5 absolute left-2.5 top-2.5 ${t.textDim}`} />
          <input
            type="text"
            value={searchTerm}
            onChange={(event) => {
              setSearchTerm(event.target.value);
              runSearch(event.target.value);
            }}
            placeholder="Search inside documents..."
            className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none`}
          />
          {searching && (
            <Loader2 className={`w-3 h-3 absolute right-2.5 top-2.5 animate-spin ${t.textDim}`} />
          )}
        </div>

        <div className="grid grid-cols-2 gap-1">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={busy === 'upload'}
            className={`p-1.5 rounded-lg ${t.cardSub} border ${t.cardBorder} text-[10px] font-medium flex items-center justify-center gap-1 disabled:opacity-40`}
            title="Upload text documents from this device"
          >
            <Upload className="w-3 h-3" />
            <span>Upload</span>
          </button>
          <button
            onClick={createDocument}
            disabled={busy === 'create'}
            className={`p-1.5 rounded-lg ${t.cardSub} border ${t.cardBorder} text-[10px] font-medium flex items-center justify-center gap-1 disabled:opacity-40`}
            title="Create a new empty document"
          >
            <FileText className="w-3 h-3" />
            <span>New</span>
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="*/*"
          className="hidden"
          onChange={(event) => void uploadFiles(event.target.files)}
        />

        {/* URL import */}
        <div className="space-y-1.5 p-2 rounded-xl border border-white/5 bg-black/20">
          <div className={`text-[10px] font-bold ${t.textPrimary} flex items-center gap-1.5`}>
            <Link2 className="w-3 h-3 text-indigo-400" />
            <span>Import from URL</span>
          </div>
          <input
            type="text"
            value={importUrl}
            onChange={(event) => setImportUrl(event.target.value)}
            placeholder="https://example.com/report.pdf"
            className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-lg px-2 py-1 text-[10px] focus:outline-none`}
          />
          <button
            onClick={() => void importFromUrl()}
            disabled={busy === 'import' || !importUrl.trim()}
            className={`w-full py-1 rounded-lg ${t.accentBg} text-white text-[10px] font-semibold disabled:opacity-40`}
          >
            {busy === 'import' ? 'Fetching…' : 'Fetch public page'}
          </button>
          <button
            onClick={() => void importManyUrls()}
            disabled={busy === 'import-many' || importUrl.split(/[\n,]+/).filter((value) => value.trim()).length < 2}
            className={`w-full py-1 rounded-lg ${t.cardSub} border ${t.cardBorder} text-[10px] font-medium disabled:opacity-40`}
          >
            {busy === 'import-many' ? 'Importing…' : 'Import all (one URL per line)'}
          </button>
          <p className={`text-[9px] ${t.textDim} leading-tight`}>
            HTTPS only, public pages only — private and local addresses are refused by the server. PDFs, articles, docs and media pages are detected from their real content.
          </p>
        </div>

        {/* Transcription */}
        <div className="space-y-1.5 p-2 rounded-xl border border-white/5 bg-black/20">
          <div className={`text-[10px] font-bold ${t.textPrimary} flex items-center gap-1.5`}>
            <FileAudio className="w-3 h-3 text-emerald-400" />
            <span>Transcribe audio</span>
          </div>
          <button
            onClick={() => audioInputRef.current?.click()}
            disabled={transcriptBusy}
            className={`w-full py-1.5 rounded-lg ${t.cardSub} border ${t.cardBorder} text-[10px] font-medium flex items-center justify-center gap-1.5 disabled:opacity-40`}
          >
            {transcriptBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileAudio className="w-3 h-3" />}
            <span>{transcriptBusy ? 'Transcribing…' : 'Choose audio file'}</span>
          </button>
          <input
            ref={audioInputRef}
            type="file"
            accept={ACCEPTED_AUDIO}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void transcribeAudio(file);
            }}
          />
          <p className={`text-[9px] ${t.textDim} leading-tight`}>
            Real audio in, real transcript out. Requires GEMINI_API_KEY on the server — if it is absent the server
            returns that error instead of inventing a transcript.
          </p>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto space-y-0.5 min-h-0">
          {loadingList && documents.length === 0 && (
            <div className={`text-[10px] ${t.textDim} px-1`}>Loading…</div>
          )}

          {/* Server-side search results take over the list while a query is active. */}
          {searchHits !== null ? (
            <>
              <div className={`text-[9px] font-mono ${t.textDim} px-1 pb-1`}>
                {searchHits.length} passage(s)
                {searchIndexed !== null ? ` · ${searchIndexed} indexed` : ''}
              </div>
              {searchHits.length === 0 && !searching && (
                <div className={`text-[10px] ${t.textDim} px-1 py-2`}>
                  No passage matched. Search covers indexed document text, not just filenames.
                </div>
              )}
              {searchHits.map((hit, index) => (
                <button
                  key={`${hit.documentId}-${hit.chunkIndex}-${index}`}
                  onClick={() => void openDocument(hit.documentId)}
                  className={`w-full text-left p-1.5 rounded-lg text-[10px] space-y-0.5 transition ${
                    activePath === hit.documentId ? `${t.card} border ${t.cardBorder}` : `${t.textMuted} hover:opacity-80`
                  }`}
                  title={hit.documentId}
                >
                  <div className="flex items-center gap-1.5">
                    <FileText className={`w-3 h-3 ${t.accentText} shrink-0`} />
                    <span className="truncate flex-1 font-semibold">{hit.documentId}</span>
                    {typeof hit.page === 'number' && (
                      <span className={`text-[9px] font-mono ${t.textDim} shrink-0`}>p.{hit.page}</span>
                    )}
                  </div>
                  <p className={`${t.textDim} line-clamp-2 leading-tight`}>{hit.snippet}</p>
                </button>
              ))}
            </>
          ) : (
            <>
              {!loadingList && filtered.length === 0 && (
                <div className={`text-[10px] ${t.textDim} px-1 py-2`}>
                  {documents.length === 0 ? 'No documents yet — upload one or import a URL.' : 'No matches.'}
                </div>
              )}
              {filtered.map((document) => (
                <button
                  key={document.path}
                  onClick={() => void openDocument(document.path)}
                  className={`w-full text-left p-1.5 rounded-lg text-[11px] flex items-center gap-2 transition ${
                    activePath === document.path
                      ? `${t.card} font-bold border ${t.cardBorder}`
                      : `${t.textMuted} hover:opacity-80`
                  }`}
                  title={`${document.path} · ${formatBytes(document.size)}`}
                >
                  <FileText className={`w-3 h-3 ${t.accentText} shrink-0`} />
                  <span className="truncate flex-1">{document.path}</span>
                  <span className={`text-[9px] font-mono ${t.textDim} shrink-0`}>{formatBytes(document.size)}</span>
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className={`h-12 border-b ${t.cardBorder} px-4 flex items-center justify-between ${t.cardSub} gap-2`}>
          <div className="flex items-center gap-2 min-w-0">
            {renaming ? (
              <input
                autoFocus
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void renameDocument();
                  if (event.key === 'Escape') setRenaming(false);
                }}
                className={`text-xs font-mono ${t.inputBg} border ${t.inputBorder} rounded px-1.5 py-0.5 focus:outline-none min-w-0 flex-1`}
              />
            ) : (
              <span className={`text-xs font-mono font-bold truncate ${t.textPrimary}`}>
                {activePath || 'No document selected'}
              </span>
            )}
            {dirty && <span className="text-[9px] font-mono text-amber-400 shrink-0">unsaved</span>}
            {activeSummary && (
              <span className={`text-[9px] font-mono ${t.textDim} shrink-0`}>{formatBytes(activeSummary.size)}</span>
            )}
            {currentVersion !== null && currentVersion > 1 && (
              <span className={`text-[9px] font-mono ${t.textDim} shrink-0`}>v{currentVersion}</span>
            )}
            {activeSummary?.ocr && (
              <span className="text-[9px] font-mono text-amber-400 shrink-0" title="Text recovered by OCR, not an embedded text layer">
                OCR
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {renaming ? (
              <>
                <button
                  onClick={() => void renameDocument()}
                  disabled={busy === 'rename'}
                  className={`px-2 py-1 rounded-lg ${t.accentBg} text-white text-[10px] font-medium disabled:opacity-40`}
                >
                  {busy === 'rename' ? 'Renaming…' : 'Save name'}
                </button>
                <button
                  onClick={() => setRenaming(false)}
                  className={`px-2 py-1 rounded-lg ${t.cardSub} border ${t.cardBorder} text-[10px]`}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => {
                    setRenameValue(activePath);
                    setRenaming(true);
                  }}
                  disabled={!activePath}
                  className={`px-2 py-1 rounded-lg ${t.cardSub} border ${t.cardBorder} text-[10px] font-medium disabled:opacity-40`}
                  title="Rename this document"
                >
                  Rename
                </button>
                <button
                  onClick={() => setShowHistory((value) => !value)}
                  disabled={!activePath || history.length === 0}
                  className={`px-2 py-1 rounded-lg ${t.cardSub} border ${t.cardBorder} text-[10px] font-medium disabled:opacity-40`}
                  title={history.length === 0 ? 'No earlier revisions retained' : `${history.length} earlier revision(s)`}
                >
                  History{history.length > 0 ? ` (${history.length})` : ''}
                </button>
              </>
            )}
            <button
              onClick={saveDocument}
              disabled={!activePath || !dirty || busy === 'save'}
              className={`px-2.5 py-1 rounded-lg ${t.accentBg} text-white text-[10px] font-medium flex items-center gap-1 disabled:opacity-40`}
              title="Save changes"
            >
              <Save className="w-3 h-3" />
              <span>{busy === 'save' ? 'Saving…' : 'Save'}</span>
            </button>
            <button
              onClick={downloadDocument}
              disabled={!activePath}
              className={`px-2.5 py-1 rounded-lg ${t.cardSub} border ${t.cardBorder} text-[10px] font-medium flex items-center gap-1 disabled:opacity-40`}
              title="Download to this device"
            >
              <Download className="w-3 h-3" />
              <span>Download</span>
            </button>
            <div className="relative">
              <select
                onChange={(event) => {
                  const target = event.target.value;
                  event.currentTarget.value = '';
                  if (target) void convertDocument(target);
                }}
                disabled={!activePath || busy === 'convert'}
                defaultValue=""
                className={`px-2 py-1 rounded-lg ${t.cardSub} border ${t.cardBorder} text-[10px] font-medium disabled:opacity-40`}
                title="Convert to another text format"
              >
                <option value="">Convert…</option>
                <option value="txt">to .txt</option>
                <option value="md">to .md</option>
                <option value="json">to .json</option>
                <option value="html">to .html</option>
              </select>
            </div>
            {confirmDelete ? (
              <>
                <span className="text-[10px] text-amber-300">Delete permanently?</span>
                <button
                  onClick={() => void deleteDocument()}
                  disabled={busy === 'delete'}
                  className="px-2 py-1 rounded-lg bg-red-600 text-white text-[10px] font-medium disabled:opacity-40"
                >
                  {busy === 'delete' ? 'Deleting…' : 'Yes, delete'}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className={`px-2 py-1 rounded-lg ${t.cardSub} border ${t.cardBorder} text-[10px]`}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                disabled={!activePath}
                className={`p-1 rounded ${t.textMuted} hover:text-red-400 disabled:opacity-40`}
                title="Delete this document"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Version history */}
        {showHistory && history.length > 0 && (
          <div className={`border-b ${t.cardBorder} ${t.cardSub} px-4 py-2 space-y-1 max-h-40 overflow-y-auto`}>
            <div className={`text-[10px] uppercase font-semibold ${t.textDim}`}>
              Earlier revisions — restoring keeps the current text as a new revision
            </div>
            {history.map((entry) => (
              <div key={entry.version} className="flex items-center justify-between gap-2 text-[10px]">
                <span className={`font-mono ${t.textMuted}`}>
                  v{entry.version} · {new Date(entry.updatedAt).toLocaleString()} · {formatBytes(entry.content.length)}
                </span>
                <button
                  onClick={() => void restoreVersion(entry.version)}
                  disabled={busy === 'restore'}
                  className={`px-2 py-0.5 rounded ${t.accentBg} text-white font-medium disabled:opacity-40`}
                >
                  {busy === 'restore' ? 'Restoring…' : 'Restore'}
                </button>
              </div>
            ))}
          </div>
        )}

        {(error || notice || transcriptNote) && (
          <div className="px-4 py-2 space-y-1 border-b border-white/5">
            {error && (
              <div className="text-[11px] text-amber-300 flex items-start gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            {notice && (
              <div className="text-[11px] text-emerald-300 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>{notice}</span>
              </div>
            )}
            {transcriptNote && (
              <div className="text-[11px] text-emerald-300 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>{transcriptNote}</span>
              </div>
            )}
          </div>
        )}

        {loadingDoc ? (
          <div className={`flex-1 flex items-center justify-center text-xs ${t.textMuted} gap-2`}>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Opening document…</span>
          </div>
        ) : activePath && !isEditable(activePath) ? (
          <div className={`flex-1 p-6 overflow-auto text-xs font-mono whitespace-pre-wrap ${t.textPrimary}`}>
            <div className={`mb-3 text-[11px] ${t.textMuted} flex items-center gap-1.5`}>
              <Repeat className="w-3.5 h-3.5" />
              <span>Read-only view — convert this file to edit it as text.</span>
            </div>
            {content}
          </div>
        ) : (
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={
              activePath
                ? 'Start writing…'
                : 'Select a document on the left, or upload / import one to begin.'
            }
            disabled={!activePath}
            className={`flex-1 bg-transparent p-6 font-mono text-xs leading-relaxed focus:outline-none resize-none ${t.textPrimary} disabled:opacity-60`}
            spellCheck={false}
          />
        )}

        <div className={`h-8 px-4 border-t ${t.cardBorder} flex items-center justify-between text-[10px] ${t.textDim} font-mono`}>
          <span>{content.length} chars · {content.split(/\r?\n/).length} lines</span>
          {onNavigate && (
            <button onClick={() => onNavigate('research')} className="hover:underline">
              Send to Research →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

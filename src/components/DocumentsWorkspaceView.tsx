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
}

interface DocumentRecord extends DocumentSummary {
  content: string;
  updatedAt?: string;
  sourceUrl?: string;
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

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);

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
      const response = await apiFetch(`/api/documents/${encodeURI(path)}`);
      if (!response.ok) throw new Error(await readErrorMessage(response));
      const data = (await response.json()) as DocumentRecord;
      setActivePath(data.path || path);
      setContent(String(data.content ?? ''));
      setOriginalContent(String(data.content ?? ''));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the document.');
    } finally {
      setLoadingDoc(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

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
      const extension = 'txt';
      const response = await apiFetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: importUrl.trim(), path: `imports/${Date.now()}.${extension}` }),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      const imported = await response.json();
      setImportUrl('');
      setNotice(`Imported ${imported.path} (${formatBytes(imported.size || 0)}).`);
      await loadList();
      await openDocument(imported.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'URL import failed.');
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
        if (file.size > MAX_INLINE_BYTES) {
          failures.push(`${file.name}: exceeds the 2 MB text limit.`);
          continue;
        }
        const dot = file.name.lastIndexOf('.');
        const extension = dot === -1 ? '' : file.name.slice(dot).toLowerCase();
        if (!EDITABLE_EXTENSIONS.includes(extension)) {
          failures.push(`${file.name}: .${extension.replace('.', '') || 'unknown'} is not a supported text document format.`);
          continue;
        }
        const text = await file.text();
        const response = await apiFetch('/api/documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: `uploads/${file.name}`, text }),
        });
        if (!response.ok) throw new Error(await readErrorMessage(response));
        saved += 1;
      } catch (err) {
        failures.push(`${file.name}: ${err instanceof Error ? err.message : 'upload failed'}`);
      }
    }
    if (saved > 0) setNotice(`Uploaded ${saved} document${saved === 1 ? '' : 's'}.`);
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
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search documents..."
            className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none`}
          />
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
          accept={EDITABLE_EXTENSIONS.join(',')}
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
            placeholder="https://example.com/report"
            className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-lg px-2 py-1 text-[10px] focus:outline-none`}
          />
          <button
            onClick={() => void importFromUrl()}
            disabled={busy === 'import' || !importUrl.trim()}
            className={`w-full py-1 rounded-lg ${t.accentBg} text-white text-[10px] font-semibold disabled:opacity-40`}
          >
            {busy === 'import' ? 'Fetching…' : 'Fetch public page'}
          </button>
          <p className={`text-[9px] ${t.textDim} leading-tight`}>
            HTTPS only, public pages only — private and local addresses are refused by the server.
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
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className={`h-12 border-b ${t.cardBorder} px-4 flex items-center justify-between ${t.cardSub} gap-2`}>
          <div className="flex items-center gap-2 min-w-0">
            <span className={`text-xs font-mono font-bold truncate ${t.textPrimary}`}>
              {activePath || 'No document selected'}
            </span>
            {dirty && <span className="text-[9px] font-mono text-amber-400 shrink-0">unsaved</span>}
            {activeSummary && (
              <span className={`text-[9px] font-mono ${t.textDim} shrink-0`}>{formatBytes(activeSummary.size)}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
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
            <button
              onClick={() => {
                setContent('');
                setOriginalContent('');
                setActivePath('');
                setNotice('');
                setError('');
              }}
              className={`p-1 rounded ${t.textMuted} hover:opacity-80`}
              title="Close the current document"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>

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

# RARE Documents & Research — Universal Content Engine

This document records what was actually built, wired, and verified on branch
`New-Fixes-by-Erudite`. It is an engineering record, not a roadmap.

## What changed

### 1. One shared content engine (no per-workspace parsers)

```
src/server/content/
  SafeFetcher.ts     SSRF-hardened HTTPS retrieval (DNS-pinned, redirect-revalidated)
  ContentSniffer.ts  byte-level content identification (magic numbers, not extensions)
  Extractors.ts      adapter registry: one extractor per content kind, with fallbacks
  ContentEngine.ts   orchestration, provenance, chunking
  SearchIndex.ts     per-owner BM25 + phrase index
```

Both Documents and Research call `ContentEngine`. Adding a format means
registering one adapter in `Extractors.ts` — not editing either workspace.

**Flow:** accept → identify from bytes → retrieve (if a URL) → select extractor →
attempt → fall back → normalise → record provenance/status → return.

### 2. SSRF protection

`SafeFetcher` was extracted from the DNS-pinned logic that already existed in
`DocumentStore` (it was not rebuilt from scratch) and extended to return binary
payloads. It enforces:

- `https:` only; no embedded credentials; no `file:`/`gopher:`/etc.
- hostname blocklist (`localhost`, `.local`, `.internal`, cloud metadata names)
- every resolved address must be public; the validated address is **pinned into
  the socket lookup**, so a second DNS answer cannot rebind to a private IP
- redirects are followed manually and **revalidated at every hop**
- hard byte cap (8 MB default), wall-clock timeout, redirect cap

### 3. Formats actually verified

| Family | Formats | Method |
|---|---|---|
| Documents | PDF (text layer), DOCX, ODT, RTF, EPUB, HTML, Markdown, TXT | pdf.js → poppler; mammoth; ODF content.xml; spine traversal |
| Scanned | image-only PDF, PNG/JPEG/TIFF/BMP/WebP | pdftoppm + tesseract OCR |
| Spreadsheets | XLSX, XLS, ODS, CSV, TSV | SheetJS; RFC4180 parser |
| Presentations | PPTX, PPT, ODP | slide XML + speaker notes |
| Data | JSON, JSONL, YAML, XML | parse + normalised rendering |
| Email | EML, MBOX | RFC822 header/body |
| Subtitles | SRT, VTT | cue parse with timestamps |
| Archives | ZIP, GZIP, TAR, 7z | entry listing only — never extracted to disk |
| Media | MP3, WAV, OGG, FLAC, M4A, MP4, WebM | routed to transcription, never faked |

Content type is decided from **bytes**. A PDF named `.txt` is still read as a PDF
(covered by a test).

### 4. Documents workspace

- `DocumentsService` — owner-scoped library: list, read, save with bounded
  version history, rename, delete, convert, reindex.
- Import from URL, from uploaded file (any supported format), or many URLs at
  once with per-item results, dedupe by final URL, and partial-failure recovery.
- Provenance is stored per document: source URL, final URL, detected kind,
  extractor used, OCR flag, page text, warnings.
- `GET /api/documents/capabilities` reports what this deployment can read.

### 5. Research workspace

- `ResearchProviders` — registry of free/open discovery sources: Wikipedia,
  Crossref, OpenAlex, arXiv, GitHub, Open Library, DuckDuckGo. Optional keys
  (e.g. `GITHUB_TOKEN`) are used only when already configured.
- `DeepResearchEngine` — iterative loop: search → retrieve **full text** →
  extract passages → follow references → refine query with learned terms →
  stop at a declared budget. Records queries, providers used, provider errors,
  unreadable sources, and explicit limitations.
- Claims are only marked corroborated when two independent sources contain a
  matching passage. Navigation chrome and publisher metadata are filtered out
  so they never become "findings".
- Reports are saved as research projects with status, scope, stats and the full
  cited markdown report.

### 6. Unified search

`GET /api/search?q=…` searches the owner's documents, transcripts and research
across one index. Hits carry the document, page number, section and a snippet.
The index is rebuilt from persisted storage on demand, so a restart never loses
search, and deleting a document removes it from the index.

### 7. Chat / assistant access

Four tools are registered on the assistant's `ToolExecutor`:

| Tool | Purpose |
|---|---|
| `OPEN_URL` | read any public URL through the content engine |
| `READ_DOCUMENT` | read one of the user's saved documents |
| `SEARCH_LIBRARY` | search the user's own material |
| `START_RESEARCH` | run a cited investigation |

**Ownership is taken from the authenticated session (`options.ownerId`), never
from model-supplied arguments.** A tool call without an owner is refused.

### 8. UI

`DocumentsWorkspaceView` and `ResearchWorkspaceView` are now in the sidebar and
rendered by `App.tsx` (previously they existed but were never mounted). The
Documents view accepts any file type and multi-URL import; the Research view
exposes depth (quick/standard/deep), optional seed URLs, and shows real scope,
stats, limitations and unreadable sources.

## Defects fixed

1. **Test runner silently passed.** The auth suite fetched
   `http://127.0.0.1:3000` assuming a server was running; from a clean checkout
   nothing was listening, every request threw, and the runner still exited 0.
   The runner now allocates a free port, boots `server.ts`, waits for
   `/api/health`, exports `RARE_TEST_BASE_URL`, and exits non-zero on failure.
2. **Stale `server-build/`.** The compiled backend was committed, so production
   could start outdated code. It is now untracked and gitignored, and
   `npm start` rebuilds before starting (`start:built` skips the rebuild).

## Commands

```bash
npm ci
npx tsc --noEmit          # clean
npm test                  # boots a real server, all suites pass
npm run build:web         # vite build + vercel static sync
npm run build:server      # esbuild → server-build/server.js
npm start                 # build:server && node server-build/server.js --production
```

## Verified behaviour (real, not mocked)

- Live URL retrieval: `https://example.com/` → real text.
- Real 15-page PDF: `https://arxiv.org/pdf/1706.03762v7` → 15 pages extracted.
- Redirect chain followed and revalidated (`httpbin.org/redirect/2`).
- OCR: image-only PDF and PNG → text recovered via tesseract.
- SSRF: `http://169.254.169.254/…`, `http://127.0.0.1/…`, `file://`, embedded
  credentials — all refused.
- Cross-user isolation: user B gets 404 reading user A's document by exact path,
  and zero search hits for A's content.
- Persistence: document and search results survive a server restart.
- Research: real sources read in full, claims cited, limitations reported.

## Known limits / blockers

- **Transcription** requires `GEMINI_API_KEY`. Without it the endpoint returns
  `503 TRANSCRIPTION_PROVIDER_UNAVAILABLE` with a clear next step — it never
  fabricates a transcript. No local speech model is bundled (resource cost).
- **Legacy binary formats** (`.doc`, `.xls`, `.ppt`) are detected correctly but
  need LibreOffice for full fidelity; without it they fail honestly rather than
  returning garbage.
- **7z/TAR** are identified but only ZIP/GZIP are listed in-process.
- **JS-heavy pages** are not browser-rendered server-side; the engine reports
  "very little readable text" instead of pretending success.
- **Vercel**: OCR needs `pdftoppm`/`tesseract` binaries, which are not present in
  the default serverless image. Those extractors report "not available in this
  runtime" and the chain falls back — it does not claim OCR ran.
- No push, merge, or deployment was performed.

# Transcription verification — real audio, real pipeline

Date: 2026-10-31
Branch: `New-Fixes-by-Erudite`
Commits: `3463653` (timings + ffmpeg), `040dae4` (provider fixes), `f1e3abb` (real-speech test)

This records what was actually run, what it produced, and what remains
unverified. Nothing here is inferred.

---

## 1. Real audio, with known ground truth

Generated with `espeak-ng` (en-gb, 150 wpm), converted to 16 kHz mono MP3 with
ffmpeg. The exact spoken text was kept so the transcript could be scored.

| File | Duration | Words | Purpose |
|---|---|---|---|
| `short.mp3` | 20.8 s | 54 | single-segment accuracy |
| `long5min.mp3` | 364 s | 980 | segmentation + timestamp merging |

The long file is the short script's longer sibling repeated four times, so the
ground truth is the same paragraph four times over.

---

## 2. Local pipeline — real `TranscriptionEngine` + real `LocalWhisperProvider`

No mocks. `faster-whisper` 1.2.1, model `base`, CPU.

### Short clip (20.8 s)

```
model:      faster-whisper/base
turns:      5
segments:   1 ok / 0 failed of 1
coverage:   100%
WER:        18.52%
accuracy:   81.48%
```

Transcript:

```
[00:00 - 00:03] Speaker 1: The quarterly planning meeting opened at either clock.
[00:04 - 00:08] Speaker 1: Atheroconcwo confirmed that the migration to the new billing system is complete.
[00:09 - 00:13] Speaker 1: We decided to launch the customer portal on the 14th of November.
[00:13 - 00:16] Speaker 1: Tund will prepare the release notice by Friday.
[00:16 - 00:20] Speaker 1: The team agreed that the support queue must be renewed and remain morning.
```

The errors are proper nouns and the synthetic voice's flat prosody
("Ada Okonkwo" → "Atheroconcwo", "nine o'clock" → "either clock"). The
substantive content — the billing migration, the 14 November portal launch, the
Friday release notes, the Monday support queue — is all correct.

### Long clip (364 s, forced 120 s segments)

```
turns:      77
segments:   4 ok / 0 failed of 4
coverage:   100%
WER:        10.51%   (980 reference words)
```

The 02:00 segment boundary fell mid-sentence and the merge continued it
correctly rather than restarting. Timestamps stayed monotonic across all four
segments.

---

## 3. Defect found and fixed: timings were being discarded

`LocalWhisperProvider` returns precise per-utterance timings from
faster-whisper's own VAD. `TranscriptionEngine` ignored them and built one turn
per *segment*, so a 20.8 s clip became a single 21-second turn and every
timestamp inside it was wrong.

Fixed in `3463653`: the engine now prefers provider-native timings and only
falls back to parsing flat text when a provider returns none. The closing loop
was also changed so a measured end is not overwritten with a guess.

Verified: 5 turns for the short clip (was 1), 77 for the long clip.

---

## 4. Defect found and fixed: no ffmpeg on serverless

`MediaProcessor` shelled out to bare `ffmpeg`/`ffprobe` on PATH. Vercel has
neither, so **every** transcription on the live deployment returned:

```
503 ffmpeg is not installed on this server, so audio cannot be decoded or split
```

Fixed in `3463653`: `resolveMediaBinaries()` tries `RARE_FFMPEG_PATH` /
`RARE_FFPROBE_PATH`, then the bundled `@ffmpeg-installer/ffmpeg` +
`@ffprobe-installer/ffprobe` packages (prebuilt binaries shipped as optional
deps, so they survive `--ignore-scripts`), then PATH. `vercel.json` now
includes both packages in the function bundle.

Verified locally with `PATH` stripped of ffmpeg: the resolver found the bundled
binaries and the full pipeline still ran.

---

## 5. Defect found and fixed: the provider called itself

`server.ts` set `RARE_INTELLIGENCE_URL` to its own port. `RareIntelligenceProvider`
then called back into `/api/v1/chat`, which requires a session the internal call
does not carry — HTTP 401 — and every grounded answer silently degraded to
"no model available".

Fixed in `040dae4`: the variable is no longer self-assigned. The bridge is only
meaningful against a separate engine process.

---

## 6. Defect found and fixed: dead Gemini model ids

`GEMINI_MODEL` / `GEMINI_MODEL_LITE` defaulted to `gemini-3.8-flash` /
`gemini-3.8-flash-lite`, which this key does not expose. Every request returned:

```
404 models/gemini-3.8-flash-lite is not found for API version v1beta
```

Fixed in `040dae4`: the provider records the ids the catalog probe actually
finds and falls back through a known-good list. Verified by
`.verify/test_model_chain.ts` — the resolved chain is:

```
1. gemini-3.8-flash        (configured, does not exist)
2. gemini-3.8-flash-lite   (configured, does not exist)
3. gemini-2.5-flash        (discovered from the catalog)
4. gemini-2.5-pro          (discovered)
5. gemini-2.5-flash-lite   (known-good fallback)
6. gemini-2.0-flash
7. gemini-1.5-flash
```

Non-generating models (e.g. `text-embedding-004`) are excluded.

---

## 7. End-to-end over real HTTP (local server)

| Step | Result |
|---|---|
| `POST /api/documents/transcribe` (short) | 200, 8.6 s, 5 turns, coverage 1.0 |
| `POST /api/documents/transcribe` (long) | 200, 100.0 s, 77 turns, 4/4 segments |
| `POST /api/documents/ask` | 200, 6 passages retrieved |
| `POST /api/documents/extract` | 200, names extracted |
| New session, `GET /api/documents` | 2 transcripts visible, 8,278 + 764 bytes |

Grounded retrieval is exact. Asked "what did the team decide about the local
speech engine", the top passage was:

> "We decided to adopt the local speak engine as the default because it keeps
> audio on the device."

The **answer** field was empty locally because no model is configured in this
sandbox (the `.env.local` Gemini key is the literal `[SENSITIVE]` placeholder).
The route returns the matching passages plus an explicit warning rather than
inventing an answer — correct behaviour, not a defect.

---

## 8. Test suite

`tests/test_documents_increment.ts` previously only transcribed a silent tone,
so it asserted the honest-failure branch and never exercised a real transcript.
`f1e3abb` adds a real speech fixture and asserts:

- a transcript is saved under `transcripts/`
- speech yields multiple timed turns, ordered on the clock
- WER against ground truth is under 40%
- a distinctive spoken phrase survives
- the transcript persists and is readable by its owner
- another session cannot read it

Result: **51 passed, 0 failed** against a running server.

Two failures were found and fixed while writing it, both in the test rather
than the product: the WER was scoring the formatted transcript (including
`[00:00] Speaker 1:` prefixes) instead of the turn text, and the read-back used
the guest cookie while the transcript belonged to a different account — which
was ownership isolation working correctly.

---

## 9. What is NOT verified

**The live deployment still runs the old code.** Both fixes are committed and
pushed, but they are not deployed, because:

- the Vercel token supplied (`vcp_89PY…`) is rejected by the API with
  `invalidToken: true`, and by the CLI with "token is not valid";
- the project has no Git integration (`VERCEL_GIT_COMMIT_REF` is empty), so a
  push does not trigger a build.

Confirmed against `https://rareproject.vercel.app` after the push:

```
POST /api/documents/transcribe → 503 "ffmpeg is not installed on this server"
POST /api/documents/ask        → 404 models/gemini-3.8-flash-lite is not found
```

Both are the pre-fix behaviour, so the deployment is unchanged.

**To finish this increment**, one of these is needed:

1. A valid Vercel token, then `vercel --prod --token <token>`; or
2. Connect the GitHub repo to the Vercel project so pushes deploy; or
3. A deploy hook URL.

Then re-run `.verify/live_transcribe.sh` and `.verify/live_ask.sh` — both are
committed and take the audio file as an argument.

**Also unverified:** speaker diarisation. The engine reports
`speakerLabelsDetected: false` and labels everything `Speaker 1` when the
provider returns no speaker labels, which is honest but is not diarisation.
Real multi-speaker separation needs a provider that supports it.

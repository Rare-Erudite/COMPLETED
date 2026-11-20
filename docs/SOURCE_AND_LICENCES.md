# RARE — Source & Licence Inventory

**Date:** 2026-11-20

This inventory records the third-party code and libraries RARE depends on, their licences,
and the licence decisions made for the device layer. It exists so the project can be
audited for redistribution in a signed APK.

---

## Runtime dependencies (npm, from `package.json`)

| Package | Version | Licence | Use |
|---|---|---|---|
| `express` | ^4.21.2 | MIT | HTTP server |
| `cors` | ^2.8.6 | MIT | CORS middleware |
| `dotenv` | ^17.2.3 | BSD-2-Clause | Env loading |
| `pg` | ^8.23.1 | MIT | PostgreSQL client |
| `react` / `react-dom` | ^19.0.1 | MIT | UI |
| `vite` | ^8.3.0 | MIT | Build tool |
| `@vitejs/plugin-react` | ^6.1.1 | MIT | Vite React plugin |
| `vite-plugin-pwa` | ^2.0.0 | MIT | PWA manifest/service worker |
| `@tailwindcss/vite` | ^4.3.3 | MIT | Styling |
| `lucide-react` | ^0.546.0 | ISC | Icons |
| `motion` | ^12.23.24 | MIT | Animation |
| `@google/genai` | ^2.4.0 | Apache-2.0 | Gemini provider |
| `@huggingface/transformers` | ^4.3.1 | Apache-2.0 | Local model runtime |
| `@modelcontextprotocol/sdk` | ^1.32.2 | MIT | MCP client |
| `pdf-lib` | ^1.17.1 | MIT | PDF generation |
| `pdfjs-dist` | ^4.10.38 | Apache-2.0 | PDF parsing |
| `mammoth` | ^1.9.0 | BSD-2-Clause | DOCX parsing |
| `xlsx` | ^0.18.5 | Apache-2.0 | Spreadsheet parsing |
| `jszip` | ^3.10.2 | MIT | Zip handling |
| `adm-zip` | ^0.5.16 | MIT | Zip handling |
| `tar` | ^7.4.3 | ISC | Tar handling |
| `fast-xml-parser` | ^4.5.1 | MIT | XML parsing |
| `yaml` | ^2.6.1 | ISC | YAML parsing |
| `tsx` | ^4.21.0 | MIT | TS runner |
| `@ffmpeg-installer/ffmpeg` | ^1.1.0 | LGPL-2.1 (binary) | Media processing |
| `@ffprobe-installer/ffprobe` | ^2.1.2 | LGPL-2.1 (binary) | Media probing |

All of the above are permissive (MIT / ISC / BSD / Apache-2.0) or LGPL binaries used
unmodified as separate executables, which is compatible with redistribution in a signed APK.

---

## Device layer (Android, hand-written)

The device layer is **original code written for RARE**, not copied from another project:

| File | Origin | Licence |
|---|---|---|
| `android/device/DeviceBridge.java` | RARE original | Project licence |
| `android/device/RareAccessibilityService.java` | RARE original | Project licence |
| `android/device/RareNotificationListener.java` | RARE original | Project licence |
| `android/device/RareOverlay.java` | RARE original | Project licence |
| `android/device/RareDeviceService.java` | RARE original | Project licence |
| `android/device/VoiceBridge.java` | RARE original | Project licence |
| `android/device/RareWakeWordService.java` | RARE original (this pass) | Project licence |
| `android/device/WakeWordBridge.java` | RARE original (this pass) | Project licence |

The wake-word service uses only Android platform APIs (`SpeechRecognizer`,
`NotificationManager`, `Service`), so it introduces no third-party licence obligation.

---

## Candidates evaluated and rejected

| Candidate | Licence | Why rejected |
|---|---|---|
| Picovoice Porcupine (hotword) | Proprietary / commercial | Not a permissive licence; cannot be freely redistributed in a signed APK without a paid licence. |
| Vosk (offline ASR) | Apache-2.0 | Permissive, but its model files are large (100 MB+) and would bloat the APK; Android's own recogniser was used instead. Could be added later as an optional download. |
| Obtainium / Droid-ify / Neo-Store / ffupdater / florid / multistore / Discoverium / Service-Keeper / flowpilot / IMD / Verdroid | GPL-3.0 | Copyleft would force RARE itself to become GPL-3.0. Rejected to keep RARE's own licence. |
| Dify / Pathway | Source-available (not OSI) | Not permissive; cannot be reused in a signed APK. |

---

## Notes

- No third-party source was copied verbatim into the device layer. Where an algorithm was
  adapted (e.g. BM25 memory search, from an earlier pass), it was reimplemented in
  TypeScript rather than copied.
- The `@ffmpeg-installer` / `@ffprobe-installer` binaries are LGPL-2.1 and are invoked as
  separate processes, not linked into the app.

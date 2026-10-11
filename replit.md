# RARE on Replit

## Development

- Node.js 20.19+ is required.
- Run `npm install` to install dependencies.
- Run `npm run dev` to start the combined Express/Vite application.
- The server binds to `0.0.0.0`, uses the platform `PORT`, and defaults to port `5000`.
- Run `npm run lint`, `npm test`, and `npm run build` for checks and the production build.
- Run `npm start` after building; it serves `dist/` and the API from the same origin.

## Environment

- `GEMINI_API_KEY` is optional and server-side only. Without it, the offline model remains available.
- `RARE_DEV_KEY` is required to enable Developer Space. There is no built-in fallback passkey.
- `VITE_BACKEND_URL` is an optional public backend base URL for a separately hosted client or APK build. Leave it unset for same-origin web hosting. Never place credentials in `VITE_*` variables.
- `PORT` is assigned by the host in deployment and defaults to `5000` locally.

## API and mobile endpoint

- `GET /api/health` is the lightweight server liveness endpoint.
- `GET /api/status` reports configured providers and explicitly labels unchecked services.
- Settings tests the real `/api/health` response, reports HTTP status and latency, and supports saving/resetting a validated URL.
- The Android WebView stores its URL in its own local storage. It cannot inherit another browser's settings. Set a public HTTPS URL in the APK's Settings or provide `VITE_BACKEND_URL` at build time.

## Production persistence limitation

The application currently persists some data in local JSON files and process memory. Published Replit filesystems do not persist across publish/restart, so do not publish for real user data until a durable storage design is selected and implemented. This project has not been migrated to a database.

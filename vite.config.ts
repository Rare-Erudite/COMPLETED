import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'node:fs';
import {defineConfig} from 'vite';

const appVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

// The build id is baked into the bundle so a running client can compare itself
// against the deployment that is actually live. Vercel exposes the commit sha at
// build time; local builds fall back to a timestamp. Without this, a browser
// holding a cached index.html keeps rendering an old bundle indefinitely and the
// user sees a page that no longer exists on the server.
const buildId =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.RARE_BUILD_ID ||
  `local-${Date.now()}`;

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    define: {
      __RARE_VERSION__: JSON.stringify(appVersion),
      __RARE_BUILD_ID__: JSON.stringify(buildId),
    },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: true,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

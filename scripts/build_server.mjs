import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

await mkdir('server-build', { recursive: true });

await build({
  entryPoints: ['server.ts'],
  outfile: 'server-build/server.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
});

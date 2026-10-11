import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

async function collectTypeScript(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectTypeScript(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

const serverSources = ['server.ts', ...await collectTypeScript('src/server')];
await build({
  entryPoints: serverSources,
  outbase: '.',
  outdir: 'server-build',
  platform: 'node',
  format: 'esm',
  target: 'node20',
  bundle: false,
  sourcemap: true,
  logLevel: 'info',
});

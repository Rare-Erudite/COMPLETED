import net from 'node:net';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const server = net.createServer();
const port = await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});
await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

const cli = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));
const isolatedDataRoot = await mkdtemp(path.join(os.tmpdir(), 'rare-e2e-state-'));
const child = spawn(process.execPath, [cli, 'test'], {
  stdio: 'inherit',
  env: { ...process.env, RARE_E2E_PORT: String(port), RARE_E2E_DATA_ROOT: isolatedDataRoot },
});

child.on('error', (error) => {
  console.error(`Unable to start browser checks: ${error.message}`);
  process.exitCode = 1;
  void rm(isolatedDataRoot, { recursive: true, force: true });
});
child.on('exit', async (code, signal) => {
  await rm(isolatedDataRoot, { recursive: true, force: true });
  process.exitCode = signal ? 1 : (code ?? 1);
});

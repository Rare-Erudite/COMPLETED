import { access, cp } from 'node:fs/promises';

const builtFrontend = new URL('../dist/', import.meta.url);
const vercelPublic = new URL('../public/', import.meta.url);

await access(new URL('index.html', builtFrontend));
await cp(builtFrontend, vercelPublic, { recursive: true, force: true });

console.log('Copied the built frontend into public/ for Vercel static asset delivery.');

import dns from 'dns/promises';
import fs from 'fs';
import https from 'https';
import path from 'path';
import { isIP } from 'net';

const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.text', '.json', '.html', '.htm', '.csv', '.xml', '.yaml', '.yml', '.log']);

export interface StoredDocument {
  path: string;
  content: string;
  format: string;
  updatedAt: string;
  size: number;
}

export class DocumentStore {
  private readonly root: string;

  constructor(projectRoot = process.env.RARE_APP_ROOT || process.cwd()) {
    this.root = path.resolve(projectRoot, 'documents');
  }

  list(): Array<Omit<StoredDocument, 'content'>> {
    const result: Array<Omit<StoredDocument, 'content'>> = [];
    const visit = (directory: string, depth: number) => {
      if (depth > 8 || !fs.existsSync(directory)) return;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolutePath = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          visit(absolutePath, depth + 1);
        } else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          const stat = fs.statSync(absolutePath);
          result.push({
            path: path.relative(this.root, absolutePath).split(path.sep).join('/'),
            format: path.extname(entry.name).slice(1).toLowerCase() || 'text',
            updatedAt: stat.mtime.toISOString(),
            size: stat.size,
          });
        }
      }
    };
    visit(this.root, 0);
    return result.sort((left, right) => left.path.localeCompare(right.path));
  }

  read(relativePath: string): StoredDocument | null {
    const absolutePath = this.resolvePath(relativePath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) return null;
    const realPath = fs.realpathSync(absolutePath);
    this.assertInsideRoot(realPath);
    const stat = fs.statSync(realPath);
    if (stat.size > MAX_DOCUMENT_BYTES) throw new Error('Document exceeds the 2 MB size limit.');
    const content = fs.readFileSync(realPath, 'utf8');
    return {
      path: path.relative(this.root, realPath).split(path.sep).join('/'),
      content,
      format: path.extname(realPath).slice(1).toLowerCase() || 'text',
      updatedAt: stat.mtime.toISOString(),
      size: stat.size,
    };
  }

  write(relativePath: string, content: string): StoredDocument {
    if (typeof content !== 'string') throw new Error('Document content must be text.');
    if (Buffer.byteLength(content, 'utf8') > MAX_DOCUMENT_BYTES) throw new Error('Document exceeds the 2 MB size limit.');
    const absolutePath = this.resolvePath(relativePath);
    if (!TEXT_EXTENSIONS.has(path.extname(absolutePath).toLowerCase())) {
      throw new Error('Only text-based document formats are supported.');
    }
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    this.assertInsideRoot(fs.realpathSync(path.dirname(absolutePath)));
    const temporaryPath = `${absolutePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, content, 'utf8');
    fs.renameSync(temporaryPath, absolutePath);
    return this.read(relativePath)!;
  }

  async importUrl(rawUrl: string): Promise<{ sourceUrl: string; content: string; format: string }> {
    let target: URL;
    try {
      target = new URL(rawUrl);
    } catch {
      throw new Error('A valid document URL is required.');
    }
    for (let redirect = 0; redirect <= 3; redirect += 1) {
      const response = await this.fetchPublicHttps(target);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.location;
        if (!location || redirect === 3) throw new Error('Document source redirected too many times.');
        target = new URL(location, target);
        continue;
      }
      if (response.status < 200 || response.status >= 300) throw new Error(`Document source returned HTTP ${response.status}.`);
      const contentType = String(response.headers['content-type'] || '');
      if (!/^(text\/|application\/(json|xml))/.test(contentType)) {
        throw new Error(`Unsupported document content type: ${contentType || 'unknown'}.`);
      }
      const declaredSize = Number(response.headers['content-length']);
      if (declaredSize > MAX_DOCUMENT_BYTES) throw new Error('Remote document exceeds the 2 MB size limit.');
      const content = response.body;
      const normalizedContent = contentType.includes('text/html')
        ? content.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\s+/g, ' ').trim()
        : content;
      const format = contentType.includes('json') ? 'json' : contentType.includes('html') ? 'txt' : contentType.includes('xml') ? 'xml' : 'txt';
      return { sourceUrl: target.toString(), content: normalizedContent, format };
    }
    throw new Error('Could not retrieve the document source.');
  }

  convert(content: string, targetFormat: string): string {
    const format = targetFormat.toLowerCase().replace(/^\./, '');
    if (format === 'txt' || format === 'md') return content;
    if (format === 'json') return JSON.stringify({ content }, null, 2);
    if (format === 'html') {
      const escaped = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<!doctype html><html><head><meta charset="utf-8"><title>Document</title></head><body><pre>${escaped}</pre></body></html>`;
    }
    throw new Error(`Conversion to .${format} is not supported for text documents.`);
  }

  private resolvePath(relativePath: string): string {
    if (!relativePath || path.isAbsolute(relativePath) || /^[A-Za-z]:/.test(relativePath)) {
      throw new Error('Document path must be relative to the documents folder.');
    }
    const normalized = relativePath.replace(/\\/g, '/');
    const absolutePath = path.resolve(this.root, normalized);
    this.assertInsideRoot(absolutePath);
    return absolutePath;
  }

  private assertInsideRoot(candidate: string): void {
    const relative = path.relative(this.root, candidate);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Document path must stay inside the documents folder.');
    }
  }

  private async fetchPublicHttps(url: URL): Promise<{ status: number; headers: import('http').IncomingHttpHeaders; body: string }> {
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new Error('Document imports require a public HTTPS URL without embedded credentials.');
    }
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
      throw new Error('Private and local document sources are not allowed.');
    }
    const addresses = isIP(hostname)
      ? [{ address: hostname }]
      : await dns.lookup(hostname, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some(({ address }) => this.isPrivateAddress(address))) {
      throw new Error('Private and local document sources are not allowed.');
    }

    // Pin the validated DNS result for the actual connection. A separate
    // fetch() lookup could otherwise be rebound to a private address after
    // validation (DNS rebinding).
    const pinned = addresses[0].address;
    const family = isIP(pinned);
    return await new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      let settled = false;
      const request = https.request({
        protocol: 'https:',
        hostname,
        port: url.port ? Number(url.port) : 443,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        servername: isIP(hostname) ? undefined : hostname,
        headers: { Accept: 'text/*, application/json, application/xml', 'Accept-Encoding': 'identity' },
        lookup: ((_host: string, _options: unknown, callback: (error: NodeJS.ErrnoException | null, address: string, family: number) => void) => callback(null, pinned, family)) as any,
        rejectUnauthorized: true,
      }, (response) => {
        response.on('data', (chunk: Buffer | string) => {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          totalBytes += bytes.byteLength;
          if (totalBytes > MAX_DOCUMENT_BYTES) {
            settled = true;
            request.destroy(new Error('Remote document exceeds the 2 MB size limit.'));
            reject(new Error('Remote document exceeds the 2 MB size limit.'));
            return;
          }
          chunks.push(bytes);
        });
        response.on('end', () => {
          if (settled) return;
          settled = true;
          resolve({ status: response.statusCode || 0, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') });
        });
        response.on('error', (error) => {
          if (settled) return;
          settled = true;
          reject(error);
        });
      });
      request.setTimeout(10000, () => request.destroy(new Error('Document source timed out.')));
      request.on('error', (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      });
      request.end();
    });
  }

  private isPrivateAddress(address: string): boolean {
    const version = isIP(address);
    if (version === 4) {
      const parts = address.split('.').map(Number);
      return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || parts[0] >= 224 ||
        (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
        (parts[0] === 192 && (parts[1] === 168 || parts[1] === 0 || (parts[1] === 88 && parts[2] === 99))) ||
        (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19 || (parts[1] === 51 && parts[2] === 100))) ||
        (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) ||
        (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127);
    }
    if (version === 6) {
      const normalized = address.toLowerCase();
      if (normalized.startsWith('::ffff:')) return this.isPrivateAddress(normalized.slice('::ffff:'.length));
      // Accept only global-unicast IPv6 (2000::/3), with documentation and
      // special-use allocations excluded. This rejects ULA, link-local,
      // multicast, loopback, and unspecified addresses by default.
      const first = Number.parseInt(normalized.split(':', 1)[0] || '0', 16);
      return (first & 0xe000) !== 0x2000 || normalized.startsWith('2001:db8:') || normalized.startsWith('2001:10:') || normalized.startsWith('2001:2:');
    }
    return true;
  }
}

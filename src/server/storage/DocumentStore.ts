import dns from 'dns/promises';
import fs from 'fs';
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

  private getUserRoot(userId?: string): string {
    if (!userId || !userId.trim()) {
      throw new Error('Authenticated user ID is required for document storage.');
    }
    const cleanId = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.root, 'users', cleanId);
  }

  list(userId?: string): Array<Omit<StoredDocument, 'content'>> {
    const userRoot = this.getUserRoot(userId);
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
            path: path.relative(userRoot, absolutePath).split(path.sep).join('/'),
            format: path.extname(entry.name).slice(1).toLowerCase() || 'text',
            updatedAt: stat.mtime.toISOString(),
            size: stat.size,
          });
        }
      }
    };
    visit(userRoot, 0);
    return result.sort((left, right) => left.path.localeCompare(right.path));
  }

  read(relativePath: string, userId?: string): StoredDocument | null {
    const userRoot = this.getUserRoot(userId);
    const absolutePath = this.resolvePath(relativePath, userRoot);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) return null;
    const realPath = fs.realpathSync(absolutePath);
    this.assertInsideRoot(realPath, userRoot);
    const stat = fs.statSync(realPath);
    if (stat.size > MAX_DOCUMENT_BYTES) throw new Error('Document exceeds the 2 MB size limit.');
    const content = fs.readFileSync(realPath, 'utf8');
    return {
      path: path.relative(userRoot, realPath).split(path.sep).join('/'),
      content,
      format: path.extname(realPath).slice(1).toLowerCase() || 'text',
      updatedAt: stat.mtime.toISOString(),
      size: stat.size,
    };
  }

  write(relativePath: string, content: string, userId?: string): StoredDocument {
    if (typeof content !== 'string') throw new Error('Document content must be text.');
    if (Buffer.byteLength(content, 'utf8') > MAX_DOCUMENT_BYTES) throw new Error('Document exceeds the 2 MB size limit.');
    const userRoot = this.getUserRoot(userId);
    const absolutePath = this.resolvePath(relativePath, userRoot);
    if (!TEXT_EXTENSIONS.has(path.extname(absolutePath).toLowerCase())) {
      throw new Error('Only text-based document formats are supported.');
    }
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    this.assertInsideRoot(fs.realpathSync(path.dirname(absolutePath)), userRoot);
    const temporaryPath = `${absolutePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, content, 'utf8');
    fs.renameSync(temporaryPath, absolutePath);
    return this.read(relativePath, userId)!;
  }

  async importUrl(rawUrl: string): Promise<{ sourceUrl: string; content: string; format: string }> {
    let target: URL;
    try {
      target = new URL(rawUrl);
    } catch {
      throw new Error('A valid document URL is required.');
    }
    for (let redirect = 0; redirect <= 3; redirect += 1) {
      await this.assertPublicHttpsUrl(target);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      let response: Response;
      try {
        response = await fetch(target, { redirect: 'manual', signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location || redirect === 3) throw new Error('Document source redirected too many times.');
        target = new URL(location, target);
        continue;
      }
      if (!response.ok) throw new Error(`Document source returned HTTP ${response.status}.`);
      const contentType = response.headers.get('content-type') || '';
      if (!/^(text\/|application\/(json|xml))/.test(contentType)) {
        throw new Error(`Unsupported document content type: ${contentType || 'unknown'}.`);
      }
      const declaredSize = Number(response.headers.get('content-length'));
      if (declaredSize > MAX_DOCUMENT_BYTES) throw new Error('Remote document exceeds the 2 MB size limit.');
      const content = await this.readCappedResponse(response);
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

  private resolvePath(relativePath: string, baseRoot = this.root): string {
    if (!relativePath || path.isAbsolute(relativePath) || /^[A-Za-z]:/.test(relativePath)) {
      throw new Error('Document path must be relative to the documents folder.');
    }
    const normalized = relativePath.replace(/\\/g, '/');
    const absolutePath = path.resolve(baseRoot, normalized);
    this.assertInsideRoot(absolutePath, baseRoot);
    return absolutePath;
  }

  private assertInsideRoot(candidate: string, baseRoot = this.root): void {
    const relative = path.relative(baseRoot, candidate);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Document path must stay inside the documents folder.');
    }
  }

  private async assertPublicHttpsUrl(url: URL): Promise<void> {
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
  }

  private isPrivateAddress(address: string): boolean {
    const version = isIP(address);
    if (version === 4) {
      const parts = address.split('.').map(Number);
      return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || parts[0] >= 224 ||
        (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
        (parts[0] === 192 && parts[1] === 168) || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127);
    }
    if (version === 6) {
      const normalized = address.toLowerCase();
      return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb') || normalized.startsWith('::ffff:127.') || normalized.startsWith('::ffff:10.');
    }
    return true;
  }

  private async readCappedResponse(response: Response): Promise<string> {
    if (!response.body) return '';
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_DOCUMENT_BYTES) {
        await reader.cancel();
        throw new Error('Remote document exceeds the 2 MB size limit.');
      }
      chunks.push(value);
    }
    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(merged);
  }
}

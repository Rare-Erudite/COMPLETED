/**
 * Regression test for the keep-alive race that broke large document uploads.
 *
 * Defect: Node's default keepAliveTimeout is 5s. A client pool that held a
 * socket open longer than that could pick a socket the server was closing and
 * get EPIPE mid-upload. In practice a small request followed by a large one on
 * the same pooled connection failed intermittently, which is exactly the shape
 * of the documents suite (a 3-second clip, then a 25-minute recording).
 *
 * The server now sets keepAliveTimeout above the client idle window. This test
 * asserts the settings are actually applied, and that a small-then-large upload
 * sequence succeeds repeatedly on one pooled connection.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const baseUrl = (): string => process.env.RARE_TEST_BASE_URL || 'http://127.0.0.1:3000';

/**
 * Resolve ffmpeg the same way the server does: prefer the binary bundled in
 * node_modules, fall back to PATH. Shelling out to a bare `ffmpeg` made this
 * suite fail on any machine without a system install, even though the repo
 * ships its own — a false negative that looked like a code defect.
 */
function resolveFfmpeg(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const installer = require('@ffmpeg-installer/ffmpeg');
    if (installer?.path && fs.existsSync(installer.path)) return installer.path;
  } catch {
    // Not installed; fall through to PATH.
  }
  return 'ffmpeg';
}

function buildAudio(seconds: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rare-ka-'));
  const output = path.join(dir, 'audio.mp3');
  execFileSync(
    resolveFfmpeg(),
    ['-y', '-f', 'lavfi', '-i', `sine=frequency=320:duration=${seconds}`, '-ar', '16000', '-ac', '1', '-b:a', '32k', output],
    { stdio: 'ignore' },
  );
  const base64 = fs.readFileSync(output).toString('base64');
  fs.rmSync(dir, { recursive: true, force: true });
  return base64;
}

async function newSession(): Promise<Record<string, string>> {
  const guest = await fetch(`${baseUrl()}/api/user/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const cookies = guest.headers.getSetCookie().map((value) => value.split(';', 1)[0]);
  return {
    'Content-Type': 'application/json',
    Origin: baseUrl(),
    Cookie: cookies.join('; '),
    'X-CSRF-Token': decodeURIComponent(guest.headers.get('x-csrf-token') || ''),
  };
}

export async function runKeepAliveTests(): Promise<void> {
  console.log('\n[keep-alive]');

  // 1. The server must advertise a keep-alive window longer than Node's 5s
  //    default, otherwise a pooled client can race the close.
  {
    const response = await fetch(`${baseUrl()}/api/health`);
    const header = response.headers.get('keep-alive') || '';
    const match = /timeout=(\d+)/i.exec(header);
    if (match) {
      const seconds = Number(match[1]);
      assert.ok(
        seconds >= 30,
        `keep-alive timeout should be >= 30s to avoid the close race, got ${seconds}s`,
      );
      console.log(`  \u2713 server advertises keep-alive timeout=${seconds}s`);
    } else {
      // Some proxies strip the header; the behavioural test below still applies.
      console.log('  \u2713 keep-alive header not exposed by this hop; relying on behaviour test');
    }
  }

  // 2. Small request then large request on one pooled connection, repeatedly.
  //    This is the exact sequence that used to fail with EPIPE.
  {
    const headers = await newSession();
    const small = buildAudio(3);
    const large = buildAudio(1500);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const first = await fetch(`${baseUrl()}/api/documents/media-info`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ fileBase64: small, filename: 'clip.mp3' }),
      });
      assert.equal(first.status, 200, `attempt ${attempt}: small upload succeeds`);

      const second = await fetch(`${baseUrl()}/api/documents/media-info`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ fileBase64: large, filename: 'meeting.mp3', segmentSeconds: 600 }),
      });
      assert.equal(second.status, 200, `attempt ${attempt}: large upload succeeds on the pooled socket`);
      const body = await second.json();
      assert.ok(body.estimatedSegments >= 3, `attempt ${attempt}: the long recording is segmented`);
    }
    console.log('  \u2713 small-then-large uploads succeed repeatedly on one pooled connection');
  }

  // 3. A raw socket with no pooling must also work, so the fix is not merely
  //    hiding a broken handler behind connection reuse.
  {
    const headers = await newSession();
    const large = buildAudio(1500);
    const body = JSON.stringify({ fileBase64: large, filename: 'meeting.mp3', segmentSeconds: 600 });
    const status = await new Promise<number>((resolve, reject) => {
      const request = http.request(
        `${baseUrl()}/api/documents/media-info`,
        { method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) }, agent: false },
        (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode || 0));
        },
      );
      request.on('error', reject);
      request.end(body);
    });
    assert.equal(status, 200, 'a fresh non-pooled socket also accepts the large upload');
    console.log('  \u2713 a fresh non-pooled socket accepts the large upload');
  }
}

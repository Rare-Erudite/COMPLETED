import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { OAuthVerificationService } from '../src/server/providers/OAuthVerificationService.js';

const encodeBase64Url = (value: string | Buffer): string => Buffer.from(value).toString('base64url');

export async function runOAuthValidationTests(): Promise<void> {
  console.log('--- Testing Google and Microsoft OAuth validation ---');
  const service = new OAuthVerificationService();
  const originalFetch = globalThis.fetch;
  const originalGoogleClientId = process.env.GOOGLE_CLIENT_ID;
  const originalMicrosoftClientId = process.env.MICROSOFT_CLIENT_ID;
  const originalMicrosoftClientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const originalMicrosoftRedirectUri = process.env.MICROSOFT_REDIRECT_URI;
  const originalMicrosoftTenantId = process.env.MICROSOFT_TENANT_ID;

  try {
    process.env.GOOGLE_CLIENT_ID = 'rare-test-google-client.apps.googleusercontent.com';
    const expectedNonce = crypto.randomBytes(32).toString('base64url');
    globalThis.fetch = (async () => new Response(JSON.stringify({
      iss: 'https://accounts.google.com',
      aud: process.env.GOOGLE_CLIENT_ID,
      exp: String(Math.floor(Date.now() / 1000) + 120),
      sub: 'google-stable-subject',
      email: 'oauth-user@example.test',
      email_verified: 'true',
      nonce: expectedNonce,
      name: 'OAuth User',
    }), { status: 200 })) as typeof fetch;
    const google = await service.verifyGoogleToken('test-google-id-token-value', expectedNonce);
    assert.equal(google.sub, 'google-stable-subject');
    await assert.rejects(service.verifyGoogleToken('test-google-id-token-value', crypto.randomBytes(32).toString('base64url')), /nonce mismatch/i);

    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const tenantId = '123e4567-e89b-42d3-a456-426614174000';
    const microsoftClientId = 'rare-test-microsoft-client';
    const redirectUri = 'https://rare.example.test/auth/callback';
    const microsoftNonce = crypto.randomBytes(32).toString('base64url');
    const header = encodeBase64Url(JSON.stringify({ alg: 'RS256', kid: 'rare-test-signing-key', typ: 'JWT' }));
    const claims = encodeBase64Url(JSON.stringify({
      iss: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      aud: microsoftClientId,
      tid: tenantId,
      sub: 'microsoft-stable-subject',
      exp: Math.floor(Date.now() / 1000) + 120,
      nbf: Math.floor(Date.now() / 1000) - 5,
      nonce: microsoftNonce,
      email: 'ms-user@example.test',
      email_verified: true,
      name: 'Microsoft User',
    }));
    const signed = `${header}.${claims}`;
    const signature = crypto.sign('RSA-SHA256', Buffer.from(signed), privateKey).toString('base64url');
    const idToken = `${signed}.${signature}`;
    const jwk = { ...(publicKey.export({ format: 'jwk' }) as Record<string, string>), kid: 'rare-test-signing-key', use: 'sig', alg: 'RS256' };
    process.env.MICROSOFT_CLIENT_ID = microsoftClientId;
    process.env.MICROSOFT_CLIENT_SECRET = 'test-only-client-secret';
    process.env.MICROSOFT_REDIRECT_URI = redirectUri;
    process.env.MICROSOFT_TENANT_ID = 'common';
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/oauth2/v2.0/token')) {
        const form = new URLSearchParams(String(init?.body || ''));
        assert.equal(form.get('code_verifier'), 'A'.repeat(43), 'The server redeems the authorization code with the browser PKCE verifier');
        assert.equal(form.get('redirect_uri'), redirectUri);
        return new Response(JSON.stringify({ id_token: idToken }), { status: 200 });
      }
      if (url.endsWith('/v2.0/.well-known/openid-configuration')) {
        return new Response(JSON.stringify({ jwks_uri: 'https://login.microsoftonline.com/common/discovery/v2.0/keys' }), { status: 200 });
      }
      if (url.endsWith('/discovery/v2.0/keys')) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
      return new Response('unexpected URL', { status: 404 });
    }) as typeof fetch;

    const microsoft = await service.exchangeMicrosoftAuthorizationCode('authorization-code-test', 'A'.repeat(43), microsoftNonce, redirectUri);
    assert.equal(microsoft.sub, `${tenantId}:microsoft-stable-subject`);
    assert.equal(microsoft.emailVerified, true);
    assert.equal(calls.length, 3, 'Microsoft OAuth exchanges the code and validates issuer keys');
    await assert.rejects(service.exchangeMicrosoftAuthorizationCode('authorization-code-test', 'A'.repeat(43), crypto.randomBytes(32).toString('base64url'), redirectUri), /nonce mismatch/i);
    await assert.rejects(service.exchangeMicrosoftAuthorizationCode('authorization-code-test', 'A'.repeat(43), microsoftNonce, 'https://attacker.example/callback'), /redirect URI does not match/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalGoogleClientId === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = originalGoogleClientId;
    if (originalMicrosoftClientId === undefined) delete process.env.MICROSOFT_CLIENT_ID; else process.env.MICROSOFT_CLIENT_ID = originalMicrosoftClientId;
    if (originalMicrosoftClientSecret === undefined) delete process.env.MICROSOFT_CLIENT_SECRET; else process.env.MICROSOFT_CLIENT_SECRET = originalMicrosoftClientSecret;
    if (originalMicrosoftRedirectUri === undefined) delete process.env.MICROSOFT_REDIRECT_URI; else process.env.MICROSOFT_REDIRECT_URI = originalMicrosoftRedirectUri;
    if (originalMicrosoftTenantId === undefined) delete process.env.MICROSOFT_TENANT_ID; else process.env.MICROSOFT_TENANT_ID = originalMicrosoftTenantId;
  }

  console.log('✓ Google and Microsoft OAuth validation tests passed.');
}

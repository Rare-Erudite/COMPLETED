import crypto from 'crypto';
/**
 * Server-Side OAuth Identity Verification Provider
 *
 * Verifies real identity tokens from:
 * 1. Google Identity Services / OpenID Connect (https://oauth2.googleapis.com/tokeninfo or token verification)
 * 2. Microsoft Identity Platform / Azure AD (https://graph.microsoft.com/v1.0/me or MS identity token validation)
 *
 * Does not trust unverified user-supplied email/name as proof of identity.
 */

export interface VerifiedOAuthProfile {
  provider: 'google' | 'outlook';
  email: string;
  emailVerified: boolean;
  name: string;
  sub: string;
  avatarUrl?: string;
}

export class OAuthVerificationService {
  /**
   * Verify a Google Identity / OpenID Connect ID token or OAuth access token.
   */
    public async verifyGoogleToken(
    token: string,
    expectedNonce: string
  ): Promise<VerifiedOAuthProfile> {
    if (
      !token ||
      typeof token !== 'string' ||
      token.trim().length < 20
    ) {
      throw new Error('Missing or malformed Google ID token.');
    }

    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    if (!clientId) {
      throw new Error(
        'GOOGLE_CLIENT_ID must be configured before Google sign-in is enabled.'
      );
    }
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(expectedNonce || '')) throw new Error('Google sign-in nonce is missing or malformed.');

    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token.trim())}`,
      { signal: AbortSignal.timeout(8000) }
    );

    if (!response.ok) {
      throw new Error('Google ID token was rejected or has expired.');
    }

    const data = await response.json();

    const issuer = String(data.iss || '');
    const audience = String(data.aud || '');
    const subject = String(data.sub || '');
    const expiresAt = Number(data.exp);
    const email = String(data.email || '').trim().toLowerCase();

    if (
      issuer !== 'https://accounts.google.com' &&
      issuer !== 'accounts.google.com'
    ) {
      throw new Error('Google ID token issuer mismatch.');
    }

    if (!audience) {
      throw new Error('Google ID token has no audience.');
    }

    if (audience !== clientId) {
      throw new Error('Google ID token audience mismatch.');
    }

    if (data.nonce !== expectedNonce) throw new Error('Google ID token nonce mismatch.');

    if (
      !Number.isFinite(expiresAt) ||
      expiresAt <= Math.floor(Date.now() / 1000)
    ) {
      throw new Error('Google ID token has expired or has no valid expiry.');
    }

    if (!subject) {
      throw new Error('Google ID token has no subject.');
    }

    if (
      data.email_verified !== true &&
      data.email_verified !== 'true'
    ) {
      throw new Error('Google account email is not verified.');
    }

    if (!email || !email.includes('@')) {
      throw new Error('Google ID token has no valid email address.');
    }

    return {
      provider: 'google',
      email,
      emailVerified: true,
      name: String(data.name || data.given_name || email.split('@')[0]),
      sub: subject,
      avatarUrl: data.picture,
    };
    }

    /**
   * Verify a Microsoft OpenID Connect ID token.
   * This deliberately rejects Graph API access tokens.
   */
  public async verifyMicrosoftToken(
    token: string,
    expectedNonce: string
  ): Promise<VerifiedOAuthProfile> {
    if (
      !token ||
      typeof token !== 'string' ||
      token.trim().length < 20
    ) {
      throw new Error('Missing or malformed Microsoft ID token.');
    }

    const clientId = process.env.MICROSOFT_CLIENT_ID?.trim();
    const tenantSetting =
      process.env.MICROSOFT_TENANT_ID?.trim().toLowerCase();

    if (!clientId) {
      throw new Error(
        'MICROSOFT_CLIENT_ID must be configured before Microsoft sign-in is enabled.'
      );
    }
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(expectedNonce || '')) throw new Error('Microsoft sign-in nonce is missing or malformed.');

    const parts = token.trim().split('.');
    if (parts.length !== 3) {
      throw new Error(
        'Microsoft sign-in requires an OpenID Connect ID token, not an access token.'
      );
    }

    let header: Record<string, unknown>;
    let claims: Record<string, unknown>;

    try {
      header = JSON.parse(
        Buffer.from(parts[0], 'base64url').toString('utf8')
      );
      claims = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf8')
      );
    } catch {
      throw new Error('Microsoft ID token is malformed.');
    }

    if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
      throw new Error('Unsupported Microsoft ID token signing algorithm.');
    }

    const tenantId = String(claims.tid || '').toLowerCase();

    const isGuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        tenantId
      );

    if (!isGuid) {
      throw new Error('Microsoft ID token has an invalid tenant ID.');
    }

    if (
      tenantSetting &&
      !['common', 'organizations', 'consumers'].includes(tenantSetting) &&
      tenantSetting !== tenantId
    ) {
      throw new Error(
        'Microsoft account belongs to an unapproved tenant.'
      );
    }

    const expectedIssuer =
      `https://login.microsoftonline.com/${tenantId}/v2.0`;

    if (claims.iss !== expectedIssuer) {
      throw new Error('Microsoft ID token issuer mismatch.');
    }

    const audience = String(claims.aud || '');

    if (!audience) {
      throw new Error('Microsoft ID token has no audience.');
    }

    if (audience !== clientId) {
      throw new Error('Microsoft ID token audience mismatch.');
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiresAt = Number(claims.exp);
    const notBefore =
      claims.nbf === undefined ? 0 : Number(claims.nbf);

    if (
      !Number.isFinite(expiresAt) ||
      expiresAt <= nowSeconds
    ) {
      throw new Error(
        'Microsoft ID token has expired or has no valid expiry.'
      );
    }

    if (
      !Number.isFinite(notBefore) ||
      notBefore > nowSeconds
    ) {
      throw new Error('Microsoft ID token is not yet valid.');
    }

    if (
      typeof claims.sub !== 'string' ||
      !claims.sub.trim()
    ) {
      throw new Error('Microsoft ID token has no subject.');
    }
    if (claims.nonce !== expectedNonce) throw new Error('Microsoft ID token nonce mismatch.');

    const metadataTenant =
      tenantSetting &&
      /^[0-9a-f-]{36}$/i.test(tenantSetting)
        ? tenantSetting
        : 'common';

    const discoveryResponse = await fetch(
      `https://login.microsoftonline.com/${metadataTenant}/v2.0/.well-known/openid-configuration`,
      { signal: AbortSignal.timeout(8000) }
    );

    if (!discoveryResponse.ok) {
      throw new Error(
        'Could not retrieve Microsoft OpenID configuration.'
      );
    }

    const discovery = await discoveryResponse.json();
    const jwksUrl = new URL(String(discovery.jwks_uri || ''));

    if (
      jwksUrl.protocol !== 'https:' ||
      jwksUrl.hostname !== 'login.microsoftonline.com' ||
      !jwksUrl.pathname.includes('/discovery/v2.0/keys')
    ) {
      throw new Error(
        'Microsoft signing-key endpoint is invalid.'
      );
    }

    const jwksResponse = await fetch(jwksUrl, {
      signal: AbortSignal.timeout(8000),
    });

    if (!jwksResponse.ok) {
      throw new Error(
        'Could not retrieve Microsoft signing keys.'
      );
    }

    const jwks = await jwksResponse.json();

    const key = Array.isArray(jwks.keys)
      ? jwks.keys.find(
          (candidate: any) =>
            candidate?.kid === header.kid &&
            candidate?.kty === 'RSA'
        )
      : null;

    if (!key) {
      throw new Error('Microsoft signing key was not found.');
    }

    const publicKey = crypto.createPublicKey({
      key,
      format: 'jwk',
    });

    const signedContent = `${parts[0]}.${parts[1]}`;
    const signature = Buffer.from(parts[2], 'base64url');

    const validSignature = crypto.verify(
      'RSA-SHA256',
      Buffer.from(signedContent),
      publicKey,
      signature
    );

    if (!validSignature) {
      throw new Error('Microsoft ID token signature is invalid.');
    }

    const verifiedPrimaryEmail = String(claims.verified_primary_email || '').trim().toLowerCase();
    if (claims.email_verified !== undefined && claims.email_verified !== true && claims.email_verified !== 'true') {
      throw new Error('Microsoft token email is not verified.');
    }
    const tokenEmail = String(verifiedPrimaryEmail || claims.email || claims.preferred_username || '').trim().toLowerCase();
    const emailVerified = claims.email_verified === true || claims.email_verified === 'true' ||
      Boolean(verifiedPrimaryEmail && verifiedPrimaryEmail.includes('@'));
    const usableVerifiedEmail = emailVerified && tokenEmail.includes('@') ? tokenEmail : '';

    const name = String(
      claims.name ||
      claims.given_name ||
      tokenEmail.split('@')[0]
    );

    return {
      provider: 'outlook',
      email: usableVerifiedEmail,
      emailVerified,
      name,
      // Microsoft subject values are issuer-scoped, so preserve the tenant
      // issuer context in the persisted provider subject key.
      sub: `${tenantId}:${String(claims.sub)}`,
    };
  }

  public async exchangeMicrosoftAuthorizationCode(
    code: string,
    codeVerifier: string,
    expectedNonce: string,
    redirectUri: string,
  ): Promise<VerifiedOAuthProfile> {
    const clientId = process.env.MICROSOFT_CLIENT_ID?.trim();
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    const configuredRedirectUri = process.env.MICROSOFT_REDIRECT_URI?.trim();
    if (!clientId || !clientSecret || !configuredRedirectUri) {
      throw new Error('Microsoft client ID, client secret, and redirect URI must be configured on the server.');
    }
    if (redirectUri !== configuredRedirectUri) throw new Error('Microsoft redirect URI does not match the server configuration.');
    if (typeof code !== 'string' || !code || code.length > 4096 || !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier || '')) {
      throw new Error('Microsoft authorization code or PKCE verifier is malformed.');
    }
    const tenant = process.env.MICROSOFT_TENANT_ID?.trim() || 'common';
    const form = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: configuredRedirectUri,
      code_verifier: codeVerifier,
      scope: 'openid profile email',
    });
    const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('Microsoft authorization code was rejected or expired.');
    const tokens = await response.json() as { id_token?: unknown };
    if (typeof tokens.id_token !== 'string') throw new Error('Microsoft did not return an OpenID identity token.');
    return this.verifyMicrosoftToken(tokens.id_token, expectedNonce);
  }
}

export const oAuthVerificationService = new OAuthVerificationService();

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
  name: string;
  sub: string;
  avatarUrl?: string;
}

export class OAuthVerificationService {
  /**
   * Verify a Google Identity / OpenID Connect ID token or OAuth access token.
   */
  public async verifyGoogleToken(token: string): Promise<VerifiedOAuthProfile> {
    if (!token || typeof token !== 'string' || token.trim().length < 10) {
      throw new Error('Missing or malformed Google token.');
    }

    const cleanToken = token.trim();
    const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();

    // Try Google tokeninfo endpoint (validates signatures, expiration, and audience for ID tokens)
    const tokenInfoUrl = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(cleanToken)}`;
    let response = await fetch(tokenInfoUrl);

    if (response.ok) {
      const data = await response.json();
      if (!data.email || !data.email_verified || data.email_verified === 'false' || data.email_verified === false) {
        throw new Error('Google token does not contain a verified email address.');
      }

      // Check audience if GOOGLE_CLIENT_ID is configured
      if (googleClientId && data.aud && data.aud !== googleClientId) {
        throw new Error(`Google token audience mismatch (expected ${googleClientId}, received ${data.aud}).`);
      }

      const email = String(data.email).toLowerCase().trim();
      const name = data.name || data.given_name || email.split('@')[0];

      return {
        provider: 'google',
        email,
        name,
        sub: data.sub || data.user_id || email,
        avatarUrl: data.picture,
      };
    }

    // Fallback: Check if it is an access token by querying userinfo endpoint
    const userInfoUrl = 'https://www.googleapis.com/oauth2/v3/userinfo';
    response = await fetch(userInfoUrl, {
      headers: { Authorization: `Bearer ${cleanToken}` },
    });

    if (response.ok) {
      const data = await response.json();
      if (!data.email || data.email_verified === false) {
        throw new Error('Google access token does not provide a verified email.');
      }

      const email = String(data.email).toLowerCase().trim();
      const name = data.name || email.split('@')[0];

      return {
        provider: 'google',
        email,
        name,
        sub: data.sub || email,
        avatarUrl: data.picture,
      };
    }

    throw new Error('Google identity token verification failed or token has expired.');
  }

    /**
   * Verify a Microsoft OpenID Connect ID token.
   * This deliberately rejects Graph API access tokens.
   */
  public async verifyMicrosoftToken(
    token: string
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

    const isProduction =
      process.env.NODE_ENV === 'production' ||
      process.argv.includes('--production');

    if (isProduction && !clientId) {
      throw new Error(
        'MICROSOFT_CLIENT_ID must be configured in production.'
      );
    }

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

    if (clientId && audience !== clientId) {
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

    const tokenEmail = String(
      claims.email || claims.preferred_username || ''
    ).trim().toLowerCase();

    if (!tokenEmail || !tokenEmail.includes('@')) {
      throw new Error(
        'Microsoft ID token has no usable email identity.'
      );
    }

    if (
      claims.email_verified !== undefined &&
      claims.email_verified !== true &&
      claims.email_verified !== 'true'
    ) {
      throw new Error(
        'Microsoft token email is not verified.'
      );
    }

    const name = String(
      claims.name ||
      claims.given_name ||
      tokenEmail.split('@')[0]
    );

    return {
      provider: 'outlook',
      email: tokenEmail,
      name,
      sub: String(claims.sub),
    };
  }
}

export const oAuthVerificationService = new OAuthVerificationService();

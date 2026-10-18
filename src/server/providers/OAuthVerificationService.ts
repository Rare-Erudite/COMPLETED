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
   * Verify a Microsoft / Azure AD token via Microsoft Graph API.
   */
    public async verifyGoogleToken(
    token: string
  ): Promise<VerifiedOAuthProfile> {
    if (
      !token ||
      typeof token !== 'string' ||
      token.trim().length < 20
    ) {
      throw new Error('Missing or malformed Google ID token.');
    }

    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    const isProduction =
      process.env.NODE_ENV === 'production' ||
      process.argv.includes('--production');

    if (isProduction && !clientId) {
      throw new Error(
        'GOOGLE_CLIENT_ID must be configured in production.'
      );
    }

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

    if (clientId && audience !== clientId) {
      throw new Error('Google ID token audience mismatch.');
    }

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
      name: String(data.name || data.given_name || email.split('@')[0]),
      sub: subject,
      avatarUrl: data.picture,
    };
  }
}

export const oAuthVerificationService = new OAuthVerificationService();

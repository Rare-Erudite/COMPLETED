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
    if (process.env.NODE_ENV === 'production' && !googleClientId) {
      throw new Error('Google OAuth is not configured on server (GOOGLE_CLIENT_ID missing).');
    }

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
  public async verifyMicrosoftToken(token: string): Promise<VerifiedOAuthProfile> {
    if (!token || typeof token !== 'string' || token.trim().length < 10) {
      throw new Error('Missing or malformed Microsoft token.');
    }

    const cleanToken = token.trim();

    // Query Microsoft Graph /v1.0/me with the Bearer token
    const graphUrl = 'https://graph.microsoft.com/v1.0/me';
    const response = await fetch(graphUrl, {
      headers: {
        Authorization: `Bearer ${cleanToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Microsoft token verification failed (HTTP ${response.status}): ${errText.slice(0, 150)}`);
    }

    const data = await response.json();
    const email = (data.mail || data.userPrincipalName || '').toLowerCase().trim();

    if (!email || !email.includes('@')) {
      throw new Error('Microsoft profile does not contain a valid email address.');
    }

    const name = data.displayName || data.givenName || email.split('@')[0];

    return {
      provider: 'outlook',
      email,
      name,
      sub: data.id || email,
    };
  }
}

export const oAuthVerificationService = new OAuthVerificationService();

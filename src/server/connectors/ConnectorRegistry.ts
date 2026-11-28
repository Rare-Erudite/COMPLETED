/**
 * RARE — Connector Registry
 *
 * Owns the catalogue of connectors, per-owner credential storage, the OAuth2
 * authorization-code flow, connection tests and action dispatch.
 *
 * Storage model: credentials and OAuth tokens live in the owner-scoped
 * persistent store under `connector_connections`. Secrets are never returned
 * by the API — only which fields are present.
 *
 * Honesty model: a connector is `connected` only after a real test() call
 * succeeded. An OAuth connector with no token is `needs_oauth`; a token
 * connector with no credentials is `needs_credentials`. Nothing is ever
 * reported as working on the strength of a static flag.
 */

import crypto from 'crypto';
import type { PersistentJsonStore } from '../storage/PersistentJsonStore.js';
import type {
  ConnectorDefinition,
  ConnectorView,
  ConnectorConnectionRecord,
  ConnectorCredentials,
  ConnectorContext,
  ConnectorTestResult,
  ConnectorActionResult,
} from './types.js';
import { fetchJson } from './http.js';
import { githubConnector } from './github.js';
import { vercelConnector } from './vercel.js';
import { supabaseConnector } from './supabase.js';
import { huggingfaceConnector } from './huggingface.js';
import { geminiConnector } from './gemini.js';
import { OAUTH_SERVICES, makeOAuthConnector } from './oauth.js';

const STATE_KEY = 'connector_connections';

/** The token-based connectors verified end-to-end against the real service. */
const TOKEN_CONNECTORS: ConnectorDefinition[] = [
  githubConnector,
  vercelConnector,
  supabaseConnector,
  huggingfaceConnector,
  geminiConnector,
];

/** All connectors: verified token connectors first, then the OAuth catalogue. */
const ALL_CONNECTORS: ConnectorDefinition[] = [
  ...TOKEN_CONNECTORS,
  ...OAUTH_SERVICES.map(makeOAuthConnector),
];

const BY_ID = new Map(ALL_CONNECTORS.map((c) => [c.id, c]));

export interface OAuthStartResult {
  ok: boolean;
  authorizeUrl?: string;
  error?: string;
  /** True when the server lacks the client id/secret env vars. */
  needsAppRegistration?: boolean;
}

export class ConnectorRegistry {
  private storage: PersistentJsonStore | undefined;
  /** Short-lived OAuth state values, keyed by state → { connectorId, ownerId, verifier }. */
  private oauthStates = new Map<string, { connectorId: string; ownerId: string; createdAt: number }>();

  attach(storage: PersistentJsonStore): void {
    this.storage = storage;
  }

  private requireStorage(): PersistentJsonStore {
    if (!this.storage) throw new Error('Connector storage is not initialised.');
    return this.storage;
  }

  list(): ConnectorDefinition[] {
    return ALL_CONNECTORS;
  }

  get(id: string): ConnectorDefinition | undefined {
    return BY_ID.get(id);
  }

  private async readAll(ownerId: string): Promise<Record<string, ConnectorConnectionRecord>> {
    return this.requireStorage().getOwnedState<Record<string, ConnectorConnectionRecord>>(
      ownerId,
      STATE_KEY,
      {},
    );
  }

  private async writeOne(ownerId: string, record: ConnectorConnectionRecord): Promise<void> {
    await this.requireStorage().updateOwnedState<Record<string, ConnectorConnectionRecord>>(
      ownerId,
      STATE_KEY,
      {},
      (current) => ({ ...current, [record.connectorId]: record }),
    );
  }

  private async removeOne(ownerId: string, connectorId: string): Promise<void> {
    await this.requireStorage().updateOwnedState<Record<string, ConnectorConnectionRecord>>(
      ownerId,
      STATE_KEY,
      {},
      (current) => {
        const next = { ...current };
        delete next[connectorId];
        return next;
      },
    );
  }

  private buildContext(ownerId: string, record?: ConnectorConnectionRecord): ConnectorContext {
    return {
      ownerId,
      credentials: (record?.credentials as ConnectorCredentials) || {},
      oauth: record?.oauth,
      fetchJson,
    };
  }

  /** The catalogue as the UI sees it, with live status per connector. */
  async catalogue(ownerId: string): Promise<ConnectorView[]> {
    const records = await this.readAll(ownerId);
    return ALL_CONNECTORS.map((def) => {
      const record = records[def.id];
      const view: ConnectorView = {
        id: def.id,
        name: def.name,
        category: def.category,
        description: def.description,
        docsUrl: def.docsUrl,
        authKind: def.authKind,
        credentialFields: def.credentialFields,
        capabilities: def.capabilities,
        status: 'not_configured',
        connected: false,
      };
      if (def.authKind === 'oauth2') {
        const oauthReady = Boolean(
          def.oauth && process.env[def.oauth.clientIdEnv] && process.env[def.oauth.clientSecretEnv],
        );
        view.oauthReady = oauthReady;
        if (record?.oauth?.accessToken) {
          view.connected = Boolean(record.connected);
          view.status = record.connected ? 'connected' : 'error';
          view.accountLabel = record.accountLabel;
          view.lastTestAt = record.lastTestAt;
          view.lastTestOk = record.lastTestOk;
          view.lastTestDetail = record.lastTestDetail;
          if (!record.connected) view.reason = record.lastTestDetail || 'Authorised but the last test failed.';
        } else {
          view.status = 'needs_oauth';
          view.reason = oauthReady
            ? 'Needs your OAuth authorisation — click Authorise to start the real flow.'
            : `Needs your OAuth authorisation. The server also needs ${def.oauth?.clientIdEnv} and ${def.oauth?.clientSecretEnv} set (register an app with ${def.name} once).`;
        }
        return view;
      }
      // Token / api-key connector.
      const present = record?.fieldsPresent || [];
      const required = def.credentialFields.filter((f) => f.required).map((f) => f.key);
      const hasAllRequired = required.every((k) => present.includes(k));
      if (record?.connected) {
        view.connected = true;
        view.status = 'connected';
        view.accountLabel = record.accountLabel;
        view.lastTestAt = record.lastTestAt;
        view.lastTestOk = record.lastTestOk;
        view.lastTestDetail = record.lastTestDetail;
      } else if (record && hasAllRequired) {
        view.status = 'error';
        view.reason = record?.lastTestDetail || 'Credentials saved but the last test failed.';
        view.lastTestAt = record?.lastTestAt;
        view.lastTestOk = record?.lastTestOk;
        view.lastTestDetail = record?.lastTestDetail;
      } else {
        view.status = 'needs_credentials';
        view.reason = `Needs ${required.join(', ')}.`;
      }
      return view;
    });
  }

  /** Save credentials (token/api-key connectors) and immediately test them. */
  async connectWithCredentials(
    ownerId: string,
    connectorId: string,
    credentials: ConnectorCredentials,
  ): Promise<{ ok: boolean; test: ConnectorTestResult; view?: ConnectorView }> {
    const def = this.get(connectorId);
    if (!def) throw new Error(`Unknown connector: ${connectorId}`);
    if (def.authKind === 'oauth2') throw new Error('This connector uses OAuth; start the OAuth flow instead.');

    const existing = (await this.readAll(ownerId))[connectorId];
    const merged: ConnectorCredentials = { ...(existing?.credentials || {}) };
    for (const field of def.credentialFields) {
      const value = credentials[field.key];
      if (typeof value === 'string' && value.trim()) merged[field.key] = value.trim();
    }
    const fieldsPresent = def.credentialFields
      .filter((f) => merged[f.key])
      .map((f) => f.key);

    const record: ConnectorConnectionRecord = {
      connectorId,
      connected: false,
      fieldsPresent,
      credentials: merged,
      connectedAt: existing?.connectedAt,
    };

    const test = await def.test(this.buildContext(ownerId, record));
    record.connected = test.ok;
    record.lastTestAt = new Date().toISOString();
    record.lastTestOk = test.ok;
    record.lastTestDetail = test.detail;
    if (test.ok) {
      record.connectedAt = record.connectedAt || new Date().toISOString();
      record.accountLabel = (test.evidence?.login as string) || (test.evidence?.username as string) || test.detail;
    }
    await this.writeOne(ownerId, record);
    const view = (await this.catalogue(ownerId)).find((v) => v.id === connectorId);
    return { ok: test.ok, test, view };
  }

  /** Re-run the connection test for a saved connector. */
  async test(ownerId: string, connectorId: string): Promise<{ ok: boolean; test: ConnectorTestResult }> {
    const def = this.get(connectorId);
    if (!def) throw new Error(`Unknown connector: ${connectorId}`);
    const record = (await this.readAll(ownerId))[connectorId];
    if (!record) return { ok: false, test: { ok: false, detail: 'Not connected yet.' } };
    const test = await def.test(this.buildContext(ownerId, record));
    record.connected = test.ok;
    record.lastTestAt = new Date().toISOString();
    record.lastTestOk = test.ok;
    record.lastTestDetail = test.detail;
    if (test.ok) {
      record.accountLabel = (test.evidence?.login as string) || (test.evidence?.username as string) || test.detail;
    }
    await this.writeOne(ownerId, record);
    return { ok: test.ok, test };
  }

  async disconnect(ownerId: string, connectorId: string): Promise<void> {
    await this.removeOne(ownerId, connectorId);
  }

  /** Dispatch a real action against the connected service. */
  async runAction(
    ownerId: string,
    connectorId: string,
    actionId: string,
    args: Record<string, unknown>,
  ): Promise<ConnectorActionResult> {
    const def = this.get(connectorId);
    if (!def) return { ok: false, action: actionId, error: `Unknown connector: ${connectorId}` };
    const record = (await this.readAll(ownerId))[connectorId];
    if (!record) return { ok: false, action: actionId, error: 'Connector is not connected.' };
    return def.action(actionId, args, this.buildContext(ownerId, record));
  }

  // ---------------------------------------------------------------------------
  // OAuth2 authorization-code flow
  // ---------------------------------------------------------------------------

  /** Build the provider authorize URL and remember the state. */
  startOAuth(ownerId: string, connectorId: string, redirectUri: string): OAuthStartResult {
    const def = this.get(connectorId);
    if (!def || def.authKind !== 'oauth2' || !def.oauth) {
      return { ok: false, error: 'This connector does not use OAuth.' };
    }
    const clientId = process.env[def.oauth.clientIdEnv];
    const clientSecret = process.env[def.oauth.clientSecretEnv];
    if (!clientId || !clientSecret) {
      return {
        ok: false,
        needsAppRegistration: true,
        error: `Register an OAuth app with ${def.name} and set ${def.oauth.clientIdEnv} and ${def.oauth.clientSecretEnv} on the server.`,
      };
    }
    const state = crypto.randomBytes(24).toString('base64url');
    this.oauthStates.set(state, { connectorId, ownerId, createdAt: Date.now() });
    // Prune old states.
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [k, v] of this.oauthStates) if (v.createdAt < cutoff) this.oauthStates.delete(k);

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
    });
    if (def.oauth.scopes.length) params.set('scope', def.oauth.scopes.join(' '));
    for (const [k, v] of Object.entries(def.oauth.extraAuthParams || {})) params.set(k, v);
    return { ok: true, authorizeUrl: `${def.oauth.authorizeUrl}?${params.toString()}` };
  }

  /** Exchange the authorization code for tokens and test the connection. */
  async completeOAuth(
    ownerId: string,
    connectorId: string,
    code: string,
    state: string,
    redirectUri: string,
  ): Promise<{ ok: boolean; test?: ConnectorTestResult; error?: string }> {
    const def = this.get(connectorId);
    if (!def || def.authKind !== 'oauth2' || !def.oauth) return { ok: false, error: 'Not an OAuth connector.' };
    const pending = this.oauthStates.get(state);
    if (!pending || pending.connectorId !== connectorId || pending.ownerId !== ownerId) {
      return { ok: false, error: 'Invalid or expired OAuth state. Start the flow again.' };
    }
    this.oauthStates.delete(state);

    const clientId = process.env[def.oauth.clientIdEnv];
    const clientSecret = process.env[def.oauth.clientSecretEnv];
    if (!clientId || !clientSecret) return { ok: false, error: 'OAuth app credentials are not configured.' };

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    });
    const tokenRes = await fetchJson<any>(def.oauth.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
    });
    if (!tokenRes.ok || !tokenRes.data?.access_token) {
      return { ok: false, error: `Token exchange failed: HTTP ${tokenRes.status} ${tokenRes.text.slice(0, 200)}` };
    }
    const record: ConnectorConnectionRecord = {
      connectorId,
      connected: false,
      fieldsPresent: [],
      oauth: {
        accessToken: tokenRes.data.access_token,
        refreshToken: tokenRes.data.refresh_token,
        expiresAt: tokenRes.data.expires_in ? Date.now() + tokenRes.data.expires_in * 1000 : undefined,
        scope: tokenRes.data.scope,
        tokenType: tokenRes.data.token_type,
      },
    };
    const test = await def.test(this.buildContext(ownerId, record));
    record.connected = test.ok;
    record.lastTestAt = new Date().toISOString();
    record.lastTestOk = test.ok;
    record.lastTestDetail = test.detail;
    if (test.ok) {
      record.connectedAt = new Date().toISOString();
      record.accountLabel = (test.evidence?.account as string) || test.detail;
    }
    await this.writeOne(ownerId, record);
    return { ok: test.ok, test };
  }

  /** Summary counts for the Plugins badge. */
  async summary(ownerId: string): Promise<{
    total: number;
    connected: number;
    needsOAuth: number;
    needsCredentials: number;
    verifiedTokenConnectors: number;
  }> {
    const views = await this.catalogue(ownerId);
    return {
      total: views.length,
      connected: views.filter((v) => v.connected).length,
      needsOAuth: views.filter((v) => v.status === 'needs_oauth').length,
      needsCredentials: views.filter((v) => v.status === 'needs_credentials').length,
      verifiedTokenConnectors: TOKEN_CONNECTORS.length,
    };
  }
}

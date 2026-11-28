/**
 * RARE — Connector Framework: types
 *
 * A "connector" is a real app or service RARE can be connected to — GitHub,
 * Gmail, Slack, Notion, Supabase, Vercel, Hugging Face, Gemini, and so on.
 * This is deliberately NOT the MCP tool-server model: an MCP server is a
 * protocol endpoint that exposes tools, whereas a connector is an identity
 * (an account) plus an auth method plus a set of real actions that call that
 * service's own public API.
 *
 * The contract every connector must satisfy:
 *   - identity:      who/what it connects to (id, name, category, docs URL)
 *   - auth:          how it authenticates (token, api-key, oauth2, none)
 *   - test():        a real call that proves the credential works
 *   - capabilities:  the actions it can actually perform
 *   - action():      dispatch a named action against the real service
 *
 * A connector is only ever reported as `connected` when a real test() call
 * succeeded. Nothing here claims a service works when it does not.
 */

export type ConnectorAuthKind = 'token' | 'api-key' | 'oauth2' | 'basic' | 'none';

export type ConnectorCategory =
  | 'dev'
  | 'cloud'
  | 'data'
  | 'ai'
  | 'productivity'
  | 'communication'
  | 'media'
  | 'finance'
  | 'automation'
  | 'search'
  | 'storage'
  | 'observability'
  | 'commerce'
  | 'other';

/** One credential field a connector needs from the user. */
export interface ConnectorCredentialField {
  key: string;
  label: string;
  /** Never echo a secret back to the client. */
  secret: boolean;
  required: boolean;
  placeholder?: string;
  help?: string;
}

/** A single action a connector can perform against the real service. */
export interface ConnectorActionDef {
  id: string;
  name: string;
  description: string;
  /** JSON-schema-ish description of the arguments, for the UI to render. */
  params?: Array<{
    key: string;
    label: string;
    type: 'string' | 'number' | 'boolean' | 'json';
    required: boolean;
    placeholder?: string;
  }>;
  /** True when the action changes remote state (write). */
  mutating?: boolean;
}

export interface ConnectorTestResult {
  ok: boolean;
  /** Human-readable proof, e.g. "Authenticated as Rare-Erudite (id 324266131)". */
  detail: string;
  /** Optional structured evidence (account name, counts, latency). */
  evidence?: Record<string, unknown>;
  latencyMs?: number;
  /** HTTP status of the proving call, when there was one. */
  httpStatus?: number;
}

export interface ConnectorActionResult {
  ok: boolean;
  action: string;
  data?: unknown;
  error?: string;
  httpStatus?: number;
  latencyMs?: number;
}

/** Stored credential material for one connector, per owner. */
export interface ConnectorCredentials {
  [fieldKey: string]: string;
}

/** Persisted connection record (never contains the raw secret in API output). */
export interface ConnectorConnectionRecord {
  connectorId: string;
  connected: boolean;
  /** Which credential fields are present (values are never returned). */
  fieldsPresent: string[];
  /** Stored credential values. Never serialised to the client. */
  credentials?: ConnectorCredentials;
  /** Account identity discovered by the last successful test. */
  accountLabel?: string;
  connectedAt?: string;
  lastTestAt?: string;
  lastTestOk?: boolean;
  lastTestDetail?: string;
  /** OAuth state, when the connector uses OAuth. */
  oauth?: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    scope?: string;
    tokenType?: string;
  };
}

/** The runtime context handed to a connector's test/action implementation. */
export interface ConnectorContext {
  credentials: ConnectorCredentials;
  oauth?: ConnectorConnectionRecord['oauth'];
  /** Owner id, for connectors that need to scope storage. */
  ownerId: string;
  /** Fetch with a timeout, so a hung service cannot hang the request. */
  fetchJson: <T = unknown>(
    url: string,
    init?: RequestInit & { timeoutMs?: number },
  ) => Promise<{ ok: boolean; status: number; data: T | null; text: string }>;
}

/**
 * The interface every connector implements. `test` and `action` are real
 * network calls — there is no simulation path.
 */
export interface ConnectorDefinition {
  id: string;
  name: string;
  category: ConnectorCategory;
  description: string;
  /** Where a user gets credentials / authorises the app. */
  docsUrl: string;
  authKind: ConnectorAuthKind;
  /** Credential fields for token/api-key/basic connectors. */
  credentialFields: ConnectorCredentialField[];
  /** OAuth configuration, when authKind === 'oauth2'. */
  oauth?: {
    authorizeUrl: string;
    tokenUrl: string;
    scopes: string[];
    /** Env var names holding the client id/secret. */
    clientIdEnv: string;
    clientSecretEnv: string;
    /** Extra authorize params (e.g. access_type=offline). */
    extraAuthParams?: Record<string, string>;
  };
  capabilities: ConnectorActionDef[];
  /** Real connection test. Must make a genuine call to the service. */
  test: (ctx: ConnectorContext) => Promise<ConnectorTestResult>;
  /** Real action dispatch. */
  action: (
    actionId: string,
    args: Record<string, unknown>,
    ctx: ConnectorContext,
  ) => Promise<ConnectorActionResult>;
}

/** What the API returns for one connector in the catalogue. */
export interface ConnectorView {
  id: string;
  name: string;
  category: ConnectorCategory;
  description: string;
  docsUrl: string;
  authKind: ConnectorAuthKind;
  credentialFields: Array<Omit<ConnectorCredentialField, 'secret'> & { secret: boolean }>;
  capabilities: ConnectorActionDef[];
  /** Live state. */
  status: 'connected' | 'needs_credentials' | 'needs_oauth' | 'error' | 'not_configured';
  connected: boolean;
  accountLabel?: string;
  lastTestAt?: string;
  lastTestOk?: boolean;
  lastTestDetail?: string;
  /** True when the server has the OAuth client id/secret to start a flow. */
  oauthReady?: boolean;
  /** Why it is not connected, when it is not. */
  reason?: string;
}

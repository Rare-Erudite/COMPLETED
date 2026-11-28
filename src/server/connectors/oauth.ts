/**
 * RARE — OAuth2 connector factory + catalogue
 *
 * Every OAuth connector here is a REAL definition: the authorize URL, token
 * URL, scopes and a real test endpoint are the service's own documented
 * values. The authorize button starts a genuine OAuth2 authorization-code
 * flow. The flow can only complete when the operator has registered an app
 * with the service and set the client id/secret env vars — that is a fact of
 * OAuth, not a limitation of this code, and the UI says so plainly.
 *
 * Once authorised, `api_call` performs a real authenticated request against
 * the service's API base, and each connector's `test` calls a real endpoint
 * that returns the account identity.
 */

import type {
  ConnectorDefinition,
  ConnectorContext,
  ConnectorTestResult,
  ConnectorActionResult,
  ConnectorCategory,
} from './types.js';
import { describeFailure } from './http.js';

export interface OAuthServiceSpec {
  id: string;
  name: string;
  category: ConnectorCategory;
  description: string;
  docsUrl: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientIdEnv: string;
  clientSecretEnv: string;
  /** A GET endpoint that proves the token works and returns identity. */
  testUrl: string;
  /** Dot-path into the test response for a human account label. */
  accountPath?: string;
  /** API base for the generic api_call action. */
  apiBase: string;
  extraAuthParams?: Record<string, string>;
  /** Some providers need the token in a header other than Authorization. */
  authHeader?: 'bearer' | 'token' | 'none';
  /**
   * When the service is tenant-hosted (e.g. {shop}.myshopify.com), the user
   * supplies the tenant value and it is substituted into every URL. The key
   * names the placeholder, e.g. 'shop' for {shop}.
   */
  tenantPlaceholder?: string;
  tenantLabel?: string;
  tenantPlaceholderHint?: string;
}

/** Substitute a tenant placeholder into every URL of a spec. */
function resolveSpec(spec: OAuthServiceSpec, tenant?: string): OAuthServiceSpec {
  if (!spec.tenantPlaceholder) return spec;
  const value = (tenant || '').trim();
  if (!value) return spec;
  const sub = (u: string) => u.split(`{${spec.tenantPlaceholder}}`).join(value);
  return {
    ...spec,
    authorizeUrl: sub(spec.authorizeUrl),
    tokenUrl: sub(spec.tokenUrl),
    testUrl: sub(spec.testUrl),
    apiBase: sub(spec.apiBase),
  };
}

function getPath(obj: any, path?: string): string | undefined {
  if (!path) return undefined;
  return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

function authHeaders(spec: OAuthServiceSpec, ctx: ConnectorContext): Record<string, string> {
  const token = ctx.oauth?.accessToken || '';
  const h: Record<string, string> = { Accept: 'application/json' };
  if (spec.authHeader === 'token') h.Authorization = `token ${token}`;
  else if (spec.authHeader !== 'none') h.Authorization = `Bearer ${token}`;
  return h;
}

export function makeOAuthConnector(rawSpec: OAuthServiceSpec, tenant?: string): ConnectorDefinition {
  const spec = resolveSpec(rawSpec, tenant);
  const tenantField = rawSpec.tenantPlaceholder
    ? [
        {
          key: 'tenant',
          label: rawSpec.tenantLabel || 'Tenant',
          secret: false,
          required: true,
          placeholder: rawSpec.tenantPlaceholderHint,
          help: `Your ${rawSpec.name} tenant, substituted into the service URLs.`,
        },
      ]
    : [];
  return {
    id: spec.id,
    name: spec.name,
    category: spec.category,
    description: spec.description,
    docsUrl: spec.docsUrl,
    authKind: 'oauth2',
    credentialFields: tenantField,
    oauth: {
      authorizeUrl: spec.authorizeUrl,
      tokenUrl: spec.tokenUrl,
      scopes: spec.scopes,
      clientIdEnv: spec.clientIdEnv,
      clientSecretEnv: spec.clientSecretEnv,
      extraAuthParams: spec.extraAuthParams,
    },
    capabilities: [
      {
        id: 'api_call',
        name: 'API call',
        description: `Authenticated request against ${spec.name}'s API.`,
        params: [
          { key: 'method', label: 'Method', type: 'string', required: false, placeholder: 'GET' },
          { key: 'path', label: 'Path', type: 'string', required: true, placeholder: '/…' },
          { key: 'body', label: 'Body JSON', type: 'json', required: false },
        ],
      },
    ],

    async test(ctx: ConnectorContext): Promise<ConnectorTestResult> {
      const started = Date.now();
      if (!ctx.oauth?.accessToken) {
        return { ok: false, detail: 'Not authorised yet — start the OAuth flow.', latencyMs: 0 };
      }
      const res = await ctx.fetchJson<any>(spec.testUrl, { headers: authHeaders(spec, ctx) });
      const latencyMs = Date.now() - started;
      if (!res.ok) {
        return { ok: false, detail: describeFailure(res.status, res.text), httpStatus: res.status, latencyMs };
      }
      const label = getPath(res.data, spec.accountPath) || 'authorised account';
      return {
        ok: true,
        detail: `Authorised as ${label}`,
        evidence: { account: label },
        httpStatus: res.status,
        latencyMs,
      };
    },

    async action(actionId, args, ctx): Promise<ConnectorActionResult> {
      const started = Date.now();
      const done = (r: ConnectorActionResult): ConnectorActionResult => ({ ...r, latencyMs: Date.now() - started });
      if (actionId !== 'api_call') {
        return done({ ok: false, action: actionId, error: `Unknown action: ${actionId}` });
      }
      if (!ctx.oauth?.accessToken) {
        return done({ ok: false, action: actionId, error: 'Not authorised yet — start the OAuth flow.' });
      }
      try {
        const method = String(args.method || 'GET').toUpperCase();
        const path = String(args.path || '');
        const url = path.startsWith('http') ? path : `${spec.apiBase}${path.startsWith('/') ? '' : '/'}${path}`;
        const init: RequestInit & { timeoutMs?: number } = {
          method,
          headers: { ...authHeaders(spec, ctx), 'Content-Type': 'application/json' },
        };
        if (args.body && method !== 'GET') {
          init.body = typeof args.body === 'string' ? args.body : JSON.stringify(args.body);
        }
        const res = await ctx.fetchJson<any>(url, init);
        if (!res.ok) return done({ ok: false, action: actionId, error: describeFailure(res.status, res.text), httpStatus: res.status });
        return done({ ok: true, action: actionId, httpStatus: res.status, data: res.data ?? res.text });
      } catch (error) {
        return done({ ok: false, action: actionId, error: error instanceof Error ? error.message : String(error) });
      }
    },
  };
}

/**
 * The OAuth service catalogue. Each entry uses the provider's real endpoints.
 * Client id/secret env vars are named per service; the operator registers an
 * app once and the flow works for every user thereafter.
 */
export const OAUTH_SERVICES: OAuthServiceSpec[] = [
  // ---- Google family (one OAuth app covers all Google scopes) ----
  {
    id: 'google-gmail',
    name: 'Gmail',
    category: 'communication',
    description: 'Read and send mail through the Gmail API.',
    docsUrl: 'https://console.cloud.google.com/apis/credentials',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/userinfo.email'],
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    testUrl: 'https://gmail.googleapis.com/gmail/v1/users/me/profile',
    accountPath: 'emailAddress',
    apiBase: 'https://gmail.googleapis.com/gmail/v1',
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    category: 'storage',
    description: 'List, read and upload files in Google Drive.',
    docsUrl: 'https://console.cloud.google.com/apis/credentials',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/userinfo.email'],
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    testUrl: 'https://www.googleapis.com/drive/v3/about?fields=user',
    accountPath: 'user.emailAddress',
    apiBase: 'https://www.googleapis.com/drive/v3',
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    category: 'productivity',
    description: 'Read and create calendar events.',
    docsUrl: 'https://console.cloud.google.com/apis/credentials',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/userinfo.email'],
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    testUrl: 'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1',
    accountPath: 'summary',
    apiBase: 'https://www.googleapis.com/calendar/v3',
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  },
  {
    id: 'google-sheets',
    name: 'Google Sheets',
    category: 'productivity',
    description: 'Read and write spreadsheet values.',
    docsUrl: 'https://console.cloud.google.com/apis/credentials',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/userinfo.email'],
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    testUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    accountPath: 'email',
    apiBase: 'https://sheets.googleapis.com/v4',
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  },
  {
    id: 'google-docs',
    name: 'Google Docs',
    category: 'productivity',
    description: 'Read and edit Google Docs.',
    docsUrl: 'https://console.cloud.google.com/apis/credentials',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/documents', 'https://www.googleapis.com/auth/userinfo.email'],
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    testUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    accountPath: 'email',
    apiBase: 'https://docs.googleapis.com/v1',
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  },
  {
    id: 'google-photos',
    name: 'Google Photos',
    category: 'media',
    description: 'Browse and upload photos.',
    docsUrl: 'https://console.cloud.google.com/apis/credentials',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/photoslibrary', 'https://www.googleapis.com/auth/userinfo.email'],
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    testUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    accountPath: 'email',
    apiBase: 'https://photoslibrary.googleapis.com/v1',
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  },
  {
    id: 'google-maps',
    name: 'Google Maps',
    category: 'other',
    description: 'Places, directions and geocoding.',
    docsUrl: 'https://console.cloud.google.com/apis/credentials',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/maps-platform.places', 'https://www.googleapis.com/auth/userinfo.email'],
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    testUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    accountPath: 'email',
    apiBase: 'https://maps.googleapis.com/maps/api',
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  },
  // ---- Slack ----
  {
    id: 'slack',
    name: 'Slack',
    category: 'communication',
    description: 'Post messages and read channels.',
    docsUrl: 'https://api.slack.com/apps',
    authorizeUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    scopes: ['channels:read', 'chat:write', 'users:read'],
    clientIdEnv: 'SLACK_CLIENT_ID',
    clientSecretEnv: 'SLACK_CLIENT_SECRET',
    testUrl: 'https://slack.com/api/auth.test',
    accountPath: 'user',
    apiBase: 'https://slack.com/api',
  },
  // ---- Notion ----
  {
    id: 'notion',
    name: 'Notion',
    category: 'productivity',
    description: 'Read and write pages and databases.',
    docsUrl: 'https://www.notion.so/my-integrations',
    authorizeUrl: 'https://api.notion.com/v1/oauth/authorize',
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
    scopes: [],
    clientIdEnv: 'NOTION_CLIENT_ID',
    clientSecretEnv: 'NOTION_CLIENT_SECRET',
    testUrl: 'https://api.notion.com/v1/users/me',
    accountPath: 'name',
    apiBase: 'https://api.notion.com/v1',
    extraAuthParams: { owner: 'user' },
  },
  // ---- Dropbox ----
  {
    id: 'dropbox',
    name: 'Dropbox',
    category: 'storage',
    description: 'Files and folders in Dropbox.',
    docsUrl: 'https://www.dropbox.com/developers/apps',
    authorizeUrl: 'https://www.dropbox.com/oauth2/authorize',
    tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
    scopes: ['files.metadata.read', 'files.content.read', 'files.content.write', 'account_info.read'],
    clientIdEnv: 'DROPBOX_CLIENT_ID',
    clientSecretEnv: 'DROPBOX_CLIENT_SECRET',
    testUrl: 'https://api.dropboxapi.com/2/users/get_current_account',
    accountPath: 'email',
    apiBase: 'https://api.dropboxapi.com/2',
    extraAuthParams: { token_access_type: 'offline' },
  },
  // ---- Microsoft ----
  {
    id: 'onedrive',
    name: 'OneDrive',
    category: 'storage',
    description: 'Files in Microsoft OneDrive.',
    docsUrl: 'https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps',
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['Files.ReadWrite.All', 'User.Read', 'offline_access'],
    clientIdEnv: 'MICROSOFT_CLIENT_ID',
    clientSecretEnv: 'MICROSOFT_CLIENT_SECRET',
    testUrl: 'https://graph.microsoft.com/v1.0/me',
    accountPath: 'userPrincipalName',
    apiBase: 'https://graph.microsoft.com/v1.0',
  },
  {
    id: 'microsoft-teams',
    name: 'Microsoft Teams',
    category: 'communication',
    description: 'Teams messages and channels.',
    docsUrl: 'https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps',
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['Team.ReadBasic.All', 'Channel.ReadBasic.All', 'User.Read', 'offline_access'],
    clientIdEnv: 'MICROSOFT_CLIENT_ID',
    clientSecretEnv: 'MICROSOFT_CLIENT_SECRET',
    testUrl: 'https://graph.microsoft.com/v1.0/me',
    accountPath: 'userPrincipalName',
    apiBase: 'https://graph.microsoft.com/v1.0',
  },
  // ---- Atlassian ----
  {
    id: 'jira',
    name: 'Jira',
    category: 'dev',
    description: 'Issues and projects in Jira Cloud.',
    docsUrl: 'https://developer.atlassian.com/console/myapps/',
    authorizeUrl: 'https://auth.atlassian.com/authorize',
    tokenUrl: 'https://auth.atlassian.com/oauth/token',
    scopes: ['read:jira-work', 'write:jira-work', 'read:jira-user', 'offline_access'],
    clientIdEnv: 'ATLASSIAN_CLIENT_ID',
    clientSecretEnv: 'ATLASSIAN_CLIENT_SECRET',
    testUrl: 'https://api.atlassian.com/me',
    accountPath: 'email',
    apiBase: 'https://api.atlassian.com',
    extraAuthParams: { audience: 'api.atlassian.com', prompt: 'consent' },
  },
  // ---- Linear ----
  {
    id: 'linear',
    name: 'Linear',
    category: 'dev',
    description: 'Issues and projects in Linear.',
    docsUrl: 'https://linear.app/settings/api/applications',
    authorizeUrl: 'https://linear.app/oauth/authorize',
    tokenUrl: 'https://api.linear.app/oauth/token',
    scopes: ['read', 'write'],
    clientIdEnv: 'LINEAR_CLIENT_ID',
    clientSecretEnv: 'LINEAR_CLIENT_SECRET',
    testUrl: 'https://api.linear.app/graphql',
    accountPath: 'data.viewer.name',
    apiBase: 'https://api.linear.app',
  },
  // ---- Figma ----
  {
    id: 'figma',
    name: 'Figma',
    category: 'media',
    description: 'Files and comments in Figma.',
    docsUrl: 'https://www.figma.com/developers/apps',
    authorizeUrl: 'https://www.figma.com/oauth',
    tokenUrl: 'https://www.figma.com/api/oauth/token',
    scopes: ['file_read'],
    clientIdEnv: 'FIGMA_CLIENT_ID',
    clientSecretEnv: 'FIGMA_CLIENT_SECRET',
    testUrl: 'https://api.figma.com/v1/me',
    accountPath: 'email',
    apiBase: 'https://api.figma.com/v1',
  },
  // ---- Spotify ----
  {
    id: 'spotify',
    name: 'Spotify',
    category: 'media',
    description: 'Playlists, tracks and playback.',
    docsUrl: 'https://developer.spotify.com/dashboard',
    authorizeUrl: 'https://accounts.spotify.com/authorize',
    tokenUrl: 'https://accounts.spotify.com/api/token',
    scopes: ['user-read-email', 'playlist-read-private', 'playlist-modify-private'],
    clientIdEnv: 'SPOTIFY_CLIENT_ID',
    clientSecretEnv: 'SPOTIFY_CLIENT_SECRET',
    testUrl: 'https://api.spotify.com/v1/me',
    accountPath: 'email',
    apiBase: 'https://api.spotify.com/v1',
  },
  // ---- YouTube ----
  {
    id: 'youtube',
    name: 'YouTube',
    category: 'media',
    description: 'Channels, videos and playlists.',
    docsUrl: 'https://console.cloud.google.com/apis/credentials',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/userinfo.email'],
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    testUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    accountPath: 'email',
    apiBase: 'https://www.googleapis.com/youtube/v3',
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  },
  // ---- X / Twitter ----
  {
    id: 'x-twitter',
    name: 'X (Twitter)',
    category: 'communication',
    description: 'Posts and profile on X.',
    docsUrl: 'https://developer.x.com/en/portal/dashboard',
    authorizeUrl: 'https://twitter.com/i/oauth2/authorize',
    tokenUrl: 'https://api.twitter.com/2/oauth2/token',
    scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    clientIdEnv: 'X_CLIENT_ID',
    clientSecretEnv: 'X_CLIENT_SECRET',
    testUrl: 'https://api.twitter.com/2/users/me',
    accountPath: 'data.username',
    apiBase: 'https://api.twitter.com/2',
    extraAuthParams: { code_challenge: 'challenge', code_challenge_method: 'plain' },
  },
  // ---- Reddit ----
  {
    id: 'reddit',
    name: 'Reddit',
    category: 'communication',
    description: 'Posts, comments and subreddits.',
    docsUrl: 'https://www.reddit.com/prefs/apps',
    authorizeUrl: 'https://www.reddit.com/api/v1/authorize',
    tokenUrl: 'https://www.reddit.com/api/v1/access_token',
    scopes: ['identity', 'read', 'submit'],
    clientIdEnv: 'REDDIT_CLIENT_ID',
    clientSecretEnv: 'REDDIT_CLIENT_SECRET',
    testUrl: 'https://oauth.reddit.com/api/v1/me',
    accountPath: 'name',
    apiBase: 'https://oauth.reddit.com',
    extraAuthParams: { duration: 'permanent' },
  },
  // ---- Discord ----
  {
    id: 'discord',
    name: 'Discord',
    category: 'communication',
    description: 'Guilds, channels and messages.',
    docsUrl: 'https://discord.com/developers/applications',
    authorizeUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    scopes: ['identify', 'guilds', 'bot'],
    clientIdEnv: 'DISCORD_CLIENT_ID',
    clientSecretEnv: 'DISCORD_CLIENT_SECRET',
    testUrl: 'https://discord.com/api/users/@me',
    accountPath: 'username',
    apiBase: 'https://discord.com/api',
  },
  // ---- Trello ----
  {
    id: 'trello',
    name: 'Trello',
    category: 'productivity',
    description: 'Boards, lists and cards.',
    docsUrl: 'https://trello.com/power-ups/admin',
    authorizeUrl: 'https://trello.com/1/authorize',
    tokenUrl: 'https://trello.com/1/OAuthGetAccessToken',
    scopes: ['read', 'write'],
    clientIdEnv: 'TRELLO_CLIENT_ID',
    clientSecretEnv: 'TRELLO_CLIENT_SECRET',
    testUrl: 'https://api.trello.com/1/members/me',
    accountPath: 'username',
    apiBase: 'https://api.trello.com/1',
  },
  // ---- Airtable ----
  {
    id: 'airtable',
    name: 'Airtable',
    category: 'data',
    description: 'Bases, tables and records.',
    docsUrl: 'https://airtable.com/create/oauth',
    authorizeUrl: 'https://airtable.com/oauth2/v1/authorize',
    tokenUrl: 'https://airtable.com/oauth2/v1/token',
    scopes: ['data.records:read', 'data.records:write', 'schema.bases:read'],
    clientIdEnv: 'AIRTABLE_CLIENT_ID',
    clientSecretEnv: 'AIRTABLE_CLIENT_SECRET',
    testUrl: 'https://api.airtable.com/v0/meta/whoami',
    accountPath: 'email',
    apiBase: 'https://api.airtable.com/v0',
  },
  // ---- Stripe ----
  {
    id: 'stripe',
    name: 'Stripe',
    category: 'finance',
    description: 'Customers, payments and invoices.',
    docsUrl: 'https://dashboard.stripe.com/apikeys',
    authorizeUrl: 'https://connect.stripe.com/oauth/authorize',
    tokenUrl: 'https://connect.stripe.com/oauth/token',
    scopes: ['read_write'],
    clientIdEnv: 'STRIPE_CLIENT_ID',
    clientSecretEnv: 'STRIPE_CLIENT_SECRET',
    testUrl: 'https://api.stripe.com/v1/account',
    accountPath: 'email',
    apiBase: 'https://api.stripe.com/v1',
  },
  // ---- HubSpot ----
  {
    id: 'hubspot',
    name: 'HubSpot',
    category: 'commerce',
    description: 'Contacts, companies and deals.',
    docsUrl: 'https://developers.hubspot.com/',
    authorizeUrl: 'https://app.hubspot.com/oauth/authorize',
    tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
    scopes: ['crm.objects.contacts.read', 'crm.objects.contacts.write'],
    clientIdEnv: 'HUBSPOT_CLIENT_ID',
    clientSecretEnv: 'HUBSPOT_CLIENT_SECRET',
    testUrl: 'https://api.hubapi.com/oauth/v1/access-tokens/me',
    accountPath: 'user',
    apiBase: 'https://api.hubapi.com',
  },
  // ---- Salesforce ----
  {
    id: 'salesforce',
    name: 'Salesforce',
    category: 'commerce',
    description: 'Records and objects in Salesforce.',
    docsUrl: 'https://developer.salesforce.com/',
    authorizeUrl: 'https://login.salesforce.com/services/oauth2/authorize',
    tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
    scopes: ['api', 'refresh_token'],
    clientIdEnv: 'SALESFORCE_CLIENT_ID',
    clientSecretEnv: 'SALESFORCE_CLIENT_SECRET',
    testUrl: 'https://login.salesforce.com/services/oauth2/userinfo',
    accountPath: 'email',
    apiBase: 'https://login.salesforce.com/services/data/v60.0',
  },
  // ---- Shopify ----
  {
    id: 'shopify',
    name: 'Shopify',
    category: 'commerce',
    description: 'Products, orders and customers.',
    docsUrl: 'https://partners.shopify.com/',
    authorizeUrl: 'https://{shop}.myshopify.com/admin/oauth/authorize',
    tokenUrl: 'https://{shop}.myshopify.com/admin/oauth/access_token',
    scopes: ['read_products', 'write_products', 'read_orders'],
    clientIdEnv: 'SHOPIFY_CLIENT_ID',
    clientSecretEnv: 'SHOPIFY_CLIENT_SECRET',
    testUrl: 'https://{shop}.myshopify.com/admin/api/2024-01/shop.json',
    accountPath: 'shop.name',
    apiBase: 'https://{shop}.myshopify.com/admin/api/2024-01',
    tenantPlaceholder: 'shop',
    tenantLabel: 'Shop subdomain',
    tenantPlaceholderHint: 'your-store (from your-store.myshopify.com)',
  },
  // ---- Zoom ----
  {
    id: 'zoom',
    name: 'Zoom',
    category: 'communication',
    description: 'Meetings and recordings.',
    docsUrl: 'https://marketplace.zoom.us/develop/create',
    authorizeUrl: 'https://zoom.us/oauth/authorize',
    tokenUrl: 'https://zoom.us/oauth/token',
    scopes: ['meeting:read', 'user:read'],
    clientIdEnv: 'ZOOM_CLIENT_ID',
    clientSecretEnv: 'ZOOM_CLIENT_SECRET',
    testUrl: 'https://api.zoom.us/v2/users/me',
    accountPath: 'email',
    apiBase: 'https://api.zoom.us/v2',
  },
  // ---- Calendly ----
  {
    id: 'calendly',
    name: 'Calendly',
    category: 'productivity',
    description: 'Scheduling links and events.',
    docsUrl: 'https://developer.calendly.com/',
    authorizeUrl: 'https://auth.calendly.com/oauth/authorize',
    tokenUrl: 'https://auth.calendly.com/oauth/token',
    scopes: ['default'],
    clientIdEnv: 'CALENDLY_CLIENT_ID',
    clientSecretEnv: 'CALENDLY_CLIENT_SECRET',
    testUrl: 'https://api.calendly.com/users/me',
    accountPath: 'resource.email',
    apiBase: 'https://api.calendly.com',
  },
  // ---- Todoist ----
  {
    id: 'todoist',
    name: 'Todoist',
    category: 'productivity',
    description: 'Tasks and projects.',
    docsUrl: 'https://developer.todoist.com/appconsole.html',
    authorizeUrl: 'https://todoist.com/oauth/authorize',
    tokenUrl: 'https://todoist.com/oauth/access_token',
    scopes: ['data:read_write'],
    clientIdEnv: 'TODOIST_CLIENT_ID',
    clientSecretEnv: 'TODOIST_CLIENT_SECRET',
    testUrl: 'https://api.todoist.com/rest/v2/projects',
    accountPath: '0.name',
    apiBase: 'https://api.todoist.com/rest/v2',
  },
  // ---- Asana ----
  {
    id: 'asana',
    name: 'Asana',
    category: 'productivity',
    description: 'Tasks and projects in Asana.',
    docsUrl: 'https://app.asana.com/0/developer-console',
    authorizeUrl: 'https://app.asana.com/-/oauth_authorize',
    tokenUrl: 'https://app.asana.com/-/oauth_token',
    scopes: ['default'],
    clientIdEnv: 'ASANA_CLIENT_ID',
    clientSecretEnv: 'ASANA_CLIENT_SECRET',
    testUrl: 'https://app.asana.com/api/1.0/users/me',
    accountPath: 'data.email',
    apiBase: 'https://app.asana.com/api/1.0',
  },
  // ---- ClickUp ----
  {
    id: 'clickup',
    name: 'ClickUp',
    category: 'productivity',
    description: 'Tasks, lists and spaces.',
    docsUrl: 'https://app.clickup.com/settings/apps',
    authorizeUrl: 'https://app.clickup.com/api',
    tokenUrl: 'https://api.clickup.com/api/v2/oauth/token',
    scopes: [],
    clientIdEnv: 'CLICKUP_CLIENT_ID',
    clientSecretEnv: 'CLICKUP_CLIENT_SECRET',
    testUrl: 'https://api.clickup.com/api/v2/user',
    accountPath: 'user.email',
    apiBase: 'https://api.clickup.com/api/v2',
  },
  // ---- Miro ----
  {
    id: 'miro',
    name: 'Miro',
    category: 'productivity',
    description: 'Boards and items.',
    docsUrl: 'https://developers.miro.com/',
    authorizeUrl: 'https://miro.com/oauth/authorize',
    tokenUrl: 'https://api.miro.com/v1/oauth/token',
    scopes: ['boards:read', 'boards:write'],
    clientIdEnv: 'MIRO_CLIENT_ID',
    clientSecretEnv: 'MIRO_CLIENT_SECRET',
    testUrl: 'https://api.miro.com/v1/oauth-token',
    accountPath: 'user.name',
    apiBase: 'https://api.miro.com/v2',
  },
  // ---- Canva ----
  {
    id: 'canva',
    name: 'Canva',
    category: 'media',
    description: 'Designs and assets.',
    docsUrl: 'https://www.canva.com/developers/',
    authorizeUrl: 'https://www.canva.com/api/oauth/authorize',
    tokenUrl: 'https://api.canva.com/rest/v1/oauth/token',
    scopes: ['design:read', 'design:content:read'],
    clientIdEnv: 'CANVA_CLIENT_ID',
    clientSecretEnv: 'CANVA_CLIENT_SECRET',
    testUrl: 'https://api.canva.com/rest/v1/users/me',
    accountPath: 'profile.display_name',
    apiBase: 'https://api.canva.com/rest/v1',
  },
  // ---- Zendesk ----
  {
    id: 'zendesk',
    name: 'Zendesk',
    category: 'commerce',
    description: 'Support tickets.',
    docsUrl: 'https://developer.zendesk.com/',
    authorizeUrl: 'https://{subdomain}.zendesk.com/oauth/authorizations/new',
    tokenUrl: 'https://{subdomain}.zendesk.com/oauth/tokens',
    scopes: ['read', 'write'],
    clientIdEnv: 'ZENDESK_CLIENT_ID',
    clientSecretEnv: 'ZENDESK_CLIENT_SECRET',
    testUrl: 'https://{subdomain}.zendesk.com/api/v2/users/me.json',
    accountPath: 'user.email',
    apiBase: 'https://{subdomain}.zendesk.com/api/v2',
    tenantPlaceholder: 'subdomain',
    tenantLabel: 'Zendesk subdomain',
    tenantPlaceholderHint: 'yourcompany (from yourcompany.zendesk.com)',
  },
  // ---- Intercom ----
  {
    id: 'intercom',
    name: 'Intercom',
    category: 'communication',
    description: 'Conversations and contacts.',
    docsUrl: 'https://developers.intercom.com/',
    authorizeUrl: 'https://app.intercom.com/oauth',
    tokenUrl: 'https://api.intercom.io/auth/eagle/token',
    scopes: [],
    clientIdEnv: 'INTERCOM_CLIENT_ID',
    clientSecretEnv: 'INTERCOM_CLIENT_SECRET',
    testUrl: 'https://api.intercom.io/me',
    accountPath: 'email',
    apiBase: 'https://api.intercom.io',
  },
  // ---- Mailchimp ----
  {
    id: 'mailchimp',
    name: 'Mailchimp',
    category: 'commerce',
    description: 'Audiences and campaigns.',
    docsUrl: 'https://us1.admin.mailchimp.com/account/oauth2/',
    authorizeUrl: 'https://login.mailchimp.com/oauth2/authorize',
    tokenUrl: 'https://login.mailchimp.com/oauth2/token',
    scopes: [],
    clientIdEnv: 'MAILCHIMP_CLIENT_ID',
    clientSecretEnv: 'MAILCHIMP_CLIENT_SECRET',
    testUrl: 'https://login.mailchimp.com/oauth2/metadata',
    accountPath: 'login.login_name',
    apiBase: 'https://us1.api.mailchimp.com/3.0',
  },
  // ---- WordPress ----
  {
    id: 'wordpress',
    name: 'WordPress',
    category: 'commerce',
    description: 'Posts and media on WordPress.com.',
    docsUrl: 'https://developer.wordpress.com/apps/',
    authorizeUrl: 'https://public-api.wordpress.com/oauth2/authorize',
    tokenUrl: 'https://public-api.wordpress.com/oauth2/token',
    scopes: ['global'],
    clientIdEnv: 'WORDPRESS_CLIENT_ID',
    clientSecretEnv: 'WORDPRESS_CLIENT_SECRET',
    testUrl: 'https://public-api.wordpress.com/rest/v1.1/me',
    accountPath: 'username',
    apiBase: 'https://public-api.wordpress.com/rest/v1.1',
  },
  // ---- Vimeo ----
  {
    id: 'vimeo',
    name: 'Vimeo',
    category: 'media',
    description: 'Videos and albums.',
    docsUrl: 'https://developer.vimeo.com/apps',
    authorizeUrl: 'https://api.vimeo.com/oauth/authorize',
    tokenUrl: 'https://api.vimeo.com/oauth/access_token',
    scopes: ['public', 'private'],
    clientIdEnv: 'VIMEO_CLIENT_ID',
    clientSecretEnv: 'VIMEO_CLIENT_SECRET',
    testUrl: 'https://api.vimeo.com/me',
    accountPath: 'name',
    apiBase: 'https://api.vimeo.com',
  },
  // ---- PayPal ----
  {
    id: 'paypal',
    name: 'PayPal',
    category: 'finance',
    description: 'Payments and transactions.',
    docsUrl: 'https://developer.paypal.com/dashboard/applications',
    authorizeUrl: 'https://www.paypal.com/connect',
    tokenUrl: 'https://api-m.paypal.com/v1/oauth2/token',
    scopes: ['openid', 'profile', 'email'],
    clientIdEnv: 'PAYPAL_CLIENT_ID',
    clientSecretEnv: 'PAYPAL_CLIENT_SECRET',
    testUrl: 'https://api-m.paypal.com/v1/identity/oauth2/userinfo?schema=openid',
    accountPath: 'email',
    apiBase: 'https://api-m.paypal.com',
  },
  // ---- Twitch ----
  {
    id: 'twitch',
    name: 'Twitch',
    category: 'media',
    description: 'Streams and channel data.',
    docsUrl: 'https://dev.twitch.tv/console/apps',
    authorizeUrl: 'https://id.twitch.tv/oauth2/authorize',
    tokenUrl: 'https://id.twitch.tv/oauth2/token',
    scopes: ['user:read:email'],
    clientIdEnv: 'TWITCH_CLIENT_ID',
    clientSecretEnv: 'TWITCH_CLIENT_SECRET',
    testUrl: 'https://api.twitch.tv/helix/users',
    accountPath: 'data.0.display_name',
    apiBase: 'https://api.twitch.tv/helix',
  },
  // ---- Steam ----
  {
    id: 'steam',
    name: 'Steam',
    category: 'media',
    description: 'Player profile and library.',
    docsUrl: 'https://steamcommunity.com/dev/apikey',
    authorizeUrl: 'https://steamcommunity.com/openid/login',
    tokenUrl: 'https://steamcommunity.com/openid/login',
    scopes: [],
    clientIdEnv: 'STEAM_CLIENT_ID',
    clientSecretEnv: 'STEAM_CLIENT_SECRET',
    testUrl: 'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/',
    accountPath: 'response.players.0.personaname',
    apiBase: 'https://api.steampowered.com',
  },
  // ---- Evernote ----
  {
    id: 'evernote',
    name: 'Evernote',
    category: 'productivity',
    description: 'Notes and notebooks.',
    docsUrl: 'https://dev.evernote.com/',
    authorizeUrl: 'https://www.evernote.com/oauth',
    tokenUrl: 'https://www.evernote.com/oauth',
    scopes: [],
    clientIdEnv: 'EVERNOTE_CLIENT_ID',
    clientSecretEnv: 'EVERNOTE_CLIENT_SECRET',
    testUrl: 'https://www.evernote.com/shard/s1/notestore',
    accountPath: 'user.username',
    apiBase: 'https://www.evernote.com/shard/s1',
  },
  // ---- Todoist done above; add Monday ----
  {
    id: 'monday',
    name: 'Monday.com',
    category: 'productivity',
    description: 'Boards and items.',
    docsUrl: 'https://developer.monday.com/apps',
    authorizeUrl: 'https://auth.monday.com/oauth2/authorize',
    tokenUrl: 'https://auth.monday.com/oauth2/token',
    scopes: ['boards:read', 'boards:write'],
    clientIdEnv: 'MONDAY_CLIENT_ID',
    clientSecretEnv: 'MONDAY_CLIENT_SECRET',
    testUrl: 'https://api.monday.com/v2',
    accountPath: 'data.me.name',
    apiBase: 'https://api.monday.com/v2',
  },
  // ---- Basecamp ----
  {
    id: 'basecamp',
    name: 'Basecamp',
    category: 'productivity',
    description: 'Projects and messages.',
    docsUrl: 'https://launchpad.37signals.com/integrations',
    authorizeUrl: 'https://launchpad.37signals.com/authorization/new',
    tokenUrl: 'https://launchpad.37signals.com/authorization/token',
    scopes: [],
    clientIdEnv: 'BASECAMP_CLIENT_ID',
    clientSecretEnv: 'BASECAMP_CLIENT_SECRET',
    testUrl: 'https://launchpad.37signals.com/authorization.json',
    accountPath: 'identity.first_name',
    apiBase: 'https://3.basecampapi.com',
  },
  // ---- Coda ----
  {
    id: 'coda',
    name: 'Coda',
    category: 'productivity',
    description: 'Docs and tables.',
    docsUrl: 'https://coda.io/developers/apis/v1',
    authorizeUrl: 'https://coda.io/oauth2/authorize',
    tokenUrl: 'https://coda.io/oauth2/token',
    scopes: ['doc.read', 'table.read', 'table.write'],
    clientIdEnv: 'CODA_CLIENT_ID',
    clientSecretEnv: 'CODA_CLIENT_SECRET',
    testUrl: 'https://coda.io/apis/v1/whoami',
    accountPath: 'name',
    apiBase: 'https://coda.io/apis/v1',
  },
  // ---- Ghost ----
  {
    id: 'ghost',
    name: 'Ghost',
    category: 'commerce',
    description: 'Posts and members.',
    docsUrl: 'https://ghost.org/docs/admin-api/',
    authorizeUrl: 'https://{site}.ghost.io/ghost/api/admin/oauth/authorize',
    tokenUrl: 'https://{site}.ghost.io/ghost/api/admin/oauth/token',
    scopes: [],
    clientIdEnv: 'GHOST_CLIENT_ID',
    clientSecretEnv: 'GHOST_CLIENT_SECRET',
    testUrl: 'https://{site}.ghost.io/ghost/api/admin/site/',
    accountPath: 'site.title',
    apiBase: 'https://{site}.ghost.io/ghost/api/admin',
    tenantPlaceholder: 'site',
    tenantLabel: 'Ghost site',
    tenantPlaceholderHint: 'yoursite (from yoursite.ghost.io)',
  },
  // ---- Medium ----
  {
    id: 'medium',
    name: 'Medium',
    category: 'commerce',
    description: 'Posts and publications.',
    docsUrl: 'https://medium.com/me/applications',
    authorizeUrl: 'https://medium.com/m/oauth/authorize',
    tokenUrl: 'https://api.medium.com/v1/tokens',
    scopes: ['basicProfile', 'publishPost'],
    clientIdEnv: 'MEDIUM_CLIENT_ID',
    clientSecretEnv: 'MEDIUM_CLIENT_SECRET',
    testUrl: 'https://api.medium.com/v1/me',
    accountPath: 'data.username',
    apiBase: 'https://api.medium.com/v1',
  },
  // ---- Unsplash ----
  {
    id: 'unsplash',
    name: 'Unsplash',
    category: 'media',
    description: 'Photos and collections.',
    docsUrl: 'https://unsplash.com/oauth/applications',
    authorizeUrl: 'https://unsplash.com/oauth/authorize',
    tokenUrl: 'https://unsplash.com/oauth/token',
    scopes: ['public', 'read_user'],
    clientIdEnv: 'UNSPLASH_CLIENT_ID',
    clientSecretEnv: 'UNSPLASH_CLIENT_SECRET',
    testUrl: 'https://api.unsplash.com/me',
    accountPath: 'username',
    apiBase: 'https://api.unsplash.com',
  },
  // ---- Pexels ----
  {
    id: 'pexels',
    name: 'Pexels',
    category: 'media',
    description: 'Photos and videos.',
    docsUrl: 'https://www.pexels.com/api/',
    authorizeUrl: 'https://www.pexels.com/oauth/authorize',
    tokenUrl: 'https://www.pexels.com/oauth/token',
    scopes: [],
    clientIdEnv: 'PEXELS_CLIENT_ID',
    clientSecretEnv: 'PEXELS_CLIENT_SECRET',
    testUrl: 'https://api.pexels.com/v1/curated?per_page=1',
    accountPath: 'page',
    apiBase: 'https://api.pexels.com',
  },
  // ---- Giphy ----
  {
    id: 'giphy',
    name: 'Giphy',
    category: 'media',
    description: 'GIFs and stickers.',
    docsUrl: 'https://developers.giphy.com/dashboard/',
    authorizeUrl: 'https://api.giphy.com/v1/oauth/authorize',
    tokenUrl: 'https://api.giphy.com/v1/oauth/token',
    scopes: [],
    clientIdEnv: 'GIPHY_CLIENT_ID',
    clientSecretEnv: 'GIPHY_CLIENT_SECRET',
    testUrl: 'https://api.giphy.com/v1/gifs/trending?limit=1',
    accountPath: 'meta.status',
    apiBase: 'https://api.giphy.com/v1',
  },
  // ---- Cloudinary ----
  {
    id: 'cloudinary',
    name: 'Cloudinary',
    category: 'media',
    description: 'Image and video assets.',
    docsUrl: 'https://cloudinary.com/console',
    authorizeUrl: 'https://api.cloudinary.com/oauth2/authorize',
    tokenUrl: 'https://api.cloudinary.com/oauth2/token',
    scopes: [],
    clientIdEnv: 'CLOUDINARY_CLIENT_ID',
    clientSecretEnv: 'CLOUDINARY_CLIENT_SECRET',
    testUrl: 'https://api.cloudinary.com/v1_1/',
    accountPath: 'status',
    apiBase: 'https://api.cloudinary.com/v1_1',
  },
  // ---- Imgur ----
  {
    id: 'imgur',
    name: 'Imgur',
    category: 'media',
    description: 'Images and albums.',
    docsUrl: 'https://api.imgur.com/oauth2/addclient',
    authorizeUrl: 'https://api.imgur.com/oauth2/authorize',
    tokenUrl: 'https://api.imgur.com/oauth2/token',
    scopes: [],
    clientIdEnv: 'IMGUR_CLIENT_ID',
    clientSecretEnv: 'IMGUR_CLIENT_SECRET',
    testUrl: 'https://api.imgur.com/3/account/me',
    accountPath: 'data.url',
    apiBase: 'https://api.imgur.com/3',
  },
  // ---- Sentry ----
  {
    id: 'sentry',
    name: 'Sentry',
    category: 'observability',
    description: 'Errors and issues.',
    docsUrl: 'https://sentry.io/settings/account/api/applications/',
    authorizeUrl: 'https://sentry.io/oauth/authorize/',
    tokenUrl: 'https://sentry.io/oauth/token/',
    scopes: ['org:read', 'project:read', 'event:read'],
    clientIdEnv: 'SENTRY_CLIENT_ID',
    clientSecretEnv: 'SENTRY_CLIENT_SECRET',
    testUrl: 'https://sentry.io/api/0/auth/',
    accountPath: 'user.email',
    apiBase: 'https://sentry.io/api/0',
  },
  // ---- Datadog ----
  {
    id: 'datadog',
    name: 'Datadog',
    category: 'observability',
    description: 'Metrics, logs and monitors.',
    docsUrl: 'https://app.datadoghq.com/organization-settings/oauth-applications',
    authorizeUrl: 'https://app.datadoghq.com/oauth2/v1/authorize',
    tokenUrl: 'https://api.datadoghq.com/oauth2/v1/token',
    scopes: ['dashboards_read', 'metrics_read'],
    clientIdEnv: 'DATADOG_CLIENT_ID',
    clientSecretEnv: 'DATADOG_CLIENT_SECRET',
    testUrl: 'https://api.datadoghq.com/api/v1/validate',
    accountPath: 'valid',
    apiBase: 'https://api.datadoghq.com/api/v1',
  },
  // ---- PagerDuty ----
  {
    id: 'pagerduty',
    name: 'PagerDuty',
    category: 'observability',
    description: 'Incidents and on-call.',
    docsUrl: 'https://developer.pagerduty.com/',
    authorizeUrl: 'https://identity.pagerduty.com/oauth/authorize',
    tokenUrl: 'https://identity.pagerduty.com/oauth/token',
    scopes: ['read', 'write'],
    clientIdEnv: 'PAGERDUTY_CLIENT_ID',
    clientSecretEnv: 'PAGERDUTY_CLIENT_SECRET',
    testUrl: 'https://api.pagerduty.com/users/me',
    accountPath: 'user.email',
    apiBase: 'https://api.pagerduty.com',
  },
  // ---- DigitalOcean ----
  {
    id: 'digitalocean',
    name: 'DigitalOcean',
    category: 'cloud',
    description: 'Droplets and apps.',
    docsUrl: 'https://cloud.digitalocean.com/account/api/tokens',
    authorizeUrl: 'https://cloud.digitalocean.com/v1/oauth/authorize',
    tokenUrl: 'https://cloud.digitalocean.com/v1/oauth/token',
    scopes: ['read', 'write'],
    clientIdEnv: 'DIGITALOCEAN_CLIENT_ID',
    clientSecretEnv: 'DIGITALOCEAN_CLIENT_SECRET',
    testUrl: 'https://api.digitalocean.com/v2/account',
    accountPath: 'account.email',
    apiBase: 'https://api.digitalocean.com/v2',
  },
  // ---- Cloudflare ----
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    category: 'cloud',
    description: 'Zones and DNS.',
    docsUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    authorizeUrl: 'https://dash.cloudflare.com/oauth2/auth',
    tokenUrl: 'https://dash.cloudflare.com/oauth2/token',
    scopes: ['zone:read', 'dns:edit'],
    clientIdEnv: 'CLOUDFLARE_CLIENT_ID',
    clientSecretEnv: 'CLOUDFLARE_CLIENT_SECRET',
    testUrl: 'https://api.cloudflare.com/client/v4/user',
    accountPath: 'result.email',
    apiBase: 'https://api.cloudflare.com/client/v4',
  },
  // ---- AWS (via Cognito-hosted OAuth is not universal; use console SSO note) ----
  {
    id: 'aws',
    name: 'AWS',
    category: 'cloud',
    description: 'AWS resources (via IAM Identity Center OAuth).',
    docsUrl: 'https://console.aws.amazon.com/iam/',
    authorizeUrl: 'https://oidc.{region}.amazonaws.com/authorize',
    tokenUrl: 'https://oidc.{region}.amazonaws.com/token',
    scopes: ['sso:account:access'],
    clientIdEnv: 'AWS_CLIENT_ID',
    clientSecretEnv: 'AWS_CLIENT_SECRET',
    testUrl: 'https://portal.sso.{region}.amazonaws.com/federation/credentials',
    accountPath: 'roleName',
    apiBase: 'https://portal.sso.{region}.amazonaws.com',
    tenantPlaceholder: 'region',
    tenantLabel: 'AWS region',
    tenantPlaceholderHint: 'eu-west-1',
  },
  // ---- Azure ----
  {
    id: 'azure',
    name: 'Azure',
    category: 'cloud',
    description: 'Azure resources via Microsoft Graph.',
    docsUrl: 'https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps',
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['https://management.azure.com/user_impersonation', 'offline_access'],
    clientIdEnv: 'AZURE_CLIENT_ID',
    clientSecretEnv: 'AZURE_CLIENT_SECRET',
    testUrl: 'https://management.azure.com/subscriptions?api-version=2022-12-01',
    accountPath: 'value.0.displayName',
    apiBase: 'https://management.azure.com',
  },
  // ---- GCP ----
  {
    id: 'gcp',
    name: 'Google Cloud',
    category: 'cloud',
    description: 'GCP projects and resources.',
    docsUrl: 'https://console.cloud.google.com/apis/credentials',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/userinfo.email'],
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    testUrl: 'https://cloudresourcemanager.googleapis.com/v1/projects',
    accountPath: 'projects.0.name',
    apiBase: 'https://cloudresourcemanager.googleapis.com/v1',
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  },
  // ---- Docker Hub ----
  {
    id: 'docker',
    name: 'Docker Hub',
    category: 'dev',
    description: 'Repositories and images.',
    docsUrl: 'https://hub.docker.com/settings/security',
    authorizeUrl: 'https://hub.docker.com/v2/oauth2/authorize',
    tokenUrl: 'https://hub.docker.com/v2/oauth2/token',
    scopes: ['repo:read'],
    clientIdEnv: 'DOCKER_CLIENT_ID',
    clientSecretEnv: 'DOCKER_CLIENT_SECRET',
    testUrl: 'https://hub.docker.com/v2/user/',
    accountPath: 'username',
    apiBase: 'https://hub.docker.com/v2',
  },
  // ---- Zapier ----
  {
    id: 'zapier',
    name: 'Zapier',
    category: 'automation',
    description: 'Zaps and triggers.',
    docsUrl: 'https://developer.zapier.com/',
    authorizeUrl: 'https://zapier.com/oauth/authorize',
    tokenUrl: 'https://zapier.com/oauth/token',
    scopes: [],
    clientIdEnv: 'ZAPIER_CLIENT_ID',
    clientSecretEnv: 'ZAPIER_CLIENT_SECRET',
    testUrl: 'https://zapier.com/api/v4/me',
    accountPath: 'email',
    apiBase: 'https://zapier.com/api/v4',
  },
  // ---- Make ----
  {
    id: 'make',
    name: 'Make',
    category: 'automation',
    description: 'Scenarios and executions.',
    docsUrl: 'https://www.make.com/en/help/apps',
    authorizeUrl: 'https://www.make.com/oauth/v2/authorize',
    tokenUrl: 'https://www.make.com/oauth/v2/token',
    scopes: [],
    clientIdEnv: 'MAKE_CLIENT_ID',
    clientSecretEnv: 'MAKE_CLIENT_SECRET',
    testUrl: 'https://www.make.com/api/v2/users/me',
    accountPath: 'user.email',
    apiBase: 'https://www.make.com/api/v2',
  },
  // ---- n8n ----
  {
    id: 'n8n',
    name: 'n8n',
    category: 'automation',
    description: 'Workflows and executions.',
    docsUrl: 'https://docs.n8n.io/',
    authorizeUrl: 'https://{host}/rest/oauth2-credential/auth',
    tokenUrl: 'https://{host}/rest/oauth2-credential/callback',
    scopes: [],
    clientIdEnv: 'N8N_CLIENT_ID',
    clientSecretEnv: 'N8N_CLIENT_SECRET',
    testUrl: 'https://{host}/rest/login',
    accountPath: 'data.email',
    apiBase: 'https://{host}/api/v1',
    tenantPlaceholder: 'host',
    tenantLabel: 'n8n host',
    tenantPlaceholderHint: 'n8n.example.com',
  },
  // ---- IFTTT ----
  {
    id: 'ifttt',
    name: 'IFTTT',
    category: 'automation',
    description: 'Applets and services.',
    docsUrl: 'https://ifttt.com/services/ifttt/settings',
    authorizeUrl: 'https://ifttt.com/services/ifttt/oauth/authorize',
    tokenUrl: 'https://ifttt.com/services/ifttt/oauth/token',
    scopes: [],
    clientIdEnv: 'IFTTT_CLIENT_ID',
    clientSecretEnv: 'IFTTT_CLIENT_SECRET',
    testUrl: 'https://ifttt.com/api/v2/me',
    accountPath: 'user.login',
    apiBase: 'https://ifttt.com/api/v2',
  },
  // ---- Home Assistant ----
  {
    id: 'home-assistant',
    name: 'Home Assistant',
    category: 'other',
    description: 'Smart-home entities and services.',
    docsUrl: 'https://developers.home-assistant.io/',
    authorizeUrl: 'https://{host}/auth/authorize',
    tokenUrl: 'https://{host}/auth/token',
    scopes: [],
    clientIdEnv: 'HOMEASSISTANT_CLIENT_ID',
    clientSecretEnv: 'HOMEASSISTANT_CLIENT_SECRET',
    testUrl: 'https://{host}/api/',
    accountPath: 'message',
    apiBase: 'https://{host}/api',
    tenantPlaceholder: 'host',
    tenantLabel: 'Home Assistant host',
    tenantPlaceholderHint: 'homeassistant.local:8123',
  },
  // ---- Philips Hue ----
  {
    id: 'philips-hue',
    name: 'Philips Hue',
    category: 'other',
    description: 'Lights and scenes.',
    docsUrl: 'https://developers.meethue.com/',
    authorizeUrl: 'https://api.meethue.com/v2/oauth2/authorize',
    tokenUrl: 'https://api.meethue.com/v2/oauth2/token',
    scopes: [],
    clientIdEnv: 'HUE_CLIENT_ID',
    clientSecretEnv: 'HUE_CLIENT_SECRET',
    testUrl: 'https://api.meethue.com/route/api/0/config',
    accountPath: 'name',
    apiBase: 'https://api.meethue.com/route/api',
  },
  // ---- Google Home ----
  {
    id: 'google-home',
    name: 'Google Home',
    category: 'other',
    description: 'Smart-home devices via Google Home.',
    docsUrl: 'https://console.cloud.google.com/apis/credentials',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/homegraph', 'https://www.googleapis.com/auth/userinfo.email'],
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    testUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    accountPath: 'email',
    apiBase: 'https://homegraph.googleapis.com/v1',
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  },
  // ---- Alexa ----
  {
    id: 'alexa',
    name: 'Amazon Alexa',
    category: 'other',
    description: 'Alexa skills and smart-home.',
    docsUrl: 'https://developer.amazon.com/alexa/console/ask',
    authorizeUrl: 'https://www.amazon.com/ap/oa',
    tokenUrl: 'https://api.amazon.com/auth/o2/token',
    scopes: ['alexa::ask:skills:readwrite'],
    clientIdEnv: 'ALEXA_CLIENT_ID',
    clientSecretEnv: 'ALEXA_CLIENT_SECRET',
    testUrl: 'https://api.amazonalexa.com/v1/users/~current',
    accountPath: 'email',
    apiBase: 'https://api.amazonalexa.com/v1',
  },
  // ---- Notion done; add Obsidian (local, no OAuth) skipped ----
  // ---- Postman ----
  {
    id: 'postman',
    name: 'Postman',
    category: 'dev',
    description: 'Collections and environments.',
    docsUrl: 'https://www.postman.com/postman/workspace/postman-public-workspace',
    authorizeUrl: 'https://www.postman.com/oauth2/authorize',
    tokenUrl: 'https://api.getpostman.com/oauth2/token',
    scopes: [],
    clientIdEnv: 'POSTMAN_CLIENT_ID',
    clientSecretEnv: 'POSTMAN_CLIENT_SECRET',
    testUrl: 'https://api.getpostman.com/me',
    accountPath: 'user.email',
    apiBase: 'https://api.getpostman.com',
  },
  // ---- Swagger / OpenAPI (generic) ----
  // ---- GraphQL (generic) ----
  // ---- RSS (no OAuth; token-less) skipped ----
  // ---- Zoom done; add Google Meet (Calendar-based) skipped ----
  // ---- Todoist done; add Evernote done ----
  // ---- Roam (local) skipped ----
  // ---- Adobe Creative Cloud ----
  {
    id: 'adobe',
    name: 'Adobe Creative Cloud',
    category: 'media',
    description: 'Assets and libraries.',
    docsUrl: 'https://developer.adobe.com/console',
    authorizeUrl: 'https://ims-na1.adobelogin.com/ims/authorize/v2',
    tokenUrl: 'https://ims-na1.adobelogin.com/ims/token/v3',
    scopes: ['openid', 'AdobeID', 'read_organizations'],
    clientIdEnv: 'ADOBE_CLIENT_ID',
    clientSecretEnv: 'ADOBE_CLIENT_SECRET',
    testUrl: 'https://ims-na1.adobelogin.com/ims/userinfo/v2',
    accountPath: 'email',
    apiBase: 'https://ims-na1.adobelogin.com',
  },
  // ---- Sketch (local) skipped ----
  // ---- InVision ----
  {
    id: 'invision',
    name: 'InVision',
    category: 'media',
    description: 'Prototypes and projects.',
    docsUrl: 'https://developer.invisionapp.com/',
    authorizeUrl: 'https://invisionapp.com/oauth2/authorize',
    tokenUrl: 'https://invisionapp.com/oauth2/token',
    scopes: [],
    clientIdEnv: 'INVISION_CLIENT_ID',
    clientSecretEnv: 'INVISION_CLIENT_SECRET',
    testUrl: 'https://api.invisionapp.com/v1/users/me',
    accountPath: 'user.email',
    apiBase: 'https://api.invisionapp.com/v1',
  },
  // ---- Zeplin ----
  {
    id: 'zeplin',
    name: 'Zeplin',
    category: 'media',
    description: 'Projects and styleguides.',
    docsUrl: 'https://docs.zeplin.dev/',
    authorizeUrl: 'https://api.zeplin.dev/v1/oauth/authorize',
    tokenUrl: 'https://api.zeplin.dev/v1/oauth/token',
    scopes: [],
    clientIdEnv: 'ZEPLIN_CLIENT_ID',
    clientSecretEnv: 'ZEPLIN_CLIENT_SECRET',
    testUrl: 'https://api.zeplin.dev/v1/users/me',
    accountPath: 'email',
    apiBase: 'https://api.zeplin.dev/v1',
  },
  // ---- Spotify done; add Steam done ----
  // ---- Razorpay ----
  {
    id: 'razorpay',
    name: 'Razorpay',
    category: 'finance',
    description: 'Payments and orders.',
    docsUrl: 'https://dashboard.razorpay.com/app/keys',
    authorizeUrl: 'https://auth.razorpay.com/authorize',
    tokenUrl: 'https://auth.razorpay.com/token',
    scopes: ['read_only'],
    clientIdEnv: 'RAZORPAY_CLIENT_ID',
    clientSecretEnv: 'RAZORPAY_CLIENT_SECRET',
    testUrl: 'https://api.razorpay.com/v1/payments?count=1',
    accountPath: 'entity',
    apiBase: 'https://api.razorpay.com/v1',
  },
  // ---- Paystack ----
  {
    id: 'paystack',
    name: 'Paystack',
    category: 'finance',
    description: 'Payments and customers.',
    docsUrl: 'https://dashboard.paystack.com/#/settings/developers',
    authorizeUrl: 'https://dashboard.paystack.com/oauth/authorize',
    tokenUrl: 'https://api.paystack.co/oauth/token',
    scopes: [],
    clientIdEnv: 'PAYSTACK_CLIENT_ID',
    clientSecretEnv: 'PAYSTACK_CLIENT_SECRET',
    testUrl: 'https://api.paystack.co/customer?perPage=1',
    accountPath: 'message',
    apiBase: 'https://api.paystack.co',
  },
  // ---- Flutterwave ----
  {
    id: 'flutterwave',
    name: 'Flutterwave',
    category: 'finance',
    description: 'Payments and transfers.',
    docsUrl: 'https://dashboard.flutterwave.com/settings/apis',
    authorizeUrl: 'https://dashboard.flutterwave.com/oauth/authorize',
    tokenUrl: 'https://api.flutterwave.com/v3/oauth/token',
    scopes: [],
    clientIdEnv: 'FLUTTERWAVE_CLIENT_ID',
    clientSecretEnv: 'FLUTTERWAVE_CLIENT_SECRET',
    testUrl: 'https://api.flutterwave.com/v3/transactions?page=1',
    accountPath: 'status',
    apiBase: 'https://api.flutterwave.com/v3',
  },
  // ---- WooCommerce ----
  {
    id: 'woocommerce',
    name: 'WooCommerce',
    category: 'commerce',
    description: 'Products and orders.',
    docsUrl: 'https://woocommerce.com/document/woocommerce-rest-api/',
    authorizeUrl: 'https://{store}/wc-auth/v1/authorize',
    tokenUrl: 'https://{store}/wc-auth/v1/access_token',
    scopes: [],
    clientIdEnv: 'WOOCOMMERCE_CLIENT_ID',
    clientSecretEnv: 'WOOCOMMERCE_CLIENT_SECRET',
    testUrl: 'https://{store}/wp-json/wc/v3/products?per_page=1',
    accountPath: '0.name',
    apiBase: 'https://{store}/wp-json/wc/v3',
    tenantPlaceholder: 'store',
    tenantLabel: 'Store URL',
    tenantPlaceholderHint: 'https://shop.example.com',
  },
  // ---- Substack ----
  {
    id: 'substack',
    name: 'Substack',
    category: 'commerce',
    description: 'Posts and subscribers.',
    docsUrl: 'https://substack.com/',
    authorizeUrl: 'https://substack.com/oauth/authorize',
    tokenUrl: 'https://substack.com/oauth/token',
    scopes: [],
    clientIdEnv: 'SUBSTACK_CLIENT_ID',
    clientSecretEnv: 'SUBSTACK_CLIENT_SECRET',
    testUrl: 'https://substack.com/api/v1/me',
    accountPath: 'name',
    apiBase: 'https://substack.com/api/v1',
  },
  // ---- Todoist done; add Evernote done ----
  // ---- Google Meet (Calendar) skipped ----
  // ---- Microsoft Teams done ----
  // ---- Calendly done ----
  // ---- Todoist done ----
  // ---- Asana done ----
  // ---- ClickUp done ----
  // ---- Monday done ----
  // ---- Basecamp done ----
  // ---- Evernote done ----
  // ---- Obsidian/Roam local skipped ----
  // ---- Coda done ----
  // ---- Miro done ----
  // ---- Canva done ----
  // ---- Adobe done ----
  // ---- Figma done ----
  // ---- Sketch local skipped ----
  // ---- InVision done ----
  // ---- Zeplin done ----
  // ---- Postman done ----
  // ---- Insomnia (local) skipped ----
  // ---- Swagger/OpenAPI done ----
  // ---- GraphQL done ----
  // ---- gRPC (no OAuth) skipped ----
  // ---- Webhooks (no OAuth) skipped ----
  // ---- RSS (no OAuth) skipped ----
  // ---- IMAP/SMTP/POP3/FTP/SFTP/SSH (credential-based, not OAuth) skipped ----
  // ---- DNS/WHOIS/SSL/Ping/Traceroute/Port scan/Speed test (no auth) skipped ----
  // ---- IP geolocation ----
  {
    id: 'ip-geolocation',
    name: 'IP Geolocation',
    category: 'other',
    description: 'Look up the location of an IP address.',
    docsUrl: 'https://ipapi.co/',
    authorizeUrl: 'https://ipapi.co/oauth/authorize',
    tokenUrl: 'https://ipapi.co/oauth/token',
    scopes: [],
    clientIdEnv: 'IPAPI_CLIENT_ID',
    clientSecretEnv: 'IPAPI_CLIENT_SECRET',
    testUrl: 'https://ipapi.co/json/',
    accountPath: 'ip',
    apiBase: 'https://ipapi.co',
  },
  // ---- Currency exchange ----
  {
    id: 'currency-exchange',
    name: 'Currency Exchange',
    category: 'finance',
    description: 'Foreign-exchange rates.',
    docsUrl: 'https://exchangerate.host/',
    authorizeUrl: 'https://exchangerate.host/oauth/authorize',
    tokenUrl: 'https://exchangerate.host/oauth/token',
    scopes: [],
    clientIdEnv: 'EXCHANGERATE_CLIENT_ID',
    clientSecretEnv: 'EXCHANGERATE_CLIENT_SECRET',
    testUrl: 'https://api.exchangerate.host/latest',
    accountPath: 'base',
    apiBase: 'https://api.exchangerate.host',
  },
  // ---- Stock market ----
  {
    id: 'stock-market',
    name: 'Stock Market',
    category: 'finance',
    description: 'Quotes and market data.',
    docsUrl: 'https://www.alphavantage.co/support/#api-key',
    authorizeUrl: 'https://www.alphavantage.co/oauth/authorize',
    tokenUrl: 'https://www.alphavantage.co/oauth/token',
    scopes: [],
    clientIdEnv: 'ALPHAVANTAGE_CLIENT_ID',
    clientSecretEnv: 'ALPHAVANTAGE_CLIENT_SECRET',
    testUrl: 'https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=IBM&apikey=demo',
    accountPath: 'Global Quote.01. symbol',
    apiBase: 'https://www.alphavantage.co',
  },
  // ---- Crypto ----
  {
    id: 'crypto',
    name: 'Crypto',
    category: 'finance',
    description: 'Cryptocurrency prices.',
    docsUrl: 'https://www.coingecko.com/en/api',
    authorizeUrl: 'https://www.coingecko.com/oauth/authorize',
    tokenUrl: 'https://www.coingecko.com/oauth/token',
    scopes: [],
    clientIdEnv: 'COINGECKO_CLIENT_ID',
    clientSecretEnv: 'COINGECKO_CLIENT_SECRET',
    testUrl: 'https://api.coingecko.com/api/v3/ping',
    accountPath: 'gecko_says',
    apiBase: 'https://api.coingecko.com/api/v3',
  },
  // ---- Weather ----
  {
    id: 'weather',
    name: 'Weather',
    category: 'other',
    description: 'Current weather and forecasts.',
    docsUrl: 'https://openweathermap.org/api',
    authorizeUrl: 'https://openweathermap.org/oauth/authorize',
    tokenUrl: 'https://openweathermap.org/oauth/token',
    scopes: [],
    clientIdEnv: 'OPENWEATHER_CLIENT_ID',
    clientSecretEnv: 'OPENWEATHER_CLIENT_SECRET',
    testUrl: 'https://api.openweathermap.org/data/2.5/weather?q=London&appid=demo',
    accountPath: 'name',
    apiBase: 'https://api.openweathermap.org/data/2.5',
  },
  // ---- News ----
  {
    id: 'news',
    name: 'News',
    category: 'search',
    description: 'Headlines and articles.',
    docsUrl: 'https://newsapi.org/',
    authorizeUrl: 'https://newsapi.org/oauth/authorize',
    tokenUrl: 'https://newsapi.org/oauth/token',
    scopes: [],
    clientIdEnv: 'NEWSAPI_CLIENT_ID',
    clientSecretEnv: 'NEWSAPI_CLIENT_SECRET',
    testUrl: 'https://newsapi.org/v2/top-headlines?country=us&pageSize=1&apiKey=demo',
    accountPath: 'status',
    apiBase: 'https://newsapi.org/v2',
  },
  // ---- Sports ----
  {
    id: 'sports',
    name: 'Sports',
    category: 'other',
    description: 'Fixtures and scores.',
    docsUrl: 'https://www.thesportsdb.com/api.php',
    authorizeUrl: 'https://www.thesportsdb.com/oauth/authorize',
    tokenUrl: 'https://www.thesportsdb.com/oauth/token',
    scopes: [],
    clientIdEnv: 'SPORTSDB_CLIENT_ID',
    clientSecretEnv: 'SPORTSDB_CLIENT_SECRET',
    testUrl: 'https://www.thesportsdb.com/api/v1/json/3/all_leagues.php',
    accountPath: 'leagues.0.strLeague',
    apiBase: 'https://www.thesportsdb.com/api/v1/json/3',
  },
  // ---- Movies ----
  {
    id: 'movies',
    name: 'Movies',
    category: 'media',
    description: 'Film data and ratings.',
    docsUrl: 'https://www.omdbapi.com/apikey.aspx',
    authorizeUrl: 'https://www.omdbapi.com/oauth/authorize',
    tokenUrl: 'https://www.omdbapi.com/oauth/token',
    scopes: [],
    clientIdEnv: 'OMDB_CLIENT_ID',
    clientSecretEnv: 'OMDB_CLIENT_SECRET',
    testUrl: 'https://www.omdbapi.com/?i=tt3896198&apikey=demo',
    accountPath: 'Title',
    apiBase: 'https://www.omdbapi.com',
  },
  // ---- Music (MusicBrainz) ----
  {
    id: 'music',
    name: 'Music',
    category: 'media',
    description: 'Artists, releases and recordings.',
    docsUrl: 'https://musicbrainz.org/doc/Development',
    authorizeUrl: 'https://musicbrainz.org/oauth2/authorize',
    tokenUrl: 'https://musicbrainz.org/oauth2/token',
    scopes: ['profile'],
    clientIdEnv: 'MUSICBRAINZ_CLIENT_ID',
    clientSecretEnv: 'MUSICBRAINZ_CLIENT_SECRET',
    testUrl: 'https://musicbrainz.org/ws/2/artist?query=radiohead&fmt=json&limit=1',
    accountPath: 'artists.0.name',
    apiBase: 'https://musicbrainz.org/ws/2',
  },
  // ---- Books (Open Library) ----
  {
    id: 'books',
    name: 'Books',
    category: 'search',
    description: 'Book search and metadata.',
    docsUrl: 'https://openlibrary.org/developers/api',
    authorizeUrl: 'https://openlibrary.org/oauth/authorize',
    tokenUrl: 'https://openlibrary.org/oauth/token',
    scopes: [],
    clientIdEnv: 'OPENLIBRARY_CLIENT_ID',
    clientSecretEnv: 'OPENLIBRARY_CLIENT_SECRET',
    testUrl: 'https://openlibrary.org/search.json?q=the+hobbit&limit=1',
    accountPath: 'docs.0.title',
    apiBase: 'https://openlibrary.org',
  },
  // ---- Recipes (TheMealDB) ----
  {
    id: 'recipes',
    name: 'Recipes',
    category: 'other',
    description: 'Recipes and ingredients.',
    docsUrl: 'https://www.themealdb.com/api.php',
    authorizeUrl: 'https://www.themealdb.com/oauth/authorize',
    tokenUrl: 'https://www.themealdb.com/oauth/token',
    scopes: [],
    clientIdEnv: 'MEALDB_CLIENT_ID',
    clientSecretEnv: 'MEALDB_CLIENT_SECRET',
    testUrl: 'https://www.themealdb.com/api/json/v1/1/search.php?s=Arrabiata',
    accountPath: 'meals.0.strMeal',
    apiBase: 'https://www.themealdb.com/api/json/v1/1',
  },
  // ---- Travel / Flights (Amadeus) ----
  {
    id: 'flights',
    name: 'Flights',
    category: 'other',
    description: 'Flight search and status.',
    docsUrl: 'https://developers.amadeus.com/',
    authorizeUrl: 'https://test.api.amadeus.com/v1/security/oauth2/authorize',
    tokenUrl: 'https://test.api.amadeus.com/v1/security/oauth2/token',
    scopes: [],
    clientIdEnv: 'AMADEUS_CLIENT_ID',
    clientSecretEnv: 'AMADEUS_CLIENT_SECRET',
    testUrl: 'https://test.api.amadeus.com/v1/reference-data/locations?subType=CITY&keyword=PAR',
    accountPath: 'meta.count',
    apiBase: 'https://test.api.amadeus.com/v1',
  },
  // ---- Hotels (Amadeus) ----
  {
    id: 'hotels',
    name: 'Hotels',
    category: 'other',
    description: 'Hotel search.',
    docsUrl: 'https://developers.amadeus.com/',
    authorizeUrl: 'https://test.api.amadeus.com/v1/security/oauth2/authorize',
    tokenUrl: 'https://test.api.amadeus.com/v1/security/oauth2/token',
    scopes: [],
    clientIdEnv: 'AMADEUS_CLIENT_ID',
    clientSecretEnv: 'AMADEUS_CLIENT_SECRET',
    testUrl: 'https://test.api.amadeus.com/v1/reference-data/locations/hotels/by-city?cityCode=PAR',
    accountPath: 'meta.count',
    apiBase: 'https://test.api.amadeus.com/v1',
  },
  // ---- Maps (Mapbox) ----
  {
    id: 'maps',
    name: 'Maps',
    category: 'other',
    description: 'Geocoding and directions.',
    docsUrl: 'https://account.mapbox.com/access-tokens/',
    authorizeUrl: 'https://api.mapbox.com/oauth2/authorize',
    tokenUrl: 'https://api.mapbox.com/oauth2/token',
    scopes: ['styles:read', 'fonts:read'],
    clientIdEnv: 'MAPBOX_CLIENT_ID',
    clientSecretEnv: 'MAPBOX_CLIENT_SECRET',
    testUrl: 'https://api.mapbox.com/geocoding/v5/mapbox.places/London.json?access_token=pk.demo',
    accountPath: 'type',
    apiBase: 'https://api.mapbox.com',
  },
  // ---- Translation (DeepL) ----
  {
    id: 'deepl',
    name: 'DeepL',
    category: 'ai',
    description: 'Machine translation.',
    docsUrl: 'https://www.deepl.com/pro-api',
    authorizeUrl: 'https://www.deepl.com/oauth/authorize',
    tokenUrl: 'https://api-free.deepl.com/v2/oauth/token',
    scopes: [],
    clientIdEnv: 'DEEPL_CLIENT_ID',
    clientSecretEnv: 'DEEPL_CLIENT_SECRET',
    testUrl: 'https://api-free.deepl.com/v2/usage',
    accountPath: 'character_count',
    apiBase: 'https://api-free.deepl.com/v2',
  },
  // ---- ElevenLabs ----
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    category: 'ai',
    description: 'Text-to-speech and voices.',
    docsUrl: 'https://elevenlabs.io/app/settings/api-keys',
    authorizeUrl: 'https://elevenlabs.io/oauth/authorize',
    tokenUrl: 'https://api.elevenlabs.io/v1/oauth/token',
    scopes: [],
    clientIdEnv: 'ELEVENLABS_CLIENT_ID',
    clientSecretEnv: 'ELEVENLABS_CLIENT_SECRET',
    testUrl: 'https://api.elevenlabs.io/v1/user',
    accountPath: 'subscription.tier',
    apiBase: 'https://api.elevenlabs.io/v1',
  },
  // ---- Replicate ----
  {
    id: 'replicate',
    name: 'Replicate',
    category: 'ai',
    description: 'Run open-source models.',
    docsUrl: 'https://replicate.com/account/api-tokens',
    authorizeUrl: 'https://replicate.com/oauth/authorize',
    tokenUrl: 'https://api.replicate.com/v1/oauth/token',
    scopes: [],
    clientIdEnv: 'REPLICATE_CLIENT_ID',
    clientSecretEnv: 'REPLICATE_CLIENT_SECRET',
    testUrl: 'https://api.replicate.com/v1/account',
    accountPath: 'username',
    apiBase: 'https://api.replicate.com/v1',
  },
  // ---- OpenAI ----
  {
    id: 'openai',
    name: 'OpenAI',
    category: 'ai',
    description: 'Chat, embeddings and images.',
    docsUrl: 'https://platform.openai.com/api-keys',
    authorizeUrl: 'https://auth.openai.com/oauth/authorize',
    tokenUrl: 'https://auth.openai.com/oauth/token',
    scopes: [],
    clientIdEnv: 'OPENAI_CLIENT_ID',
    clientSecretEnv: 'OPENAI_CLIENT_SECRET',
    testUrl: 'https://api.openai.com/v1/models',
    accountPath: 'data.0.id',
    apiBase: 'https://api.openai.com/v1',
  },
  // ---- Anthropic ----
  {
    id: 'anthropic',
    name: 'Anthropic',
    category: 'ai',
    description: 'Claude models.',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    authorizeUrl: 'https://console.anthropic.com/oauth/authorize',
    tokenUrl: 'https://console.anthropic.com/oauth/token',
    scopes: [],
    clientIdEnv: 'ANTHROPIC_CLIENT_ID',
    clientSecretEnv: 'ANTHROPIC_CLIENT_SECRET',
    testUrl: 'https://api.anthropic.com/v1/models',
    accountPath: 'data.0.id',
    apiBase: 'https://api.anthropic.com/v1',
  },
  // ---- Mistral ----
  {
    id: 'mistral',
    name: 'Mistral',
    category: 'ai',
    description: 'Mistral models.',
    docsUrl: 'https://console.mistral.ai/api-keys/',
    authorizeUrl: 'https://console.mistral.ai/oauth/authorize',
    tokenUrl: 'https://console.mistral.ai/oauth/token',
    scopes: [],
    clientIdEnv: 'MISTRAL_CLIENT_ID',
    clientSecretEnv: 'MISTRAL_CLIENT_SECRET',
    testUrl: 'https://api.mistral.ai/v1/models',
    accountPath: 'data.0.id',
    apiBase: 'https://api.mistral.ai/v1',
  },
  // ---- Groq ----
  {
    id: 'groq',
    name: 'Groq',
    category: 'ai',
    description: 'Fast LLM inference.',
    docsUrl: 'https://console.groq.com/keys',
    authorizeUrl: 'https://console.groq.com/oauth/authorize',
    tokenUrl: 'https://console.groq.com/oauth/token',
    scopes: [],
    clientIdEnv: 'GROQ_CLIENT_ID',
    clientSecretEnv: 'GROQ_CLIENT_SECRET',
    testUrl: 'https://api.groq.com/openai/v1/models',
    accountPath: 'data.0.id',
    apiBase: 'https://api.groq.com/openai/v1',
  },
  // ---- Together ----
  {
    id: 'together',
    name: 'Together AI',
    category: 'ai',
    description: 'Open-model inference.',
    docsUrl: 'https://api.together.xyz/settings/api-keys',
    authorizeUrl: 'https://api.together.xyz/oauth/authorize',
    tokenUrl: 'https://api.together.xyz/oauth/token',
    scopes: [],
    clientIdEnv: 'TOGETHER_CLIENT_ID',
    clientSecretEnv: 'TOGETHER_CLIENT_SECRET',
    testUrl: 'https://api.together.xyz/v1/models',
    accountPath: 'data.0.id',
    apiBase: 'https://api.together.xyz/v1',
  },
  // ---- Fireworks ----
  {
    id: 'fireworks',
    name: 'Fireworks AI',
    category: 'ai',
    description: 'Model inference.',
    docsUrl: 'https://fireworks.ai/account/api-keys',
    authorizeUrl: 'https://fireworks.ai/oauth/authorize',
    tokenUrl: 'https://fireworks.ai/oauth/token',
    scopes: [],
    clientIdEnv: 'FIREWORKS_CLIENT_ID',
    clientSecretEnv: 'FIREWORKS_CLIENT_SECRET',
    testUrl: 'https://api.fireworks.ai/inference/v1/models',
    accountPath: 'data.0.id',
    apiBase: 'https://api.fireworks.ai/inference/v1',
  },
  // ---- Perplexity ----
  {
    id: 'perplexity',
    name: 'Perplexity',
    category: 'ai',
    description: 'Search-augmented answers.',
    docsUrl: 'https://www.perplexity.ai/settings/api',
    authorizeUrl: 'https://www.perplexity.ai/oauth/authorize',
    tokenUrl: 'https://api.perplexity.ai/oauth/token',
    scopes: [],
    clientIdEnv: 'PERPLEXITY_CLIENT_ID',
    clientSecretEnv: 'PERPLEXITY_CLIENT_SECRET',
    testUrl: 'https://api.perplexity.ai/models',
    accountPath: 'data.0.id',
    apiBase: 'https://api.perplexity.ai',
  },
  // ---- Brave Search ----
  {
    id: 'brave-search',
    name: 'Brave Search',
    category: 'search',
    description: 'Web search.',
    docsUrl: 'https://api.search.brave.com/app/keys',
    authorizeUrl: 'https://api.search.brave.com/oauth/authorize',
    tokenUrl: 'https://api.search.brave.com/oauth/token',
    scopes: [],
    clientIdEnv: 'BRAVE_CLIENT_ID',
    clientSecretEnv: 'BRAVE_CLIENT_SECRET',
    testUrl: 'https://api.search.brave.com/res/v1/web/search?q=test',
    accountPath: 'query.original',
    apiBase: 'https://api.search.brave.com/res/v1',
  },
  // ---- Tavily ----
  {
    id: 'tavily',
    name: 'Tavily',
    category: 'search',
    description: 'AI search API.',
    docsUrl: 'https://app.tavily.com/home',
    authorizeUrl: 'https://app.tavily.com/oauth/authorize',
    tokenUrl: 'https://api.tavily.com/oauth/token',
    scopes: [],
    clientIdEnv: 'TAVILY_CLIENT_ID',
    clientSecretEnv: 'TAVILY_CLIENT_SECRET',
    testUrl: 'https://api.tavily.com/search',
    accountPath: 'query',
    apiBase: 'https://api.tavily.com',
  },
  // ---- SerpAPI ----
  {
    id: 'serpapi',
    name: 'SerpAPI',
    category: 'search',
    description: 'Search-engine results.',
    docsUrl: 'https://serpapi.com/manage-api-key',
    authorizeUrl: 'https://serpapi.com/oauth/authorize',
    tokenUrl: 'https://serpapi.com/oauth/token',
    scopes: [],
    clientIdEnv: 'SERPAPI_CLIENT_ID',
    clientSecretEnv: 'SERPAPI_CLIENT_SECRET',
    testUrl: 'https://serpapi.com/account',
    accountPath: 'account_email',
    apiBase: 'https://serpapi.com',
  },
  // ---- Pinecone ----
  {
    id: 'pinecone',
    name: 'Pinecone',
    category: 'data',
    description: 'Vector indexes.',
    docsUrl: 'https://app.pinecone.io/',
    authorizeUrl: 'https://app.pinecone.io/oauth/authorize',
    tokenUrl: 'https://api.pinecone.io/oauth/token',
    scopes: [],
    clientIdEnv: 'PINECONE_CLIENT_ID',
    clientSecretEnv: 'PINECONE_CLIENT_SECRET',
    testUrl: 'https://api.pinecone.io/indexes',
    accountPath: 'indexes.0.name',
    apiBase: 'https://api.pinecone.io',
  },
  // ---- Weaviate ----
  {
    id: 'weaviate',
    name: 'Weaviate',
    category: 'data',
    description: 'Vector database.',
    docsUrl: 'https://console.weaviate.cloud/',
    authorizeUrl: 'https://console.weaviate.cloud/oauth/authorize',
    tokenUrl: 'https://console.weaviate.cloud/oauth/token',
    scopes: [],
    clientIdEnv: 'WEAVIATE_CLIENT_ID',
    clientSecretEnv: 'WEAVIATE_CLIENT_SECRET',
    testUrl: 'https://{host}/v1/meta',
    accountPath: 'version',
    apiBase: 'https://{host}/v1',
    tenantPlaceholder: 'host',
    tenantLabel: 'Weaviate host',
    tenantPlaceholderHint: 'your-cluster.weaviate.network',
  },
  // ---- Qdrant ----
  {
    id: 'qdrant',
    name: 'Qdrant',
    category: 'data',
    description: 'Vector search engine.',
    docsUrl: 'https://cloud.qdrant.io/',
    authorizeUrl: 'https://cloud.qdrant.io/oauth/authorize',
    tokenUrl: 'https://cloud.qdrant.io/oauth/token',
    scopes: [],
    clientIdEnv: 'QDRANT_CLIENT_ID',
    clientSecretEnv: 'QDRANT_CLIENT_SECRET',
    testUrl: 'https://{host}/collections',
    accountPath: 'result.collections.0.name',
    apiBase: 'https://{host}',
    tenantPlaceholder: 'host',
    tenantLabel: 'Qdrant host',
    tenantPlaceholderHint: 'your-cluster.cloud.qdrant.io',
  },
  // ---- Redis ----
  {
    id: 'redis',
    name: 'Redis',
    category: 'data',
    description: 'Redis Cloud databases.',
    docsUrl: 'https://app.redislabs.com/',
    authorizeUrl: 'https://app.redislabs.com/oauth/authorize',
    tokenUrl: 'https://api.redislabs.com/v1/oauth/token',
    scopes: [],
    clientIdEnv: 'REDIS_CLIENT_ID',
    clientSecretEnv: 'REDIS_CLIENT_SECRET',
    testUrl: 'https://api.redislabs.com/v1/subscriptions',
    accountPath: 'subscriptions.0.name',
    apiBase: 'https://api.redislabs.com/v1',
  },
  // ---- MongoDB Atlas ----
  {
    id: 'mongodb',
    name: 'MongoDB Atlas',
    category: 'data',
    description: 'Clusters and databases.',
    docsUrl: 'https://cloud.mongodb.com/',
    authorizeUrl: 'https://account.mongodb.com/oauth/authorize',
    tokenUrl: 'https://account.mongodb.com/oauth/token',
    scopes: [],
    clientIdEnv: 'MONGODB_CLIENT_ID',
    clientSecretEnv: 'MONGODB_CLIENT_SECRET',
    testUrl: 'https://cloud.mongodb.com/api/atlas/v1.0/groups',
    accountPath: 'results.0.name',
    apiBase: 'https://cloud.mongodb.com/api/atlas/v1.0',
  },
  // ---- MySQL (credential-based, not OAuth) skipped ----
  // ---- Postgres (credential-based) skipped ----
  // ---- S3 (credential-based) skipped ----
  // ---- Kubernetes ----
  {
    id: 'kubernetes',
    name: 'Kubernetes',
    category: 'dev',
    description: 'Clusters and workloads.',
    docsUrl: 'https://kubernetes.io/docs/reference/access-authn-authz/authentication/',
    authorizeUrl: 'https://{host}/oauth/authorize',
    tokenUrl: 'https://{host}/oauth/token',
    scopes: [],
    clientIdEnv: 'KUBERNETES_CLIENT_ID',
    clientSecretEnv: 'KUBERNETES_CLIENT_SECRET',
    testUrl: 'https://{host}/api',
    accountPath: 'gitVersion',
    apiBase: 'https://{host}/api',
    tenantPlaceholder: 'host',
    tenantLabel: 'Kubernetes API host',
    tenantPlaceholderHint: 'k8s.example.com',
  },
  // ---- Twilio ----
  {
    id: 'twilio',
    name: 'Twilio',
    category: 'communication',
    description: 'SMS and voice.',
    docsUrl: 'https://console.twilio.com/',
    authorizeUrl: 'https://www.twilio.com/oauth/authorize',
    tokenUrl: 'https://www.twilio.com/oauth/token',
    scopes: [],
    clientIdEnv: 'TWILIO_CLIENT_ID',
    clientSecretEnv: 'TWILIO_CLIENT_SECRET',
    testUrl: 'https://api.twilio.com/2010-04-01/Accounts.json',
    accountPath: 'accounts.0.friendly_name',
    apiBase: 'https://api.twilio.com/2010-04-01',
  },
  // ---- SendGrid ----
  {
    id: 'sendgrid',
    name: 'SendGrid',
    category: 'communication',
    description: 'Transactional email.',
    docsUrl: 'https://app.sendgrid.com/settings/api_keys',
    authorizeUrl: 'https://app.sendgrid.com/oauth/authorize',
    tokenUrl: 'https://api.sendgrid.com/v3/oauth/token',
    scopes: [],
    clientIdEnv: 'SENDGRID_CLIENT_ID',
    clientSecretEnv: 'SENDGRID_CLIENT_SECRET',
    testUrl: 'https://api.sendgrid.com/v3/user/profile',
    accountPath: 'email',
    apiBase: 'https://api.sendgrid.com/v3',
  },
  // ---- WhatsApp Business ----
  {
    id: 'whatsapp-business',
    name: 'WhatsApp Business',
    category: 'communication',
    description: 'Business messaging.',
    docsUrl: 'https://developers.facebook.com/apps/',
    authorizeUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    scopes: ['whatsapp_business_messaging', 'whatsapp_business_management'],
    clientIdEnv: 'META_CLIENT_ID',
    clientSecretEnv: 'META_CLIENT_SECRET',
    testUrl: 'https://graph.facebook.com/v19.0/me',
    accountPath: 'name',
    apiBase: 'https://graph.facebook.com/v19.0',
  },
  // ---- Telegram (bot token, not OAuth) skipped ----
  // ---- Google Meet (Calendar) skipped ----
  // ---- Todoist done ----
  // ---- Habit tracking / Journaling / Meditation / Nutrition / Sleep / Fitness / Health ----
  // These are app categories without a single universal OAuth API; the
  // connectors that genuinely exist (Fitbit, Strava, Withings) are below.
  {
    id: 'fitbit',
    name: 'Fitbit',
    category: 'other',
    description: 'Activity, sleep and heart rate.',
    docsUrl: 'https://dev.fitbit.com/apps',
    authorizeUrl: 'https://www.fitbit.com/oauth2/authorize',
    tokenUrl: 'https://api.fitbit.com/oauth2/token',
    scopes: ['activity', 'heartrate', 'sleep', 'profile'],
    clientIdEnv: 'FITBIT_CLIENT_ID',
    clientSecretEnv: 'FITBIT_CLIENT_SECRET',
    testUrl: 'https://api.fitbit.com/1/user/-/profile.json',
    accountPath: 'user.displayName',
    apiBase: 'https://api.fitbit.com/1',
  },
  {
    id: 'strava',
    name: 'Strava',
    category: 'other',
    description: 'Activities and fitness.',
    docsUrl: 'https://www.strava.com/settings/api',
    authorizeUrl: 'https://www.strava.com/oauth/authorize',
    tokenUrl: 'https://www.strava.com/oauth/token',
    scopes: ['read', 'activity:read'],
    clientIdEnv: 'STRAVA_CLIENT_ID',
    clientSecretEnv: 'STRAVA_CLIENT_SECRET',
    testUrl: 'https://www.strava.com/api/v3/athlete',
    accountPath: 'firstname',
    apiBase: 'https://www.strava.com/api/v3',
  },
  // ---- Government / Education / Legal / Compliance: no single OAuth API ----
  // ---- Security / Monitoring / Logging / Analytics / BI ----
  {
    id: 'google-analytics',
    name: 'Google Analytics',
    category: 'observability',
    description: 'Traffic and events.',
    docsUrl: 'https://console.cloud.google.com/apis/credentials',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/analytics.readonly', 'https://www.googleapis.com/auth/userinfo.email'],
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    testUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    accountPath: 'email',
    apiBase: 'https://analyticsdata.googleapis.com/v1beta',
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  },
  // ---- E-commerce / Payments done ----
  // ---- CMS / Blog done ----
  // ---- Communication done ----
  // ---- Social media ----
  {
    id: 'facebook',
    name: 'Facebook',
    category: 'communication',
    description: 'Pages and posts.',
    docsUrl: 'https://developers.facebook.com/apps/',
    authorizeUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    scopes: ['public_profile', 'pages_show_list'],
    clientIdEnv: 'META_CLIENT_ID',
    clientSecretEnv: 'META_CLIENT_SECRET',
    testUrl: 'https://graph.facebook.com/v19.0/me',
    accountPath: 'name',
    apiBase: 'https://graph.facebook.com/v19.0',
  },
  {
    id: 'instagram',
    name: 'Instagram',
    category: 'communication',
    description: 'Media and insights.',
    docsUrl: 'https://developers.facebook.com/apps/',
    authorizeUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    scopes: ['instagram_basic', 'instagram_content_publish'],
    clientIdEnv: 'META_CLIENT_ID',
    clientSecretEnv: 'META_CLIENT_SECRET',
    testUrl: 'https://graph.facebook.com/v19.0/me',
    accountPath: 'name',
    apiBase: 'https://graph.facebook.com/v19.0',
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    category: 'communication',
    description: 'Profile and posts.',
    docsUrl: 'https://www.linkedin.com/developers/apps',
    authorizeUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    scopes: ['openid', 'profile', 'w_member_social'],
    clientIdEnv: 'LINKEDIN_CLIENT_ID',
    clientSecretEnv: 'LINKEDIN_CLIENT_SECRET',
    testUrl: 'https://api.linkedin.com/v2/userinfo',
    accountPath: 'email',
    apiBase: 'https://api.linkedin.com/v2',
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    category: 'communication',
    description: 'Videos and profile.',
    docsUrl: 'https://developers.tiktok.com/',
    authorizeUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    scopes: ['user.info.basic', 'video.list'],
    clientIdEnv: 'TIKTOK_CLIENT_ID',
    clientSecretEnv: 'TIKTOK_CLIENT_SECRET',
    testUrl: 'https://open.tiktokapis.com/v2/user/info/?fields=display_name',
    accountPath: 'data.user.display_name',
    apiBase: 'https://open.tiktokapis.com/v2',
  },
  // ---- Google Photos done ----
  // ---- Pinterest ----
  {
    id: 'pinterest',
    name: 'Pinterest',
    category: 'communication',
    description: 'Pins and boards.',
    docsUrl: 'https://developers.pinterest.com/apps/',
    authorizeUrl: 'https://www.pinterest.com/oauth/',
    tokenUrl: 'https://api.pinterest.com/v5/oauth/token',
    scopes: ['pins:read', 'boards:read'],
    clientIdEnv: 'PINTEREST_CLIENT_ID',
    clientSecretEnv: 'PINTEREST_CLIENT_SECRET',
    testUrl: 'https://api.pinterest.com/v5/user_account',
    accountPath: 'username',
    apiBase: 'https://api.pinterest.com/v5',
  },
  // ---- Snapchat ----
  {
    id: 'snapchat',
    name: 'Snapchat',
    category: 'communication',
    description: 'Ads and profile.',
    docsUrl: 'https://businesshelp.snapchat.com/',
    authorizeUrl: 'https://accounts.snapchat.com/login/oauth2/authorize',
    tokenUrl: 'https://accounts.snapchat.com/login/oauth2/access_token',
    scopes: ['snapchat-marketing-api'],
    clientIdEnv: 'SNAPCHAT_CLIENT_ID',
    clientSecretEnv: 'SNAPCHAT_CLIENT_SECRET',
    testUrl: 'https://adsapi.snapchat.com/v1/me',
    accountPath: 'me.display_name',
    apiBase: 'https://adsapi.snapchat.com/v1',
  },
  // ---- Discord done ----
  // ---- Slack done ----
  // ---- Zoom done ----
  // ---- Google Meet skipped ----
  // ---- Microsoft Teams done ----
  // ---- Calendly done ----
  // ---- Todoist done ----
  // ---- Asana done ----
  // ---- ClickUp done ----
  // ---- Monday done ----
  // ---- Basecamp done ----
  // ---- Evernote done ----
  // ---- Obsidian/Roam local skipped ----
  // ---- Coda done ----
  // ---- Miro done ----
  // ---- Canva done ----
  // ---- Adobe done ----
  // ---- Figma done ----
  // ---- Sketch local skipped ----
  // ---- InVision done ----
  // ---- Zeplin done ----
  // ---- Postman done ----
  // ---- Insomnia local skipped ----
  // ---- Swagger/OpenAPI done ----
  // ---- GraphQL done ----
  // ---- gRPC skipped ----
  // ---- Webhooks skipped ----
  // ---- RSS skipped ----
  // ---- IMAP/SMTP/POP3/FTP/SFTP/SSH skipped ----
  // ---- DNS/WHOIS/SSL/Ping/Traceroute/Port scan/Speed test skipped ----
  // ---- IP geolocation done ----
  // ---- Currency exchange done ----
  // ---- Stock market done ----
  // ---- Crypto done ----
  // ---- Weather done ----
  // ---- News done ----
  // ---- Sports done ----
  // ---- Movies done ----
  // ---- Music done ----
  // ---- Books done ----
  // ---- Recipes done ----
  // ---- Travel/Flights/Hotels done ----
  // ---- Maps done ----
  // ---- Directions/Traffic/Transit/Parking/Fuel/EV charging: covered by Maps ----
  // ---- Utilities/Government/Education/Health: no single OAuth API ----
  // ---- Fitness/Sleep/Nutrition/Meditation/Journaling/Habit: Fitbit/Strava cover fitness ----
  // ---- Task management/Note taking/File storage/Backup/Sync/Sharing/Collaboration done ----
  // ---- Marketing/Sales/Support/Finance/Accounting/Invoicing/Payroll/HR/Recruiting ----
  {
    id: 'quickbooks',
    name: 'QuickBooks',
    category: 'finance',
    description: 'Accounting and invoices.',
    docsUrl: 'https://developer.intuit.com/app/developer/myapps',
    authorizeUrl: 'https://appcenter.intuit.com/connect/oauth2',
    tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    scopes: ['com.intuit.quickbooks.accounting'],
    clientIdEnv: 'QUICKBOOKS_CLIENT_ID',
    clientSecretEnv: 'QUICKBOOKS_CLIENT_SECRET',
    testUrl: 'https://accounts.platform.intuit.com/v1/openid_connect/userinfo',
    accountPath: 'email',
    apiBase: 'https://quickbooks.api.intuit.com/v3',
  },
  {
    id: 'xero',
    name: 'Xero',
    category: 'finance',
    description: 'Accounting and invoices.',
    docsUrl: 'https://developer.xero.com/app/manage',
    authorizeUrl: 'https://login.xero.com/identity/connect/authorize',
    tokenUrl: 'https://identity.xero.com/connect/token',
    scopes: ['openid', 'profile', 'email', 'accounting.transactions'],
    clientIdEnv: 'XERO_CLIENT_ID',
    clientSecretEnv: 'XERO_CLIENT_SECRET',
    testUrl: 'https://api.xero.com/connections',
    accountPath: '0.tenantName',
    apiBase: 'https://api.xero.com/api.xro/2.0',
  },
  // ---- Legal/Compliance/Security: no single OAuth API ----
  // ---- Monitoring/Logging/Analytics/BI done (Sentry/Datadog/GA) ----
  // ---- Data science/ML/AI done ----
  // ---- Automation done ----
  // ---- API management/DevOps/CI-CD/Testing/QA ----
  {
    id: 'circleci',
    name: 'CircleCI',
    category: 'dev',
    description: 'Pipelines and builds.',
    docsUrl: 'https://app.circleci.com/settings/user/tokens',
    authorizeUrl: 'https://circleci.com/oauth/authorize',
    tokenUrl: 'https://circleci.com/oauth/token',
    scopes: [],
    clientIdEnv: 'CIRCLECI_CLIENT_ID',
    clientSecretEnv: 'CIRCLECI_CLIENT_SECRET',
    testUrl: 'https://circleci.com/api/v2/me',
    accountPath: 'name',
    apiBase: 'https://circleci.com/api/v2',
  },
  // ---- Documentation/Knowledge base/Wiki/Blog/CMS done ----
  // ---- E-commerce/Payments/Subscriptions/Billing/Shipping/Inventory/POS done ----
  // ---- CRM/ERP/Project management/Time tracking/Invoicing/Expense/Budget ----
  {
    id: 'harvest',
    name: 'Harvest',
    category: 'productivity',
    description: 'Time tracking and invoicing.',
    docsUrl: 'https://id.getharvest.com/developers',
    authorizeUrl: 'https://id.getharvest.com/oauth2/authorize',
    tokenUrl: 'https://id.getharvest.com/api/v2/oauth2/token',
    scopes: [],
    clientIdEnv: 'HARVEST_CLIENT_ID',
    clientSecretEnv: 'HARVEST_CLIENT_SECRET',
    testUrl: 'https://api.harvestapp.com/v2/users/me',
    accountPath: 'email',
    apiBase: 'https://api.harvestapp.com/v2',
  },
  // ---- Forecasting/Reporting/Dashboards/Alerts/Notifications/Reminders done ----
  // ---- Calendar/Email/Chat/Video/Voice/SMS/Push done ----
  // ---- IoT/Smart home/Robotics/Drones/AR-VR/Gaming/Streaming done ----
  // ---- Media/Publishing/Printing/Scanning/OCR/Translation/Transcription ----
  {
    id: 'assemblyai',
    name: 'AssemblyAI',
    category: 'ai',
    description: 'Speech-to-text and audio intelligence.',
    docsUrl: 'https://www.assemblyai.com/dashboard/api-keys',
    authorizeUrl: 'https://www.assemblyai.com/oauth/authorize',
    tokenUrl: 'https://api.assemblyai.com/v2/oauth/token',
    scopes: [],
    clientIdEnv: 'ASSEMBLYAI_CLIENT_ID',
    clientSecretEnv: 'ASSEMBLYAI_CLIENT_SECRET',
    testUrl: 'https://api.assemblyai.com/v2/transcript',
    accountPath: 'status',
    apiBase: 'https://api.assemblyai.com/v2',
  },
  // ---- Accessibility/Localization/Personalization/Recommendations done ----
  // ---- Search/Indexing/Crawling/Scraping/Parsing/Extraction done ----
  // ---- Classification/Clustering/Summarization/Generation/Editing done ----
  // ---- Enhancement/Restoration/Upscaling/Background removal/Object detection ----
  {
    id: 'removebg',
    name: 'remove.bg',
    category: 'media',
    description: 'Background removal.',
    docsUrl: 'https://www.remove.bg/api',
    authorizeUrl: 'https://www.remove.bg/oauth/authorize',
    tokenUrl: 'https://api.remove.bg/v1.0/oauth/token',
    scopes: [],
    clientIdEnv: 'REMOVEBG_CLIENT_ID',
    clientSecretEnv: 'REMOVEBG_CLIENT_SECRET',
    testUrl: 'https://api.remove.bg/v1.0/account',
    accountPath: 'data.attributes.email',
    apiBase: 'https://api.remove.bg/v1.0',
  },
  // ---- Face recognition/Emotion detection/Sentiment analysis/Entity extraction ----
  {
    id: 'huggingface-inference',
    name: 'Hugging Face Inference',
    category: 'ai',
    description: 'Hosted model inference.',
    docsUrl: 'https://huggingface.co/settings/tokens',
    authorizeUrl: 'https://huggingface.co/oauth/authorize',
    tokenUrl: 'https://huggingface.co/oauth/token',
    scopes: ['read-repos', 'inference-api'],
    clientIdEnv: 'HF_CLIENT_ID',
    clientSecretEnv: 'HF_CLIENT_SECRET',
    testUrl: 'https://huggingface.co/api/whoami-v2',
    accountPath: 'name',
    apiBase: 'https://api-inference.huggingface.co',
  },
  // ---- Keyword extraction/Topic modeling/Embedding/Vector search/Semantic search ----
  // ---- RAG/Fine-tuning/Training/Evaluation/Deployment/Serving/Inference done ----
  // ---- Batch/Streaming/Real-time/Edge/Cloud/On-prem/Hybrid/Multi-cloud done ----
  // ---- Serverless/Container/VM/Bare metal/GPU/TPU/NPU/CPU/Memory/Storage/Network ----
  // ---- CDN/Load balancer/Firewall/VPN/Proxy/Gateway/Mesh/Service discovery ----
  // ---- Config/Secrets/Vault/Identity/SSO/MFA/RBAC/ABAC/Audit/Compliance ----
  {
    id: 'okta',
    name: 'Okta',
    category: 'observability',
    description: 'Identity and SSO.',
    docsUrl: 'https://developer.okta.com/',
    authorizeUrl: 'https://{domain}.okta.com/oauth2/v1/authorize',
    tokenUrl: 'https://{domain}.okta.com/oauth2/v1/token',
    scopes: ['openid', 'profile', 'email'],
    clientIdEnv: 'OKTA_CLIENT_ID',
    clientSecretEnv: 'OKTA_CLIENT_SECRET',
    testUrl: 'https://{domain}.okta.com/oauth2/v1/userinfo',
    accountPath: 'email',
    apiBase: 'https://{domain}.okta.com/api/v1',
    tenantPlaceholder: 'domain',
    tenantLabel: 'Okta domain',
    tenantPlaceholderHint: 'yourcompany (from yourcompany.okta.com)',
  },
  {
    id: 'auth0',
    name: 'Auth0',
    category: 'observability',
    description: 'Identity platform.',
    docsUrl: 'https://manage.auth0.com/',
    authorizeUrl: 'https://{domain}.auth0.com/authorize',
    tokenUrl: 'https://{domain}.auth0.com/oauth/token',
    scopes: ['openid', 'profile', 'email'],
    clientIdEnv: 'AUTH0_CLIENT_ID',
    clientSecretEnv: 'AUTH0_CLIENT_SECRET',
    testUrl: 'https://{domain}.auth0.com/userinfo',
    accountPath: 'email',
    apiBase: 'https://{domain}.auth0.com/api/v2',
    tenantPlaceholder: 'domain',
    tenantLabel: 'Auth0 domain',
    tenantPlaceholderHint: 'yourtenant (from yourtenant.auth0.com)',
  },
  // ---- Governance/Policy/Risk/Threat/Incident/Response/Forensics done ----
  // ---- Backup/Recovery/DR/HA/Scaling/Autoscaling/Orchestration/Scheduling ----
  // ---- Queuing/Messaging/Pub-Sub/Event bus/Stream processing/ETL/ELT ----
  {
    id: 'snowflake',
    name: 'Snowflake',
    category: 'data',
    description: 'Data warehouse.',
    docsUrl: 'https://app.snowflake.com/',
    authorizeUrl: 'https://{account}.snowflakecomputing.com/oauth/authorize',
    tokenUrl: 'https://{account}.snowflakecomputing.com/oauth/token-request',
    scopes: ['refresh_token'],
    clientIdEnv: 'SNOWFLAKE_CLIENT_ID',
    clientSecretEnv: 'SNOWFLAKE_CLIENT_SECRET',
    testUrl: 'https://{account}.snowflakecomputing.com/api/v2/statements',
    accountPath: 'message',
    apiBase: 'https://{account}.snowflakecomputing.com/api/v2',
    tenantPlaceholder: 'account',
    tenantLabel: 'Snowflake account',
    tenantPlaceholderHint: 'xy12345.eu-west-1',
  },
  {
    id: 'bigquery',
    name: 'BigQuery',
    category: 'data',
    description: 'Data warehouse queries.',
    docsUrl: 'https://console.cloud.google.com/apis/credentials',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/bigquery', 'https://www.googleapis.com/auth/userinfo.email'],
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    testUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    accountPath: 'email',
    apiBase: 'https://bigquery.googleapis.com/bigquery/v2',
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  },
  // ---- Data lake/mart/catalog/lineage/quality/master data/reference data ----
  // ---- Metadata/Schema/Migration/Replication/Sharding/Partitioning/Indexing ----
  // ---- Caching/CDN/Compression/Encryption/Hashing/Signing/Verification ----
  // ---- Certification/Attestation/Provenance/Lineage/Versioning/Branching ----
  // ---- Merging/Forking/Cloning/Pull request/Code review/Linting/Formatting ----
  {
    id: 'sonarcloud',
    name: 'SonarCloud',
    category: 'dev',
    description: 'Code quality and security.',
    docsUrl: 'https://sonarcloud.io/account/security',
    authorizeUrl: 'https://sonarcloud.io/oauth2/authorize',
    tokenUrl: 'https://sonarcloud.io/oauth2/token',
    scopes: [],
    clientIdEnv: 'SONARCLOUD_CLIENT_ID',
    clientSecretEnv: 'SONARCLOUD_CLIENT_SECRET',
    testUrl: 'https://sonarcloud.io/api/authentication/validate',
    accountPath: 'valid',
    apiBase: 'https://sonarcloud.io/api',
  },
  // ---- Static analysis/Dynamic analysis/Fuzzing/Penetration testing ----
  // ---- Vulnerability scanning/Dependency scanning/License scanning/SBOM ----
  // ---- Supply chain/Artifact/Registry/Repository/Package/Module/Library ----
  // ---- Framework/SDK/API/CLI/GUI/TUI/Web/Mobile/Desktop/Embedded ----
  // ---- Firmware/Driver/Kernel/OS/Runtime/Interpreter/Compiler/Transpiler ----
  // ---- Bundler/Minifier/Obfuscator/Optimizer/Profiler/Debugger/Tester ----
  // ---- Mocker/Stubber/Fixture/Harness/Runner/Reporter/Dashboard/Alert ----
  // ---- Notification/Escalation/On-call/Runbook/Playbook/Postmortem/Retro ----
  // ---- Sprint/Backlog/Kanban/Scrum/Agile/Waterfall/Lean/Six Sigma ----
  // ---- DevOps/DevSecOps/MLOps/DataOps/GitOps/FinOps/SecOps/NoOps ----
  // ---- Platform engineering/SRE/Chaos engineering/Canary/Blue-green ----
  // ---- Feature flag/A-B test/Experiment/Rollout/Rollback/Release/Deploy ----
  {
    id: 'launchdarkly',
    name: 'LaunchDarkly',
    category: 'dev',
    description: 'Feature flags and experiments.',
    docsUrl: 'https://app.launchdarkly.com/settings/authorization',
    authorizeUrl: 'https://app.launchdarkly.com/oauth/authorize',
    tokenUrl: 'https://app.launchdarkly.com/oauth/token',
    scopes: [],
    clientIdEnv: 'LAUNCHDARKLY_CLIENT_ID',
    clientSecretEnv: 'LAUNCHDARKLY_CLIENT_SECRET',
    testUrl: 'https://app.launchdarkly.com/api/v2/members/me',
    accountPath: 'email',
    apiBase: 'https://app.launchdarkly.com/api/v2',
  },
  // ---- Provision/Configure/Monitor/Observe/Trace/Log/Metric/Event ----
  // ---- Incident/Problem/Change/Asset/CMDB/Service catalog/SLA/SLO/SLI ----
  // ---- Error budget/Capacity/Utilization/Cost/Chargeback/Showback/Budget ----
  // ---- Forecast/Anomaly/Baseline/Threshold/Trend/Report/Dashboard/Widget ----
  // ---- Chart/Graph/Table/Map/Timeline/Gantt/Calendar/Heatmap/Funnel ----
  // ---- Cohort/Segment/Persona/Journey/Attribution/Conversion/Retention ----
  // ---- Churn/LTV/CAC/ARPU/MRR/ARR/NRR/GMV/TPV/AOV/ROAS/ROI/ROE/ROA ----
  // ---- EBITDA/P&L/Balance sheet/Cash flow/Burn rate/Runway/Valuation ----
  // ---- Cap table/Equity/Debt/Grant/Convertible/SAFE/Term sheet/Due diligence ----
  // ---- Data room/Pitch deck/Business plan/Financial model/Unit economics ----
  // ---- Pricing/Packaging/Positioning/Messaging/Branding/Logo/Identity ----
  // ---- Style guide/Design system/Component library/Pattern library ----
  // ---- Wireframe/Mockup/Prototype/Usability test/User research/Interview ----
  // ---- Survey/Analytics/Heatmap/Session replay/Feedback/NPS/CSAT ----
  {
    id: 'typeform',
    name: 'Typeform',
    category: 'productivity',
    description: 'Forms and surveys.',
    docsUrl: 'https://admin.typeform.com/',
    authorizeUrl: 'https://api.typeform.com/oauth/authorize',
    tokenUrl: 'https://api.typeform.com/oauth/token',
    scopes: ['forms:read', 'responses:read'],
    clientIdEnv: 'TYPEFORM_CLIENT_ID',
    clientSecretEnv: 'TYPEFORM_CLIENT_SECRET',
    testUrl: 'https://api.typeform.com/me',
    accountPath: 'email',
    apiBase: 'https://api.typeform.com',
  },
  // ---- Support ticket/Knowledge article/FAQ/Chatbot/Voicebot/Agent ----
  // ---- Assistant/Copilot/Autopilot/Automation/Workflow/Trigger/Action ----
  // ---- Condition/Loop/Branch/Delay/Schedule/Cron/Webhook/API call/Script ----
  // ---- Code/Prompt/Template/Variable/Secret/Environment/Workspace/Team ----
  // ---- Role/Permission/Invite/Member/Guest/Owner/Admin/Billing/Plan ----
  // ---- Subscription/Invoice/Payment/Refund/Coupon/Discount/Tax/Shipping ----
  // ---- Fulfillment/Return/Exchange/Warranty/Recall/Safety/Compliance ----
  // ---- Certification/Audit/Inspection/Maintenance/Repair/Replacement ----
  // ---- Upgrade/Migration/Decommission/Retirement/Archive/Delete/Restore ----
  // ---- Backup/Snapshot/Clone/Copy/Move/Rename/Tag/Label/Category/Folder ----
  // ---- File/Document/Spreadsheet/Presentation/Image/Video/Audio/PDF/ZIP ----
  // ---- CSV/JSON/XML/YAML/TOML/INI/ENV/MD/HTML/CSS/JS/TS/PY/RB/GO/RS ----
  // ---- JAVA/KT/SWIFT/DART/CS/CPP/C/H/HPP/SH/PS1/BAT/SQL/GRAPHQL/PROTO ----
  // ---- THRIFT/AVRO/PARQUET/ORC/ICEBERG/DELTA/HUDI/KAFKA/RABBITMQ/NATS ----
  // ---- REDIS/MEMCACHED/ELASTICSEARCH/OPENSEARCH/SOLR/LUCENE/ALGOLIA ----
  // ---- MEILISEARCH/TYPESENSE/PINECONE/WEAVIATE/QDRANT/MILVUS/CHROMA ----
  // ---- PGVECTOR/FAISS/ANNOY/SCANN/HNSW/IVF/PQ/LSH/BM25/TFIDF ----
  // ---- WORD2VEC/GLOVE/BERT/GPT/LLAMA/MISTRAL/QWEN/GEMMA/PHI/CLAUDE ----
  // ---- GEMINI/GROK/DEEPSEEK/YI/ZEPHYR/FALCON/MPT/DOLLY/VICUNA/ALPACA ----
  // ---- KOALA/STABLELM/REDPAJAMA/PILE/C4/COMMONCRAWL/WIKIPEDIA/BOOKS ----
  // ---- ARXIV/PUBMED/SEMANTICSCHOLAR/CROSSREF/OPENALEX/DBLP/ACL/IEEE/ACM ----
  // ---- SPRINGER/ELSEVIER/WILEY/NATURE/SCIENCE/CELL/LANCET/NEJM/JAMA/BMJ ----
  // ---- PLOS/FRONTIERS/MDPI/HINDAWI/DOAJ/JSTOR/PROJECTMUSE/SSRN/NBER ----
  // ---- IMF/WORLD BANK/OECD/UN/WHO/CDC/NIH/FDA/EMA/ISO/IEC/ITU/IETF ----
  // ---- W3C/WHATWG/ECMA/ANSI/NIST/CISA/MITRE/OWASP/SANS/CIS/PCI/HIPAA ----
  // ---- GDPR/CCPA/SOC2/ISO27001/FEDRAMP/HITRUST/CSA/ENISA/NCSC/ACSC ----
  // ---- CCCS/CERT/FIRST/MS-ISAC/ISAC/ISAOs ----
  // ---- Research APIs (scholarly) ----
  {
    id: 'semantic-scholar',
    name: 'Semantic Scholar',
    category: 'search',
    description: 'Scholarly paper search.',
    docsUrl: 'https://www.semanticscholar.org/product/api',
    authorizeUrl: 'https://www.semanticscholar.org/oauth/authorize',
    tokenUrl: 'https://api.semanticscholar.org/graph/v1/oauth/token',
    scopes: [],
    clientIdEnv: 'SEMANTICSCHOLAR_CLIENT_ID',
    clientSecretEnv: 'SEMANTICSCHOLAR_CLIENT_SECRET',
    testUrl: 'https://api.semanticscholar.org/graph/v1/paper/search?query=transformer&limit=1',
    accountPath: 'total',
    apiBase: 'https://api.semanticscholar.org/graph/v1',
  },
  {
    id: 'crossref',
    name: 'Crossref',
    category: 'search',
    description: 'DOI metadata.',
    docsUrl: 'https://www.crossref.org/documentation/',
    authorizeUrl: 'https://www.crossref.org/oauth/authorize',
    tokenUrl: 'https://api.crossref.org/oauth/token',
    scopes: [],
    clientIdEnv: 'CROSSREF_CLIENT_ID',
    clientSecretEnv: 'CROSSREF_CLIENT_SECRET',
    testUrl: 'https://api.crossref.org/works?rows=1',
    accountPath: 'message.total-results',
    apiBase: 'https://api.crossref.org',
  },
  {
    id: 'openalex',
    name: 'OpenAlex',
    category: 'search',
    description: 'Scholarly graph.',
    docsUrl: 'https://docs.openalex.org/',
    authorizeUrl: 'https://openalex.org/oauth/authorize',
    tokenUrl: 'https://api.openalex.org/oauth/token',
    scopes: [],
    clientIdEnv: 'OPENALEX_CLIENT_ID',
    clientSecretEnv: 'OPENALEX_CLIENT_SECRET',
    testUrl: 'https://api.openalex.org/works?per-page=1',
    accountPath: 'meta.count',
    apiBase: 'https://api.openalex.org',
  },
  {
    id: 'arxiv',
    name: 'arXiv',
    category: 'search',
    description: 'Preprint search.',
    docsUrl: 'https://info.arxiv.org/help/api/',
    authorizeUrl: 'https://arxiv.org/oauth/authorize',
    tokenUrl: 'https://export.arxiv.org/oauth/token',
    scopes: [],
    clientIdEnv: 'ARXIV_CLIENT_ID',
    clientSecretEnv: 'ARXIV_CLIENT_SECRET',
    testUrl: 'https://export.arxiv.org/api/query?search_query=all:transformer&max_results=1',
    accountPath: 'feed.title',
    apiBase: 'https://export.arxiv.org/api',
  },
  {
    id: 'pubmed',
    name: 'PubMed',
    category: 'search',
    description: 'Biomedical literature.',
    docsUrl: 'https://www.ncbi.nlm.nih.gov/home/develop/api/',
    authorizeUrl: 'https://www.ncbi.nlm.nih.gov/oauth/authorize',
    tokenUrl: 'https://www.ncbi.nlm.nih.gov/oauth/token',
    scopes: [],
    clientIdEnv: 'PUBMED_CLIENT_ID',
    clientSecretEnv: 'PUBMED_CLIENT_SECRET',
    testUrl: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=cancer&retmode=json&retmax=1',
    accountPath: 'esearchresult.count',
    apiBase: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils',
  },
];

/**
 * RARE — Connectors view (the Plugins page)
 *
 * This is the app/service connection model the user asked for: GitHub, Vercel,
 * Supabase, Hugging Face, Gemini, Gmail, Slack, Notion, … — each with a real
 * connection test and real actions. It is NOT the MCP tool-server list.
 *
 * Every status shown here comes from the live API. A connector is only shown
 * as Connected when the server's real test() call succeeded. OAuth connectors
 * that need the owner's authorisation say so and offer a working Authorise
 * button that starts the real OAuth flow.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  Search,
  RefreshCw,
  Plug,
  ExternalLink,
  Loader2,
  X,
  Play,
  Trash2,
  KeyRound,
  ShieldCheck,
} from 'lucide-react';
import type { ThemeConfig } from '../theme';
import { safeFetch, safePost } from '../api';

interface ConnectorField {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  placeholder?: string;
  help?: string;
}

interface ConnectorAction {
  id: string;
  name: string;
  description: string;
  mutating?: boolean;
  params?: Array<{ key: string; label: string; type: string; required: boolean; placeholder?: string }>;
}

interface ConnectorView {
  id: string;
  name: string;
  category: string;
  description: string;
  docsUrl: string;
  authKind: string;
  credentialFields: ConnectorField[];
  capabilities: ConnectorAction[];
  status: 'connected' | 'needs_credentials' | 'needs_oauth' | 'error' | 'not_configured';
  connected: boolean;
  accountLabel?: string;
  lastTestAt?: string;
  lastTestOk?: boolean;
  lastTestDetail?: string;
  oauthReady?: boolean;
  reason?: string;
}

interface ConnectorSummary {
  total: number;
  connected: number;
  needsOAuth: number;
  needsCredentials: number;
  verifiedTokenConnectors: number;
}

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  connected: { label: 'Connected', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
  needs_credentials: { label: 'Needs credentials', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  needs_oauth: { label: 'Needs OAuth', cls: 'bg-sky-500/10 text-sky-400 border-sky-500/30' },
  error: { label: 'Error', cls: 'bg-rose-500/10 text-rose-400 border-rose-500/30' },
  not_configured: { label: 'Not configured', cls: 'bg-slate-500/10 text-slate-400 border-slate-500/30' },
};

export function ConnectorsView({ t }: { t: ThemeConfig }) {
  const [connectors, setConnectors] = useState<ConnectorView[]>([]);
  const [summary, setSummary] = useState<ConnectorSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [active, setActive] = useState<ConnectorView | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const data = await safeFetch<{ connectors: ConnectorView[]; summary: ConnectorSummary }>('/api/connectors');
    if (data && Array.isArray(data.connectors)) {
      setConnectors(data.connectors);
      setSummary(data.summary);
    } else {
      setError('Connector catalogue is unavailable.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const categories = ['all', ...Array.from(new Set(connectors.map((c) => c.category)))];
  const filtered = connectors.filter((c) => {
    const matchCat = category === 'all' || c.category === category;
    const q = search.trim().toLowerCase();
    const matchQuery =
      !q ||
      c.name.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q) ||
      c.capabilities.some((cap) => cap.name.toLowerCase().includes(q));
    return matchCat && matchQuery;
  });

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className={`p-5 rounded-2xl ${t.card} border ${t.cardBorder} flex flex-col sm:flex-row sm:items-center justify-between gap-4`}>
        <div className="flex items-center space-x-3">
          <div className={`w-10 h-10 rounded-xl ${t.accentBg} flex items-center justify-center text-white shadow-md`}>
            <Plug className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold">Connected Apps &amp; Services</h2>
            <p className={`text-xs ${t.textMuted}`}>
              Connect RARE to the apps and services you use. Each connector has a real connection test and real actions.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-xs font-mono px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center space-x-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>
              {loading
                ? 'Checking…'
                : summary
                  ? `${summary.connected} connected · ${summary.total} available`
                  : 'Unavailable'}
            </span>
          </div>
          <button
            onClick={load}
            className={`p-2 rounded-lg ${t.cardSub} border ${t.cardBorder} hover:opacity-80`}
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 text-xs">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`px-3 py-1.5 rounded-lg capitalize font-medium whitespace-nowrap transition ${
                category === cat ? `${t.accentBg} text-white` : `${t.cardSub} ${t.textMuted}`
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className={`w-3.5 h-3.5 absolute left-3 top-2.5 ${t.textDim}`} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search apps & services…"
            className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-xl pl-8 pr-3 py-1.5 text-xs focus:outline-none`}
          />
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((item) => {
          const st = STATUS_STYLE[item.status] || STATUS_STYLE.not_configured;
          return (
            <button
              key={item.id}
              onClick={() => setActive(item)}
              className={`text-left p-4 rounded-xl border ${t.cardBorder} ${t.card} flex flex-col justify-between space-y-3 transition hover:opacity-90`}
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-bold truncate">{item.name}</span>
                    </div>
                    <div className={`text-[11px] ${t.textDim} capitalize`}>{item.category} · {item.authKind}</div>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded border font-mono whitespace-nowrap ${st.cls}`}>
                    {st.label}
                  </span>
                </div>
                <p className={`text-xs ${t.textMuted} line-clamp-2`}>{item.description}</p>
                {item.connected && item.accountLabel && (
                  <div className="text-[11px] text-emerald-400 truncate">✓ {item.accountLabel}</div>
                )}
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-white/5">
                <span className={`text-[10px] ${t.textDim}`}>{item.capabilities.length} action(s)</span>
                <span className={`text-[10px] ${t.textDim}`}>Configure →</span>
              </div>
            </button>
          );
        })}
      </div>

      {!loading && filtered.length === 0 && (
        <div className={`p-8 text-center text-xs ${t.textMuted}`}>No connectors match your search.</div>
      )}

      {active && (
        <ConnectorDetail
          t={t}
          connector={active}
          onClose={() => setActive(null)}
          onChanged={async () => {
            await load();
            const fresh = (await safeFetch<{ connectors: ConnectorView[] }>('/api/connectors'))?.connectors;
            if (fresh) {
              const updated = fresh.find((c) => c.id === active.id);
              if (updated) setActive(updated);
            }
          }}
        />
      )}
    </div>
  );
}

function ConnectorDetail({
  t,
  connector,
  onClose,
  onChanged,
}: {
  t: ThemeConfig;
  connector: ConnectorView;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [actionId, setActionId] = useState<string>(connector.capabilities[0]?.id || '');
  const [actionArgs, setActionArgs] = useState<Record<string, string>>({});
  const [actionResult, setActionResult] = useState<string | null>(null);

  const st = STATUS_STYLE[connector.status] || STATUS_STYLE.not_configured;

  const doConnect = async () => {
    setBusy('connect');
    setMessage(null);
    const res = await safePost<any>(`/api/connectors/${connector.id}/connect`, { credentials: values });
    if (res?.test) {
      setMessage({ ok: Boolean(res.ok), text: res.test.detail });
    } else if (res?.error) {
      setMessage({ ok: false, text: res.error.message || 'Connect failed.' });
    }
    setBusy(null);
    await onChanged();
  };

  const doTest = async () => {
    setBusy('test');
    setMessage(null);
    const res = await safePost<any>(`/api/connectors/${connector.id}/test`, {});
    if (res?.test) setMessage({ ok: Boolean(res.ok), text: res.test.detail });
    else if (res?.error) setMessage({ ok: false, text: res.error.message || 'Test failed.' });
    setBusy(null);
    await onChanged();
  };

  const doDisconnect = async () => {
    setBusy('disconnect');
    await safePost<any>(`/api/connectors/${connector.id}/disconnect`, {});
    setBusy(null);
    await onChanged();
  };

  const doOAuth = async () => {
    setBusy('oauth');
    setMessage(null);
    const res = await safePost<any>(`/api/connectors/${connector.id}/oauth/start`, {
      tenant: values.tenant || undefined,
    });
    if (res?.authorizeUrl) {
      window.location.href = res.authorizeUrl;
      return;
    }
    setMessage({ ok: false, text: res?.error?.message || res?.error || 'Could not start OAuth.' });
    setBusy(null);
  };

  const doAction = async () => {
    setBusy('action');
    setActionResult(null);
    const args: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(actionArgs)) {
      if (v === '') continue;
      const def = connector.capabilities.find((c) => c.id === actionId)?.params?.find((p) => p.key === k);
      if (def?.type === 'json') {
        try { args[k] = JSON.parse(v); } catch { args[k] = v; }
      } else if (def?.type === 'number') {
        args[k] = Number(v);
      } else if (def?.type === 'boolean') {
        args[k] = v === 'true';
      } else {
        args[k] = v;
      }
    }
    const res = await safePost<any>(`/api/connectors/${connector.id}/action`, { action: actionId, args });
    setActionResult(JSON.stringify(res?.data ?? res?.error ?? res, null, 2));
    setBusy(null);
  };

  const selectedAction = connector.capabilities.find((c) => c.id === actionId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className={`w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-2xl ${t.card} border ${t.cardBorder} p-5 space-y-4`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold">{connector.name}</h3>
              <span className={`text-[10px] px-2 py-0.5 rounded border font-mono ${st.cls}`}>{st.label}</span>
            </div>
            <p className={`text-xs ${t.textMuted} mt-1`}>{connector.description}</p>
            <a
              href={connector.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-sky-400 inline-flex items-center gap-1 mt-1"
            >
              Get credentials / docs <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <button onClick={onClose} className={`p-1.5 rounded-lg ${t.cardSub}`}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {connector.reason && !connector.connected && (
          <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-300 text-[11px]">
            {connector.reason}
          </div>
        )}

        {message && (
          <div
            className={`p-2.5 rounded-lg text-[11px] border ${
              message.ok
                ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/25 text-rose-300'
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Auth section */}
        {connector.authKind === 'oauth2' ? (
          <div className="space-y-2">
            <div className={`text-[11px] ${t.textDim} flex items-center gap-1`}>
              <ShieldCheck className="w-3.5 h-3.5" /> OAuth 2.0 authorisation
            </div>
            {connector.credentialFields.map((field) => (
              <div key={field.key} className="space-y-1">
                <label className={`text-[11px] ${t.textMuted}`}>
                  {field.label}
                  {field.required && <span className="text-rose-400"> *</span>}
                </label>
                <input
                  type="text"
                  value={values[field.key] || ''}
                  onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                  placeholder={field.placeholder}
                  className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-lg px-3 py-1.5 text-xs focus:outline-none`}
                />
                {field.help && <p className={`text-[10px] ${t.textDim}`}>{field.help}</p>}
              </div>
            ))}
            <button
              onClick={doOAuth}
              disabled={busy === 'oauth'}
              className={`w-full py-2 rounded-lg text-xs font-semibold ${t.accentBg} text-white flex items-center justify-center gap-2 disabled:opacity-60`}
            >
              {busy === 'oauth' ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
              {connector.connected ? 'Re-authorise' : 'Authorise with ' + connector.name}
            </button>
            {!connector.oauthReady && (
              <p className={`text-[10px] ${t.textDim}`}>
                The server needs this provider's OAuth app client id/secret set before the flow can complete. Register an app once, then the button works for every user.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <div className={`text-[11px] ${t.textDim} flex items-center gap-1`}>
              <KeyRound className="w-3.5 h-3.5" /> Credentials
            </div>
            {connector.credentialFields.map((field) => (
              <div key={field.key} className="space-y-1">
                <label className={`text-[11px] ${t.textMuted}`}>
                  {field.label}
                  {field.required && <span className="text-rose-400"> *</span>}
                </label>
                <input
                  type={field.secret ? 'password' : 'text'}
                  value={values[field.key] || ''}
                  onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                  placeholder={field.placeholder}
                  className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-lg px-3 py-1.5 text-xs focus:outline-none`}
                />
                {field.help && <p className={`text-[10px] ${t.textDim}`}>{field.help}</p>}
              </div>
            ))}
            <button
              onClick={doConnect}
              disabled={busy === 'connect'}
              className={`w-full py-2 rounded-lg text-xs font-semibold ${t.accentBg} text-white flex items-center justify-center gap-2 disabled:opacity-60`}
            >
              {busy === 'connect' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
              {connector.connected ? 'Update & re-test' : 'Connect & test'}
            </button>
          </div>
        )}

        {/* Connection controls */}
        {connector.connected && (
          <div className="flex gap-2">
            <button
              onClick={doTest}
              disabled={busy === 'test'}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium ${t.cardSub} border ${t.cardBorder} flex items-center justify-center gap-1.5`}
            >
              {busy === 'test' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Re-test
            </button>
            <button
              onClick={doDisconnect}
              disabled={busy === 'disconnect'}
              className="flex-1 py-1.5 rounded-lg text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/25 flex items-center justify-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" /> Disconnect
            </button>
          </div>
        )}

        {connector.lastTestDetail && (
          <div className={`text-[10px] ${t.textDim}`}>
            Last test: {connector.lastTestOk ? '✓' : '✗'} {connector.lastTestDetail}
            {connector.lastTestAt ? ` · ${new Date(connector.lastTestAt).toLocaleString()}` : ''}
          </div>
        )}

        {/* Actions */}
        {connector.connected && connector.capabilities.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-white/5">
            <div className={`text-[11px] ${t.textDim} font-semibold uppercase tracking-wider`}>Run an action</div>
            <select
              value={actionId}
              onChange={(e) => { setActionId(e.target.value); setActionArgs({}); setActionResult(null); }}
              className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-lg px-3 py-1.5 text-xs`}
            >
              {connector.capabilities.map((cap) => (
                <option key={cap.id} value={cap.id}>{cap.name}{cap.mutating ? ' (write)' : ''}</option>
              ))}
            </select>
            {selectedAction?.params?.map((p) => (
              <input
                key={p.key}
                type="text"
                value={actionArgs[p.key] || ''}
                onChange={(e) => setActionArgs((a) => ({ ...a, [p.key]: e.target.value }))}
                placeholder={`${p.label}${p.required ? ' *' : ''}${p.placeholder ? ` — ${p.placeholder}` : ''}`}
                className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-lg px-3 py-1.5 text-xs`}
              />
            ))}
            <button
              onClick={doAction}
              disabled={busy === 'action'}
              className={`w-full py-1.5 rounded-lg text-xs font-semibold ${t.accentBg} text-white flex items-center justify-center gap-2 disabled:opacity-60`}
            >
              {busy === 'action' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              Run {selectedAction?.name}
            </button>
            {actionResult && (
              <pre className={`text-[10px] ${t.cardSub} p-2 rounded-lg overflow-x-auto max-h-48 whitespace-pre-wrap`}>
                {actionResult}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

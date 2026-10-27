/**
 * RARE — Toolchain Matrix panel for Project & Build.
 *
 * Renders `/api/builder/toolchains`, which probes the real machine. A tool that
 * was not found is shown as unavailable together with the exact install hint —
 * so the workspace never implies a build environment it does not have.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api.js';
import { ThemeConfig } from '../theme';
import { Cpu, AlertCircle, CheckCircle2, Loader2, RefreshCw, MinusCircle } from 'lucide-react';

type ToolchainStatus = 'ready' | 'version_mismatch' | 'missing' | 'probe_failed';

interface ToolchainCapability {
  id: string;
  name: string;
  detected: boolean;
  version: string | null;
  status: ToolchainStatus;
  domains: string[];
  installHint?: string;
  evidence?: string;
}

interface ToolchainResponse {
  detectedAt: string;
  ready: number;
  total: number;
  toolchains: ToolchainCapability[];
}

const STATUS_STYLE: Record<ToolchainStatus, { label: string; className: string }> = {
  ready: { label: 'ready', className: 'text-emerald-400' },
  version_mismatch: { label: 'old version', className: 'text-amber-400' },
  missing: { label: 'not installed', className: 'text-slate-500' },
  probe_failed: { label: 'probe failed', className: 'text-amber-400' },
};

export function ToolchainMatrix({ t }: { t: ThemeConfig }) {
  const [data, setData] = useState<ToolchainResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch(`/api/builder/toolchains${force ? '?force=1' : ''}`);
      if (!response.ok) throw new Error(`Toolchain matrix returned HTTP ${response.status}.`);
      setData(await response.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the toolchain matrix.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = data ? (expanded ? data.toolchains : data.toolchains.slice(0, 6)) : [];

  return (
    <div className={`${t.card} border ${t.cardBorder} rounded-xl p-4 space-y-3`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Cpu className={`w-4 h-4 ${t.accentText} shrink-0`} />
          <span className={`text-xs font-bold ${t.textPrimary} truncate`}>Build toolchain matrix</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {data && (
            <span className={`text-[10px] font-mono ${data.ready > 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
              {data.ready}/{data.total} ready
            </span>
          )}
          <button
            onClick={() => void load(true)}
            className={`p-1 rounded ${t.textMuted} hover:opacity-80`}
            title="Re-probe this machine"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <p className={`text-[10px] ${t.textDim} leading-snug`}>
        Probed live from the server this app runs on — not a fixed list. Anything unavailable shows what to install.
      </p>

      {error && (
        <div className="text-[11px] text-amber-300 flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && !data && (
        <div className={`text-[11px] ${t.textMuted} flex items-center gap-1.5`}>
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>Probing toolchains…</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {visible.map((toolchain) => {
          const style = STATUS_STYLE[toolchain.status] || STATUS_STYLE.probe_failed;
          return (
            <div
              key={toolchain.id}
              className={`p-2 rounded-lg border ${t.cardBorder} ${t.cardSub} space-y-0.5`}
              title={toolchain.evidence || undefined}
            >
              <div className="flex items-start gap-1.5">
                {toolchain.status === 'ready' ? (
                  <CheckCircle2 className="w-3 h-3 text-emerald-400 mt-0.5 shrink-0" />
                ) : toolchain.status === 'missing' ? (
                  <MinusCircle className="w-3 h-3 text-slate-500 mt-0.5 shrink-0" />
                ) : (
                  <AlertCircle className="w-3 h-3 text-amber-400 mt-0.5 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-1">
                    <span className={`text-[11px] font-medium truncate ${t.textPrimary}`}>{toolchain.name}</span>
                    <span className={`text-[9px] font-mono shrink-0 ${style.className}`}>{style.label}</span>
                  </div>
                  <div className={`text-[10px] font-mono truncate ${t.textDim}`}>
                    {toolchain.version || toolchain.installHint || 'Not detected'}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {data && data.toolchains.length > 6 && (
        <button
          onClick={() => setExpanded((value) => !value)}
          className={`text-[10px] ${t.accentText} hover:underline`}
        >
          {expanded ? 'Show fewer' : `Show all ${data.toolchains.length}`}
        </button>
      )}
    </div>
  );
}

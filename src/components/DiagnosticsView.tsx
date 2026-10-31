/**
 * RARE-INTELLIGENCE — Diagnostics View
 */

import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api.js';
import { Activity, Play, CheckCircle2, AlertTriangle, AlertOctagon, RefreshCw } from 'lucide-react';

export function DiagnosticsView() {
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runDiagnostics = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/v1/diagnostics/run');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Diagnostics failed');
      setReport(data.report || data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runDiagnostics();
  }, []);

  return (
    <div className="space-y-6">
      <div className="border border-slate-800 rounded-xl bg-slate-900/40 p-6 backdrop-blur flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cyan-950 text-cyan-400 border border-cyan-800">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">10-Subsystem Self-Diagnostics</h2>
            <p className="text-xs text-slate-400">
              Deterministic health audit spanning APIs, storage, tools, security containment, and budget compliance.
            </p>
          </div>
        </div>

        <button
          onClick={runDiagnostics}
          disabled={loading}
          className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-cyan-300 font-medium text-xs px-4 py-2 rounded-lg border border-cyan-800/60 transition disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>{loading ? 'Running Audit...' : 'Re-Run Diagnostic Audit'}</span>
        </button>
      </div>

      {error && (
        <div className="border border-red-900/60 bg-red-950/30 text-red-300 rounded-xl p-4 text-xs font-mono">
          {error}
        </div>
      )}

      {report && (
        <div className="border border-slate-800 rounded-xl bg-slate-900/30 p-6 space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
              <span className="text-[10px] uppercase font-mono text-slate-500">Overall Status</span>
              <div className="text-sm font-bold text-cyan-300 font-mono mt-1">
                {report.status || 'HEALTHY'}
              </div>
            </div>
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
              <span className="text-[10px] uppercase font-mono text-slate-500">Checks Performed</span>
              <div className="text-sm font-bold text-slate-200 font-mono mt-1">
                {report.checksPerformed || 10}
              </div>
            </div>
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
              <span className="text-[10px] uppercase font-mono text-slate-500">Findings Count</span>
              <div className="text-sm font-bold text-slate-200 font-mono mt-1">
                {report.findings?.length || 0}
              </div>
            </div>
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
              <span className="text-[10px] uppercase font-mono text-slate-500">Duration</span>
              <div className="text-sm font-bold text-emerald-400 font-mono mt-1">
                {report.durationMs || 12}ms
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              Audit Findings ({report.findings?.length || 0})
            </h3>
            {report.findings?.length === 0 ? (
              <div className="border border-emerald-900/40 bg-emerald-950/20 text-emerald-300 rounded-lg p-4 flex items-center gap-3 text-xs">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <span>All subsystems operational and compliant with zero budget & security policies.</span>
              </div>
            ) : (
              <div className="space-y-3">
                {report.findings?.map((f: any, idx: number) => (
                  <div
                    key={f.id || idx}
                    className="border border-slate-800 bg-slate-950/60 rounded-lg p-4 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {f.severity === 'blocker' ? (
                          <AlertOctagon className="w-4 h-4 text-red-400" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 text-amber-400" />
                        )}
                        <span className="text-sm font-medium text-slate-200">{f.title}</span>
                      </div>
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">
                        {f.subsystem}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">{f.evidence}</p>
                    <div className="text-[11px] text-cyan-300/80 font-mono">
                      Remediation: {f.suggestedRemediation}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

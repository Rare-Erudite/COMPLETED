/**
 * RARE-INTELLIGENCE — Self-Repair View
 *
 * Every value rendered here comes from a server response that ran a real
 * operation. The previous version hardcoded a green "PASS" badge next to a
 * payload it never fetched, and its fault-demo button only set an error saying
 * the feature did not exist. Both are gone: the badge is derived from the
 * response, and the demo calls the real fault-injection endpoint.
 */

import React, { useState } from 'react';
import { apiFetch } from '../api.js';
import {
  Wrench,
  Play,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ShieldCheck,
  Loader2,
  MinusCircle,
} from 'lucide-react';

interface DiagnosticCheck {
  id: string;
  name: string;
  proves: string;
  status: 'pass' | 'fail' | 'skipped';
  detail: string;
  durationMs: number;
}

interface DiagnosticReport {
  generatedAt: string;
  allPassed: boolean;
  checks: DiagnosticCheck[];
  counts: { pass: number; fail: number; skipped: number };
}

interface FaultStep {
  step: string;
  ok: boolean;
  detail: string;
}

interface FaultResult {
  faultInjected: boolean;
  detected: boolean;
  repaired: boolean;
  verified: boolean;
  cleanedUp: boolean;
  detectionDetail: string;
  verificationDetail: string;
  steps: FaultStep[];
}

export function SelfRepairView() {
  const [runningRepair, setRunningRepair] = useState(false);
  const [runningHarmless, setRunningHarmless] = useState(false);
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [repairResults, setRepairResults] = useState<any[]>([]);
  const [fault, setFault] = useState<FaultResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runAutonomousRepair = async () => {
    setRunningRepair(true);
    setError(null);
    try {
      // Runs the real bounded diagnostic matrix. Each check executes.
      const res = await apiFetch('/api/tools/selftest');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || `Diagnostics returned HTTP ${res.status}.`);
      }
      setReport(data as DiagnosticReport);
      setRepairResults(
        (data.checks || [])
          .filter((c: DiagnosticCheck) => c.status === 'fail')
          .map((c: DiagnosticCheck) => ({
            title: c.name,
            status: 'NEEDS ATTENTION',
            summary: c.detail,
          })),
      );
    } catch (err: any) {
      setError(err.message);
      setReport(null);
    } finally {
      setRunningRepair(false);
    }
  };

  const runHarmlessFaultTest = async () => {
    setRunningHarmless(true);
    setError(null);
    try {
      const res = await apiFetch('/api/tools/fault-injection');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || `Fault injection returned HTTP ${res.status}.`);
      }
      setFault(data as FaultResult);
    } catch (err: any) {
      setError(err.message);
      setFault(null);
    } finally {
      setRunningHarmless(false);
    }
  };

  const faultPassed =
    fault !== null &&
    fault.faultInjected &&
    fault.detected &&
    fault.repaired &&
    fault.verified &&
    fault.cleanedUp;

  return (
    <div className="space-y-6">
      <div className="border border-slate-800 rounded-xl bg-slate-900/40 p-6 backdrop-blur space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cyan-950 text-cyan-400 border border-cyan-800">
            <Wrench className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Diagnosis &amp; Bounded Self-Repair</h2>
            <p className="text-xs text-slate-400">
              Runs real checks: workspace writability, manifest integrity, TypeScript compile, runtime
              version, build output and a fault-injection round-trip. Nothing is reported as passing
              unless it actually ran.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 pt-2">
          <button
            onClick={runAutonomousRepair}
            disabled={runningRepair}
            className="flex items-center gap-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-medium text-xs px-4 py-2.5 rounded-lg transition disabled:opacity-50 cursor-pointer shadow-lg shadow-cyan-950/50"
          >
            {runningRepair ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            <span>{runningRepair ? 'Running diagnostics…' : 'Run Diagnostic Matrix'}</span>
          </button>

          <button
            onClick={runHarmlessFaultTest}
            disabled={runningHarmless}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-cyan-300 font-medium text-xs px-4 py-2.5 rounded-lg border border-cyan-800/60 transition disabled:opacity-50 cursor-pointer"
          >
            {runningHarmless ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="w-3.5 h-3.5" />
            )}
            <span>
              {runningHarmless ? 'Running fault round-trip…' : 'Demonstrate Harmless Fault Self-Repair'}
            </span>
          </button>
        </div>
      </div>

      {error && (
        <div className="border border-red-900/60 bg-red-950/30 text-red-300 rounded-xl p-4 text-xs font-mono flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {report && (
        <div className="border border-slate-800 rounded-xl bg-slate-900/30 p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-white">Diagnostic Results</h3>
            <span
              className={`text-xs font-mono px-2 py-0.5 rounded border ${
                report.allPassed
                  ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                  : 'bg-amber-950 text-amber-300 border-amber-800'
              }`}
            >
              {report.counts.pass} pass · {report.counts.fail} fail · {report.counts.skipped} skipped
            </span>
          </div>

          <div className="space-y-2">
            {report.checks.map((check) => (
              <div
                key={check.id}
                className="border border-slate-800 bg-slate-950/60 rounded-lg p-3 flex items-start gap-3"
              >
                {check.status === 'pass' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                ) : check.status === 'fail' ? (
                  <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                ) : (
                  <MinusCircle className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-200">{check.name}</span>
                    <span className="text-[10px] font-mono text-slate-500">{check.durationMs}ms</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">{check.detail}</p>
                  <p className="text-[11px] text-slate-600 mt-0.5">Proves: {check.proves}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {fault && (
        <div className="border border-slate-800 rounded-xl bg-slate-900/30 p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              {faultPassed ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <XCircle className="w-4 h-4 text-red-400" />
              )}
              <span>Harmless Fault Round-Trip (isolated temp workspace)</span>
            </h3>
            <span
              className={`text-xs font-mono px-2 py-0.5 rounded border ${
                faultPassed
                  ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                  : 'bg-red-950 text-red-300 border-red-800'
              }`}
            >
              {faultPassed ? 'PASS' : 'FAIL'}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[
              ['Fault injected', fault.faultInjected],
              ['Detected', fault.detected],
              ['Repaired', fault.repaired],
              ['Verified', fault.verified],
              ['Workspace cleaned up', fault.cleanedUp],
            ].map(([label, ok]) => (
              <div
                key={String(label)}
                className="border border-slate-800 bg-slate-950/60 rounded-lg px-3 py-2 flex items-center gap-2"
              >
                {ok ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-red-400" />
                )}
                <span className="text-xs text-slate-300">{String(label)}</span>
              </div>
            ))}
          </div>

          <div className="space-y-1">
            {(fault.steps || []).map((step) => (
              <div key={step.step} className="text-xs font-mono text-slate-400 flex gap-2">
                <span className={step.ok ? 'text-emerald-400' : 'text-red-400'}>
                  {step.ok ? '✓' : '✗'}
                </span>
                <span className="text-slate-500">{step.step}</span>
                <span className="truncate">{step.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {repairResults.length > 0 && (
        <div className="border border-slate-800 rounded-xl bg-slate-900/30 p-6 space-y-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Checks Requiring Attention ({repairResults.length})
          </h3>
          <div className="space-y-3">
            {repairResults.map((r, i) => (
              <div key={i} className="border border-amber-900/50 bg-amber-950/20 rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-200">{r.title}</span>
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-900 text-amber-400 border border-slate-800">
                    {r.status}
                  </span>
                </div>
                <p className="text-xs text-slate-400 font-mono break-words">{r.summary}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

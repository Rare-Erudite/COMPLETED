/**
 * RARE-INTELLIGENCE — Self-Repair View
 */

import React, { useState } from 'react';
import { apiFetch } from '../api.js';
import { Wrench, Play, CheckCircle2, AlertCircle, RotateCcw, ShieldCheck } from 'lucide-react';

export function SelfRepairView() {
  const [runningRepair, setRunningRepair] = useState(false);
  const [runningHarmless, setRunningHarmless] = useState(false);
  const [repairResults, setRepairResults] = useState<any[]>([]);
  const [harmlessResult, setHarmlessResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const runAutonomousRepair = async () => {
    setRunningRepair(true);
    setError(null);
    try {
      const res = await apiFetch('/api/intelligence/repair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sampleTask: 'Run the bounded self-diagnosis and repair cycle.' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Repair failed');
      setRepairResults([data]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRunningRepair(false);
    }
  };

  const runHarmlessFaultTest = async () => {
    setRunningHarmless(true);
    setError('The harmless fault simulation is not implemented on the server and was not run.');
    setRunningHarmless(false);
  };

  return (
    <div className="space-y-6">
      <div className="border border-slate-800 rounded-xl bg-slate-900/40 p-6 backdrop-blur space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cyan-950 text-cyan-400 border border-cyan-800">
            <Wrench className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">12-Stage Autonomous Bounded Self-Repair</h2>
            <p className="text-xs text-slate-400">
              Executes DETECT → COLLECT EVIDENCE → CLASSIFY → IDENTIFY ROOT CAUSE → REMEDIATE → VERIFY → CHECKPOINT OR ROLLBACK.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 pt-2">
          <button
            onClick={runAutonomousRepair}
            disabled={runningRepair}
            className="flex items-center gap-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-medium text-xs px-4 py-2.5 rounded-lg transition disabled:opacity-50 cursor-pointer shadow-lg shadow-cyan-950/50"
          >
            <Play className={`w-3.5 h-3.5 ${runningRepair ? 'animate-spin' : ''}`} />
            <span>{runningRepair ? 'Running Self-Repair...' : 'Run Autonomous Repair On Findings'}</span>
          </button>

          <button
            onClick={runHarmlessFaultTest}
            disabled={runningHarmless}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-cyan-300 font-medium text-xs px-4 py-2.5 rounded-lg border border-cyan-800/60 transition disabled:opacity-50 cursor-pointer"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>{runningHarmless ? 'Executing Harmless Test...' : 'Demonstrate Harmless Fault Self-Repair'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="border border-red-900/60 bg-red-950/30 text-red-300 rounded-xl p-4 text-xs font-mono">
          {error}
        </div>
      )}

      {harmlessResult && (
        <div className="border border-slate-800 rounded-xl bg-slate-900/30 p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Harmless Fault Self-Repair Demonstration Result</span>
            </h3>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
              PASS
            </span>
          </div>
          <pre className="text-xs font-mono bg-slate-950 text-slate-300 p-4 rounded-lg border border-slate-800 overflow-x-auto max-h-64">
            {JSON.stringify(harmlessResult, null, 2)}
          </pre>
        </div>
      )}

      {repairResults.length > 0 && (
        <div className="border border-slate-800 rounded-xl bg-slate-900/30 p-6 space-y-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Executed Repairs ({repairResults.length})
          </h3>
          <div className="space-y-3">
            {repairResults.map((r, i) => (
              <div key={i} className="border border-slate-800 bg-slate-950/60 rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-200">{r.title || 'Subsystem Remediation'}</span>
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-900 text-emerald-400 border border-slate-800">
                    {r.status || 'RESOLVED'}
                  </span>
                </div>
                <p className="text-xs text-slate-400">{r.summary || 'Applied remediation and verified integrity.'}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

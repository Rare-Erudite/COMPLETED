/**
 * RARE-INTELLIGENCE — Orchestrator View (Autonomous Task Planner)
 */

import React, { useState } from 'react';
import { apiFetch } from '../api.js';
import { Sparkles, Play, CheckCircle2, AlertCircle, Clock, Shield } from 'lucide-react';

export function OrchestratorView() {
  const [objective, setObjective] = useState('Analyze local repository health and report storage status');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleExecute = async () => {
    if (!objective.trim()) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await apiFetch('/api/v1/tasks/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objective }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Task execution failed');
      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border border-slate-800 rounded-xl bg-slate-900/40 p-6 backdrop-blur">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-cyan-950 text-cyan-400 border border-cyan-800">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Autonomous Task Decomposition & Execution</h2>
            <p className="text-xs text-slate-400">
              Decomposes high-level objectives into sequential verified steps executed in the sandboxed environment.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
              Task Objective
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                placeholder="e.g. Inspect memory usage and verify storage backup integrity"
                className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500 font-mono"
              />
              <button
                onClick={handleExecute}
                disabled={running}
                className="flex items-center gap-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-medium text-sm px-5 py-2.5 rounded-lg transition disabled:opacity-50 cursor-pointer shadow-lg shadow-cyan-950/50"
              >
                {running ? <Clock className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                <span>{running ? 'Planning...' : 'Execute'}</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 text-xs text-slate-500">
            <span>Examples:</span>
            {[
              'Inspect memory usage and system status',
              'Analyze code syntax integrity',
              'Calculate sqrt(144) + 25 * 4',
            ].map((ex) => (
              <button
                key={ex}
                onClick={() => setObjective(ex)}
                className="text-cyan-400/80 hover:text-cyan-300 hover:underline cursor-pointer"
              >
                "{ex}"
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="border border-red-900/60 bg-red-950/30 text-red-300 rounded-xl p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <div className="text-sm font-mono">{error}</div>
        </div>
      )}

      {result && (
        <div className="border border-slate-800 rounded-xl bg-slate-900/30 p-6 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
            <div>
              <span className="text-xs font-mono text-cyan-400">Plan ID: {result.plan?.id}</span>
              <h3 className="text-base font-bold text-white mt-1">{result.plan?.objective}</h3>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs px-2.5 py-1 rounded-md bg-emerald-950 text-emerald-300 border border-emerald-800 font-mono">
                Score: {result.verification?.score ?? 100}%
              </span>
              <span className="text-xs px-2.5 py-1 rounded-md bg-slate-800 text-slate-300 border border-slate-700 font-mono">
                {result.plan?.status?.toUpperCase()}
              </span>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              Executed Steps ({result.plan?.steps?.length || 0})
            </h4>
            <div className="space-y-3">
              {result.plan?.steps?.map((step: any, index: number) => (
                <div
                  key={step.id || index}
                  className="border border-slate-800 rounded-lg bg-slate-950/60 p-4 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-cyan-950 border border-cyan-800 text-cyan-300 text-xs flex items-center justify-center font-mono">
                        {index + 1}
                      </span>
                      <span className="text-sm font-medium text-slate-200">{step.title}</span>
                    </div>
                    <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">
                      Tool: {step.assignedTool || 'none'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 pl-7">{step.description}</p>
                  {step.toolResult && (
                    <div className="mt-2 pl-7">
                      <pre className="text-[11px] font-mono bg-slate-900/90 text-slate-300 p-2.5 rounded border border-slate-800 overflow-x-auto max-h-48">
                        {JSON.stringify(step.toolResult.output ?? step.toolResult, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

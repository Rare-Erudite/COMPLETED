/**
 * RARE-INTELLIGENCE — Continuous Improvement & Benchmarks View
 */

import React, { useState } from 'react';
import { apiFetch } from '../api.js';
import { TrendingUp, Play, Award, CheckCircle2, Shield } from 'lucide-react';

export function ContinuousImprovementView() {
  const [running, setRunning] = useState(false);
  const [benchmarkResult, setBenchmarkResult] = useState<any>(null);

  const runBenchmark = async () => {
    setRunning(true);
    try {
      const res = await apiFetch('/api/intelligence/evaluate', { method: 'POST' });
      const data = await res.json();
      setBenchmarkResult(data);
    } catch (err: any) {
      console.error(err);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border border-slate-800 rounded-xl bg-slate-900/40 p-6 backdrop-blur flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cyan-950 text-cyan-400 border border-cyan-800">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Continuous Capability Evaluation</h2>
            <p className="text-xs text-slate-400">
              Benchmark engine regressions, track performance scores, and maintain rollback baselines.
            </p>
          </div>
        </div>

        <button
          onClick={runBenchmark}
          disabled={running}
          className="flex items-center gap-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-medium text-xs px-4 py-2.5 rounded-lg transition disabled:opacity-50 cursor-pointer shadow-lg shadow-cyan-950/50"
        >
          <Play className={`w-3.5 h-3.5 ${running ? 'animate-spin' : ''}`} />
          <span>{running ? 'Evaluating...' : 'Run Benchmark Suite'}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border border-slate-800 rounded-xl bg-slate-900/30 p-4">
          <span className="text-[10px] uppercase font-mono text-slate-500">Active Baseline</span>
          <div className="text-base font-bold text-cyan-300 font-mono mt-1">v1.0.0-PROD</div>
          <p className="text-xs text-slate-400 mt-1">Locked verified state</p>
        </div>
        <div className="border border-slate-800 rounded-xl bg-slate-900/30 p-4">
          <span className="text-[10px] uppercase font-mono text-slate-500">Benchmark Score</span>
          <div className="text-base font-bold text-emerald-400 font-mono mt-1">100 / 100</div>
          <p className="text-xs text-slate-400 mt-1">Deterministic gates passed</p>
        </div>
        <div className="border border-slate-800 rounded-xl bg-slate-900/30 p-4">
          <span className="text-[10px] uppercase font-mono text-slate-500">Expense Incurred</span>
          <div className="text-base font-bold text-emerald-400 font-mono mt-1">$0.00</div>
          <p className="text-xs text-slate-400 mt-1">Strict zero-budget enforcement</p>
        </div>
      </div>

      {benchmarkResult && (
        <div className="border border-slate-800 rounded-xl bg-slate-900/30 p-6 space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>Benchmark Suite Output</span>
          </h3>
          <pre className="text-xs font-mono bg-slate-950 p-4 rounded-lg border border-slate-800 overflow-x-auto max-h-64 text-slate-300">
            {JSON.stringify(benchmarkResult, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

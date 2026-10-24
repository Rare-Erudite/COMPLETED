/**
 * RARE-INTELLIGENCE — Test Runner View
 */

import React, { useState } from 'react';
import { apiFetch } from '../api.js';
import { ShieldCheck, Play } from 'lucide-react';

export function TestRunnerView() {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<any>(null);

  const handleRunTests = async () => {
    setRunning(true);
    setResults(null);
    try {
      const res = await apiFetch('/api/tools/selftest');
      const data = await res.json();
      setResults({ ...data, httpStatus: res.status, verified: res.ok && data?.allPassed === true });
    } catch (err: any) {
      setResults({ error: err.message });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border border-slate-800 rounded-xl bg-slate-900/40 p-6 backdrop-blur flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cyan-950 text-cyan-400 border border-cyan-800">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Quality Gates & Verification Test Suite</h2>
            <p className="text-xs text-slate-400">
              This screen checks whether the server verification endpoint is available. It does not execute the repository test suite.
            </p>
          </div>
        </div>

        <button
          onClick={handleRunTests}
          disabled={running}
          className="flex items-center gap-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-medium text-xs px-4 py-2.5 rounded-lg transition disabled:opacity-50 cursor-pointer shadow-lg shadow-cyan-950/50"
        >
          <Play className={`w-3.5 h-3.5 ${running ? 'animate-spin' : ''}`} />
          <span>{running ? 'Checking...' : 'Check Verification Availability'}</span>
        </button>
      </div>

      {results && (
        <div className="border border-slate-800 rounded-xl bg-slate-900/30 p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-white">Test Execution Summary</h3>
            <span className={`text-xs font-mono px-2 py-0.5 rounded border ${results.verified ? 'bg-emerald-950 text-emerald-300 border-emerald-800' : 'bg-amber-950 text-amber-300 border-amber-800'}`}>
              {results.verified ? 'VERIFIED' : `NOT VERIFIED${results.httpStatus ? ` · HTTP ${results.httpStatus}` : ''}`}
            </span>
          </div>
          <pre className="text-xs font-mono bg-slate-950 p-4 rounded-lg border border-slate-800 overflow-x-auto max-h-64 text-slate-200">
            {JSON.stringify(results, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

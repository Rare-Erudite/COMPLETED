/**
 * RARE-INTELLIGENCE — Tools Explorer View
 */

import React, { useState } from 'react';
import { apiFetch } from '../api.js';
import { Wrench, Play, Shield, Terminal, CheckCircle2 } from 'lucide-react';

export function ToolsExplorerView() {
  const [selectedTool, setSelectedTool] = useState('calculator_eval');
  const [argsJson, setArgsJson] = useState('{\n  "expression": "sqrt(256) * 4 + 10"\n}');
  const [result, setResult] = useState<any>(null);
  const [running, setRunning] = useState(false);

  const TOOLS = [
    { name: 'calculator_eval', permission: 'READ_ONLY', desc: 'Recursive-descent math parser without eval()' },
    { name: 'system_status', permission: 'READ_ONLY', desc: 'Engine memory footprint and Node.js telemetry' },
    { name: 'file_read', permission: 'READ_ONLY', desc: 'Sandboxed file reader with path containment' },
    { name: 'code_analyze', permission: 'READ_ONLY', desc: 'Delimiter balance and syntax heuristics' },
    { name: 'file_write', permission: 'WORKSPACE_WRITE', desc: 'Sandboxed file writer' },
    { name: 'web_grounding', permission: 'NETWORK_ACCESS', desc: 'Zero-cost knowledge verification' },
  ];

  const handleRunTool = async () => {
    setRunning(true);
    setResult(null);
    try {
      const parsedArgs = JSON.parse(argsJson);
      const res = await apiFetch('/api/tools/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: selectedTool, inputs: parsedArgs }),
      });
      const data = await res.json();
      setResult(data);
    } catch (err: any) {
      setResult({ error: err.message });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border border-slate-800 rounded-xl bg-slate-900/40 p-6 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cyan-950 text-cyan-400 border border-cyan-800">
            <Wrench className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Sandboxed Tool Registry</h2>
            <p className="text-xs text-slate-400">
              Deterministic tools executing with strict permission tiers (READ_ONLY, WORKSPACE_WRITE, NETWORK_ACCESS).
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="border border-slate-800 rounded-xl bg-slate-900/30 p-4 space-y-2">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Registered Tools
          </h3>
          {TOOLS.map((t) => (
            <button
              key={t.name}
              onClick={() => {
                setSelectedTool(t.name);
                if (t.name === 'calculator_eval') {
                  setArgsJson('{\n  "expression": "sqrt(256) * 4 + 10"\n}');
                } else if (t.name === 'code_analyze') {
                  setArgsJson('{\n  "code": "function hello() { return true; }"\n}');
                } else if (t.name === 'file_read') {
                  setArgsJson('{\n  "path": "package.json"\n}');
                } else {
                  setArgsJson('{}');
                }
              }}
              className={`w-full text-left p-3 rounded-lg border transition cursor-pointer ${
                selectedTool === t.name
                  ? 'border-cyan-600 bg-cyan-950/40 text-cyan-200'
                  : 'border-slate-800/80 bg-slate-950/50 hover:border-slate-700 text-slate-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold">{t.name}</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">
                  {t.permission}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">{t.desc}</p>
            </button>
          ))}
        </div>

        <div className="lg:col-span-2 border border-slate-800 rounded-xl bg-slate-900/30 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white font-mono">
              Execute: {selectedTool}
            </h3>
            <button
              onClick={handleRunTool}
              disabled={running}
              className="flex items-center gap-1.5 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-medium cursor-pointer transition disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{running ? 'Executing...' : 'Run Tool'}</span>
            </button>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Parameters JSON
            </label>
            <textarea
              rows={5}
              value={argsJson}
              onChange={(e) => setArgsJson(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs font-mono text-cyan-300 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {result && (
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Execution Output
              </label>
              <pre className="text-xs font-mono bg-slate-950 p-4 rounded-lg border border-slate-800 overflow-x-auto max-h-56 text-slate-200">
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

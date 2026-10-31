/**
 * RARE-INTELLIGENCE — Code Workflow View
 */

import React, { useState } from 'react';
import { apiFetch } from '../api.js';
import { Code2, Play, CheckCircle2, ShieldCheck, FileCheck } from 'lucide-react';

export function CodeWorkflowView() {
  const [filePath, setFilePath] = useState('src/engine/config.ts');
  const [instruction, setInstruction] = useState('Verify configuration values and safety limits');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleRunWorkflow = async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await apiFetch('/api/v1/workflows/code-repair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath, instruction }),
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
            <Code2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Autonomous Code Repair Workflow</h2>
            <p className="text-xs text-slate-400">
              Deterministic 4-phase code workflow: Read Target File → Analyze Syntax & AST → Plan & Apply Edit → Verify Delimiters.
            </p>
          </div>
        </div>
      </div>

      <div className="border border-slate-800 rounded-xl bg-slate-900/30 p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
              Target File Path
            </label>
            <input
              type="text"
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
              Inspection / Repair Instruction
            </label>
            <input
              type="text"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
            />
          </div>
        </div>

        <button
          onClick={handleRunWorkflow}
          disabled={running}
          className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs px-4 py-2.5 rounded-lg transition disabled:opacity-50 cursor-pointer"
        >
          <Play className={`w-3.5 h-3.5 ${running ? 'animate-spin' : ''}`} />
          <span>{running ? 'Executing Workflow...' : 'Execute Code Repair Workflow'}</span>
        </button>

        {result && (
          <div className="pt-4 border-t border-slate-800 space-y-2">
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Workflow Output
            </label>
            <pre className="text-xs font-mono bg-slate-950 p-4 rounded-lg border border-slate-800 overflow-x-auto max-h-60 text-slate-200">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

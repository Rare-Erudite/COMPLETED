/**
 * RARE-INTELLIGENCE — Integration API Reference for RARE-THE-SIXTH
 */

import React, { useState } from 'react';
import { Terminal, Copy, Check, ExternalLink } from 'lucide-react';

export function IntegrationApiView() {
  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const ENDPOINTS = [
    { method: 'GET', path: '/api/v1/engine/health', desc: 'Readiness probe, active provider, storage status' },
    { method: 'GET', path: '/api/v1/engine/status', desc: 'Circuit breaker stats and budget compliance' },
    { method: 'POST', path: '/api/v1/chat', desc: 'Conversational inference with optional bearer token' },
    { method: 'POST', path: '/api/v1/tasks/execute', desc: 'Decompose and execute autonomous task' },
    { method: 'GET', path: '/api/v1/diagnostics/run', desc: 'Run 10-subsystem diagnostic audit' },
    { method: 'POST', path: '/api/v1/repair/run', desc: 'Execute autonomous self-repair' },
    { method: 'GET', path: '/api/v1/build/checkpoints', desc: 'List workspace checkpoints' },
    { method: 'POST', path: '/api/v1/storage/verify-restart', desc: 'Verify disk write restart durability' },
  ];

  return (
    <div className="space-y-6">
      <div className="border border-slate-800 rounded-xl bg-slate-900/40 p-6 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cyan-950 text-cyan-400 border border-cyan-800">
            <Terminal className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">RARE-THE-SIXTH Bridge Specification</h2>
            <p className="text-xs text-slate-400">
              Versioned v1 REST API allowing RARE-THE-SIXTH to bridge to this engine as a first-class ModelProvider.
            </p>
          </div>
        </div>
      </div>

      <div className="border border-slate-800 rounded-xl bg-slate-900/30 p-6 space-y-4">
        <h3 className="text-sm font-bold text-white">Environment Configuration</h3>
        <p className="text-xs text-slate-400">
          Set these variables in RARE-THE-SIXTH to activate the bridge:
        </p>
        <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 font-mono text-xs text-cyan-300 space-y-1">
          <div>RARE_INTELLIGENCE_URL=http://localhost:3000</div>
          <div>RARE_INTELLIGENCE_API_KEY=optional_token</div>
        </div>
      </div>

      <div className="border border-slate-800 rounded-xl bg-slate-900/30 p-6 space-y-4">
        <h3 className="text-sm font-bold text-white">Core Endpoints</h3>
        <div className="space-y-2">
          {ENDPOINTS.map((ep, idx) => (
            <div
              key={idx}
              className="border border-slate-800 bg-slate-950/60 rounded-lg p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2"
            >
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                  ep.method === 'GET' ? 'bg-blue-950 text-blue-300 border border-blue-800' : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                }`}>
                  {ep.method}
                </span>
                <span className="text-xs font-mono text-slate-200">{ep.path}</span>
              </div>
              <span className="text-xs text-slate-400">{ep.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

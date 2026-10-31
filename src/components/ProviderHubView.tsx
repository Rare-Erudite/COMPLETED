/**
 * RARE-INTELLIGENCE — Provider Hub View
 */

import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api.js';
import { Cpu, CheckCircle2, XCircle, ArrowRight, ShieldCheck, Zap } from 'lucide-react';

interface ProviderHubViewProps {
  onProviderChanged?: () => void;
}

export function ProviderHubView({ onProviderChanged }: ProviderHubViewProps) {
  const [providers, setProviders] = useState<any[]>([]);
  const [activeProvider, setActiveProvider] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);

  const fetchProviders = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/v1/providers/available');
      const data = await res.json();
      setProviders(data.providers || []);
      setActiveProvider(data.activeProvider || '');
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProviders();
  }, []);

  const handleSetActive = async (id: string) => {
    setSwitching(id);
    try {
      const res = await apiFetch('/api/v1/providers/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: id }),
      });
      if (res.ok) {
        setActiveProvider(id);
        if (onProviderChanged) onProviderChanged();
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      setSwitching(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border border-slate-800 rounded-xl bg-slate-900/40 p-6 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cyan-950 text-cyan-400 border border-cyan-800">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Model Provider Abstraction Layer</h2>
            <p className="text-xs text-slate-400">
              Zero-budget provider routing: Local open-weights (Ollama / Transformers ONNX), Google Gemini free-tier, and diagnostic sandbox.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {providers.map((p) => {
          const isActive = activeProvider === p.id;
          return (
            <div
              key={p.id}
              className={`border rounded-xl p-5 space-y-4 flex flex-col justify-between transition-all ${
                isActive
                  ? 'border-cyan-600/80 bg-cyan-950/20 shadow-lg shadow-cyan-950/30'
                  : 'border-slate-800 bg-slate-900/30 hover:border-slate-700'
              }`}
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white">{p.name}</span>
                  </div>
                  {p.isAvailable ? (
                    <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-mono">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Ready
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[11px] text-slate-500 font-mono">
                      <XCircle className="w-3.5 h-3.5" />
                      Offline
                    </span>
                  )}
                </div>

                <div className="space-y-1 text-xs">
                  <div className="text-slate-400 font-mono">ID: {p.id}</div>
                  <div className="text-slate-300 font-mono text-[11px]">Model: {p.modelIdentifier}</div>
                  <p className="text-slate-400 text-[11px] pt-1">{p.statusMessage}</p>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
                <span className="text-[10px] font-mono text-emerald-400/90 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/80">
                  Strict Free Tier
                </span>
                <button
                  onClick={() => handleSetActive(p.id)}
                  disabled={isActive || switching === p.id}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition cursor-pointer ${
                    isActive
                      ? 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                  }`}
                >
                  {isActive ? 'Active Provider' : switching === p.id ? 'Switching...' : 'Set Active'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

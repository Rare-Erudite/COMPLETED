/**
 * RARE-INTELLIGENCE — Header Component
 */

import React from 'react';
import { Activity, RefreshCw, Shield, Cpu, Database, CheckCircle2, AlertTriangle } from 'lucide-react';

interface HeaderProps {
  health: any;
  onRefresh: () => void;
  loading: boolean;
}

export function Header({ health, onRefresh, loading }: HeaderProps) {
  const isHealthy = health?.status === 'healthy';
  const opState = health?.operationalState || 'UNKNOWN';

  return (
    <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 lg:px-8 py-3 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-500 flex items-center justify-center shadow-lg shadow-cyan-950/50">
            <Cpu className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold tracking-tight text-white font-mono">
                RARE-INTELLIGENCE
              </h1>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                v{health?.version || '1.0.0'}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Autonomous Intelligence Engine • Companion to RARE-THE-SIXTH
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Operational State Badge */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800/80 border border-slate-700/60">
            <span className={`w-2 h-2 rounded-full ${isHealthy ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            <span className="font-mono text-slate-300">{opState}</span>
          </div>

          {/* Active Provider */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800/80 border border-slate-700/60 text-slate-300">
            <Cpu className="w-3.5 h-3.5 text-cyan-400" />
            <span className="font-mono">{health?.activeProvider || 'probing...'}</span>
          </div>

          {/* Storage Status */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800/80 border border-slate-700/60 text-slate-300">
            <Database className="w-3.5 h-3.5 text-purple-400" />
            <span>{health?.memoryStorageType === 'file-backed-persistent' ? 'Durable Disk' : 'In-Memory'}</span>
          </div>

          {/* Zero Budget Badge */}
          <div className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-950/60 border border-emerald-800/80 text-emerald-300 font-mono">
            <Shield className="w-3.5 h-3.5" />
            <span>$0.00 FREE TIER</span>
          </div>

          {/* Refresh Button */}
          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer"
            title="Refresh engine health"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
            <span className="sr-only sm:not-sr-only">Refresh</span>
          </button>
        </div>
      </div>
    </header>
  );
}

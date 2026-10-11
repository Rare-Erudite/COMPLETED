/**
 * RARE-INTELLIGENCE — Self-Build & Checkpoints View
 */

import React, { useState, useEffect } from 'react';
import { Layers, RotateCcw, Clock, CheckCircle2, Shield } from 'lucide-react';

export function SelfBuildView() {
  const [checkpoints, setCheckpoints] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const fetchCheckpoints = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/build/checkpoints');
      const data = await res.json();
      setCheckpoints(data.checkpoints || []);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCheckpoints();
  }, []);

  const handleRestore = async (id: string) => {
    setRestoringId(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/build/checkpoints/${id}/restore`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Restore failed');
      setMessage(`Successfully restored checkpoint ${id}`);
    } catch (err: any) {
      setMessage(`Restore error: ${err.message}`);
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border border-slate-800 rounded-xl bg-slate-900/40 p-6 backdrop-blur flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cyan-950 text-cyan-400 border border-cyan-800">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Safe Self-Build & Workspace Checkpoints</h2>
            <p className="text-xs text-slate-400">
              Snapshot file modifications, preview pending diffs, and perform atomic rollback to checkpoints.
            </p>
          </div>
        </div>

        <button
          onClick={fetchCheckpoints}
          disabled={loading}
          className="text-xs font-mono px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer"
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {message && (
        <div className="border border-cyan-900/60 bg-cyan-950/30 text-cyan-300 rounded-xl p-4 text-xs font-mono">
          {message}
        </div>
      )}

      <div className="border border-slate-800 rounded-xl bg-slate-900/30 p-6 space-y-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Saved Workspace Checkpoints ({checkpoints.length})
        </h3>
        {checkpoints.length === 0 ? (
          <div className="text-xs text-slate-500 py-6 text-center">
            No snapshots recorded yet. Checkpoints are automatically saved during tasks, repairs, and builds.
          </div>
        ) : (
          <div className="space-y-3">
            {checkpoints.map((cp) => (
              <div
                key={cp.id}
                className="border border-slate-800 bg-slate-950/60 rounded-lg p-4 flex items-center justify-between gap-4"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-cyan-400">{cp.id}</span>
                    <span className="text-sm font-medium text-slate-200">{cp.name}</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1 flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(cp.createdAt).toLocaleString()}
                    </span>
                    <span>{Object.keys(cp.files || {}).length} file(s) captured</span>
                  </div>
                </div>

                <button
                  onClick={() => handleRestore(cp.id)}
                  disabled={restoringId === cp.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium cursor-pointer transition"
                >
                  <RotateCcw className={`w-3.5 h-3.5 ${restoringId === cp.id ? 'animate-spin' : ''}`} />
                  <span>{restoringId === cp.id ? 'Restoring...' : 'Rollback'}</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

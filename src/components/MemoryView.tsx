/**
 * RARE-INTELLIGENCE — Memory View
 */

import React, { useState, useEffect } from 'react';
import { Database, Plus, Search, ShieldCheck, CheckCircle2, RotateCcw } from 'lucide-react';

export function MemoryView() {
  const [memories, setMemories] = useState<any[]>([]);
  const [keyInput, setKeyInput] = useState('');
  const [contentInput, setContentInput] = useState('');
  const [categoryInput, setCategoryInput] = useState('preference');
  const [loading, setLoading] = useState(false);
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);

  const fetchMemories = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/memory');
      const data = await res.json();
      setMemories(data.memories || []);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMemories();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyInput.trim() || !contentInput.trim()) return;
    try {
      await fetch('/api/v1/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: keyInput.trim(),
          content: contentInput.trim(),
          category: categoryInput,
          tags: ['manual_entry'],
        }),
      });
      setKeyInput('');
      setContentInput('');
      fetchMemories();
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleVerifyRestart = async () => {
    setVerifyMessage(null);
    try {
      const res = await fetch('/api/v1/storage/verify-restart', { method: 'POST' });
      const data = await res.json();
      setVerifyMessage(data.message || 'Atomic write & restart durability confirmed.');
    } catch (err: any) {
      setVerifyMessage(`Verification error: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border border-slate-800 rounded-xl bg-slate-900/40 p-6 backdrop-blur flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cyan-950 text-cyan-400 border border-cyan-800">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Durable Multi-Collection Storage</h2>
            <p className="text-xs text-slate-400">
              Atomic disk writes with rotating backups, SHA-256 checksums, and cold restart durability.
            </p>
          </div>
        </div>

        <button
          onClick={handleVerifyRestart}
          className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded-lg text-xs font-medium border border-cyan-800/60 transition cursor-pointer"
        >
          <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
          <span>Verify Durability</span>
        </button>
      </div>

      {verifyMessage && (
        <div className="border border-cyan-900/60 bg-cyan-950/30 text-cyan-300 rounded-xl p-4 text-xs font-mono">
          {verifyMessage}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form onSubmit={handleSave} className="border border-slate-800 rounded-xl bg-slate-900/30 p-5 space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Plus className="w-4 h-4 text-cyan-400" />
            <span>Store Persistent Memory</span>
          </h3>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Key</label>
            <input
              type="text"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="e.g. user_preference_theme"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Category</label>
            <select
              value={categoryInput}
              onChange={(e) => setCategoryInput(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-300 font-mono"
            >
              <option value="preference">Preference</option>
              <option value="fact">Fact</option>
              <option value="conversation">Conversation</option>
              <option value="task_history">Task History</option>
              <option value="checkpoint">Checkpoint</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Content</label>
            <textarea
              rows={3}
              value={contentInput}
              onChange={(e) => setContentInput(e.target.value)}
              placeholder="Content to persist..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
            />
          </div>

          <button
            type="submit"
            className="w-full py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-medium cursor-pointer transition"
          >
            Persist to Disk
          </button>
        </form>

        <div className="lg:col-span-2 border border-slate-800 rounded-xl bg-slate-900/30 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">
              Persisted Records ({memories.length})
            </h3>
            <button
              onClick={fetchMemories}
              disabled={loading}
              className="text-xs font-mono text-cyan-400 hover:underline cursor-pointer"
            >
              Refresh
            </button>
          </div>

          <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
            {memories.length === 0 ? (
              <div className="text-xs text-slate-500 py-8 text-center font-mono">
                No custom persistent items stored yet.
              </div>
            ) : (
              memories.map((m) => (
                <div
                  key={m.id || m.key}
                  className="border border-slate-800 bg-slate-950/60 rounded-lg p-3.5 space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-cyan-300">{m.key}</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 text-purple-300 border border-slate-800">
                      {m.category}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 font-sans">{m.content}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

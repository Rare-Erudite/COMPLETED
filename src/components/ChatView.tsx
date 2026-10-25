/**
 * RARE-INTELLIGENCE — Interactive Chat View
 */

import React, { useState } from 'react';
import { apiFetch } from '../api.js';
import { MessageSquare, Send, Bot, User, Clock, AlertCircle } from 'lucide-react';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  provider?: string;
  model?: string;
  latencyMs?: number;
  isSimulated?: boolean;
}

export function ChatView() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: 'Hello! I am RARE-INTELLIGENCE, ready to reason, execute sandboxed tasks, and answer questions without incurred expense.',
      provider: 'engine-ready',
      model: 'system',
      latencyMs: 0,
      isSimulated: false,
    },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() || sending) return;

    const userMsg: ChatMessage = { role: 'user', content: input.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);
    setError(null);

    try {
      let activeConversationId = conversationId;
      if (!activeConversationId) {
        const created = await apiFetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: userMsg.content.slice(0, 80) }),
        });
        const createdData = await created.json();
        if (!created.ok || typeof createdData.id !== 'string') throw new Error(createdData.error?.message || 'Could not create a private conversation.');
        activeConversationId = createdData.id;
        setConversationId(activeConversationId);
      }

      if (!activeConversationId) throw new Error('Could not identify the active conversation.');

      const res = await apiFetch(`/api/conversations/${encodeURIComponent(activeConversationId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg.content }),
      });
      const data = await res.json();
      if (!res.ok || typeof data.reply?.content !== 'string') throw new Error(data.error?.message || 'The online AI response could not be generated.');
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: data.reply.content,
        provider: data.reply.provider,
        model: data.reply.model,
        isSimulated: false,
      }]);
    } catch (err: any) {
      setError(err.message);
      setMessages((prev) => prev[prev.length - 1]?.role === 'user' ? prev.slice(0, -1) : prev);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="border border-slate-800 rounded-xl bg-slate-900/40 p-4 backdrop-blur flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cyan-950 text-cyan-400 border border-cyan-800">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">Conversational Engine Sandbox</h2>
            <p className="text-xs text-slate-400">
              Evaluates model inference with tool declarations, circuit breaker safety, and context budgeting.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="border border-red-900/60 bg-red-950/30 text-red-300 rounded-xl p-3 flex items-center gap-2 text-xs font-mono">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="border border-slate-800 rounded-xl bg-slate-900/30 flex flex-col h-[520px]">
        {/* Messages Stream */}
        <div className="flex-1 p-4 overflow-y-auto space-y-4">
          {messages.map((m, idx) => {
            const isUser = m.role === 'user';
            return (
              <div
                key={idx}
                className={`flex gap-3 max-w-3xl ${isUser ? 'ml-auto flex-row-reverse' : ''}`}
              >
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-xs ${
                    isUser
                      ? 'bg-cyan-600 text-white'
                      : 'bg-slate-800 border border-slate-700 text-cyan-400'
                  }`}
                >
                  {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>

                <div
                  className={`rounded-xl p-3.5 text-xs leading-relaxed ${
                    isUser
                      ? 'bg-cyan-950/80 border border-cyan-800/80 text-cyan-100'
                      : 'bg-slate-950/80 border border-slate-800 text-slate-200'
                  }`}
                >
                  <div className="whitespace-pre-wrap font-sans">{m.content}</div>

                  {!isUser && m.provider && (
                    <div className="mt-2 pt-2 border-t border-slate-900 flex flex-wrap items-center gap-2 text-[10px] text-slate-500 font-mono">
                      <span>Provider: {m.provider}</span>
                      <span>•</span>
                      <span>Model: {m.model}</span>
                      {m.latencyMs !== undefined && (
                        <>
                          <span>•</span>
                          <span>{m.latencyMs}ms</span>
                        </>
                      )}
                      {m.isSimulated && (
                        <span className="text-amber-400 bg-amber-950/40 px-1 rounded border border-amber-800/40">
                          SANDBOX SIMULATION
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {sending && (
            <div className="flex items-center gap-2 text-xs text-slate-500 font-mono pl-10">
              <Clock className="w-3.5 h-3.5 animate-spin text-cyan-400" />
              <span>Engine reasoning in sandbox...</span>
            </div>
          )}
        </div>

        {/* Input Bar */}
        <form onSubmit={handleSend} className="p-3 border-t border-slate-800 bg-slate-950/60 rounded-b-xl flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a prompt for RARE-INTELLIGENCE..."
            className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-4 py-2 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500 font-mono"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-medium cursor-pointer transition disabled:opacity-50 flex items-center gap-1.5"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Send</span>
          </button>
        </form>
      </div>
    </div>
  );
}

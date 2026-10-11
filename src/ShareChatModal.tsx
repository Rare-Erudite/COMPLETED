import React, { useState, useEffect } from 'react';
import {
  X,
  Share2,
  Copy,
  Check,
  Download,
  FileText,
  MessageSquare,
  Sparkles,
  Printer
} from 'lucide-react';
import { ThemeConfig } from './theme';
import { safeFetch } from './api';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  thought?: string;
}

interface ShareChatModalProps {
  t: ThemeConfig;
  isOpen: boolean;
  onClose: () => void;
  conversationId: string;
  conversationTitle: string;
  assistantName: string;
  preloadedMessages?: ChatMessage[];
}

export function ShareChatModal({
  t,
  isOpen,
  onClose,
  conversationId,
  conversationTitle,
  assistantName,
  preloadedMessages,
}: ShareChatModalProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(preloadedMessages || []);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sharedToast, setSharedToast] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    if (preloadedMessages && preloadedMessages.length > 0) {
      setMessages(preloadedMessages);
      return;
    }

    if (conversationId) {
      setLoading(true);
      safeFetch<any>(`/api/conversations/${conversationId}`)
        .then((data) => {
          if (data && data.messages) {
            setMessages(data.messages);
          }
        })
        .finally(() => setLoading(false));
    }
  }, [isOpen, conversationId, preloadedMessages]);

  if (!isOpen) return null;

  // Build clean formatted document transcript
  const generateTranscript = () => {
    const divider = '─'.repeat(50);
    const dateStr = new Date().toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    let sheet = `==================================================\n`;
    sheet += `CHAT TRANSCRIPT: ${conversationTitle.toUpperCase()}\n`;
    sheet += `Assistant: ${assistantName} | Date: ${dateStr}\n`;
    sheet += `==================================================\n\n`;

    if (messages.length === 0) {
      sheet += `(No messages recorded in this conversation yet)\n`;
    } else {
      messages.forEach((msg, idx) => {
        const sender = msg.role === 'user' ? 'YOU' : assistantName.toUpperCase();
        const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        sheet += `[#${idx + 1}] ${sender} (${time}):\n`;
        sheet += `${msg.content.trim()}\n\n`;
        if (idx < messages.length - 1) {
          sheet += `${divider}\n\n`;
        }
      });
    }

    sheet += `==================================================\n`;
    sheet += `Exported from RARE Core Engine\n`;
    return sheet;
  };

  const handleCopyTranscript = async () => {
    const text = generateTranscript();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    }
  };

  const handleNativeShare = async () => {
    const text = generateTranscript();
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Chat: ${conversationTitle}`,
          text,
        });
        setSharedToast('Shared successfully!');
        setTimeout(() => setSharedToast(null), 2500);
        return;
      } catch (err: any) {
        if (err.name === 'AbortError') return;
      }
    }
    // Fallback: Copy to clipboard
    handleCopyTranscript();
    setSharedToast('Copied full chat transcript to clipboard!');
    setTimeout(() => setSharedToast(null), 2500);
  };

  const handleDownloadTxt = () => {
    const text = generateTranscript();
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const safeName = (conversationTitle || 'chat')
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_')
      .slice(0, 32);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}_transcript.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setSharedToast('Downloaded text sheet!');
    setTimeout(() => setSharedToast(null), 2500);
  };

  const transcriptPreview = generateTranscript();

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-5 animate-in fade-in duration-200">
      <div className={`w-full max-w-2xl max-h-[90vh] flex flex-col ${t.card} border ${t.cardBorder} rounded-2xl shadow-2xl overflow-hidden`}>
        {/* Header */}
        <div className={`p-4 sm:p-5 border-b ${t.cardBorder} ${t.cardSub} flex items-center justify-between shrink-0`}>
          <div className="flex items-center space-x-3 min-w-0">
            <div className={`w-10 h-10 rounded-xl ${t.accentBg} flex items-center justify-center text-white shadow-md shrink-0`}>
              <Share2 className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold truncate">Share Entire Chat</h3>
              <p className={`text-xs ${t.textMuted} truncate`}>
                Hand over the full conversation sheet or share via your installed apps
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status Toast */}
        {sharedToast && (
          <div className="mx-4 mt-3 py-2 px-3 bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs rounded-xl flex items-center space-x-2 animate-in fade-in">
            <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{sharedToast}</span>
          </div>
        )}

        {/* Content Body: Sheet Preview */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
            <span className="flex items-center space-x-1.5">
              <FileText className="w-4 h-4 text-indigo-400" />
              <span>Full Chat Sheet Preview ({messages.length} messages)</span>
            </span>
            <span className="text-[11px] font-mono text-slate-500">{conversationTitle}</span>
          </div>

          {/* Paper-like Preview Container */}
          <div className="relative rounded-xl border border-white/10 bg-slate-950/80 p-4 font-mono text-xs text-slate-300 max-h-[380px] overflow-y-auto whitespace-pre-wrap leading-relaxed shadow-inner">
            {loading ? (
              <div className="py-8 text-center text-slate-500">Loading conversation sheet...</div>
            ) : (
              transcriptPreview
            )}
          </div>
        </div>

        {/* Bottom Actions Bar */}
        <div className={`p-4 border-t ${t.cardBorder} ${t.cardSub} flex flex-wrap items-center justify-between gap-2 shrink-0`}>
          <div className="flex items-center space-x-2">
            <button
              onClick={handleDownloadTxt}
              className={`px-3 py-2 rounded-xl text-xs font-semibold ${t.cardSub} border ${t.cardBorder} ${t.textMuted} hover:${t.textPrimary} hover:bg-white/10 transition flex items-center space-x-1.5`}
              title="Download formatted text file"
            >
              <Download className="w-4 h-4" />
              <span>Download .txt</span>
            </button>

            <button
              onClick={handleCopyTranscript}
              className={`px-3 py-2 rounded-xl text-xs font-semibold ${
                copied
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : `${t.cardSub} border ${t.cardBorder} ${t.textMuted} hover:${t.textPrimary} hover:bg-white/10`
              } transition flex items-center space-x-1.5`}
              title="Copy entire transcript to clipboard"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'Copied Full Sheet!' : 'Copy Entire Chat'}</span>
            </button>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={onClose}
              className="px-3 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white transition"
            >
              Done
            </button>

            <button
              onClick={handleNativeShare}
              className={`px-4 py-2 rounded-xl text-xs font-semibold ${t.accentBg} ${t.accentBgHover} text-white shadow-md transition flex items-center space-x-1.5`}
              title="Share via apps (WhatsApp, Mail, Telegram, Bluetooth, etc.)"
            >
              <Share2 className="w-4 h-4" />
              <span>Share Sheet</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

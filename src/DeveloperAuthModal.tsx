import React, { useState } from 'react';
import {
  Lock,
  Mail,
  ShieldCheck,
  Send,
  CheckCircle2,
  AlertCircle,
  X,
  HelpCircle,
  Copy,
  Check,
  Share2
} from 'lucide-react';
import { ThemeConfig } from './theme';
import { resolveApiUrl, safePost } from './api';

interface DeveloperAuthModalProps {
  t: ThemeConfig;
  isOpen: boolean;
  onSuccess: () => void;
  onClose: () => void;
}

export function DeveloperAuthModal({
  t,
  isOpen,
  onSuccess,
  onClose,
}: DeveloperAuthModalProps) {
  const [passkey, setPasskey] = useState('');
  const [showPasskey, setShowPasskey] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Recovery / Access Request State
  const [viewMode, setViewMode] = useState<'unlock' | 'request_access' | 'change_password'>('unlock');
  
  // Request access form
  const [requesterName, setRequesterName] = useState('');
  const [requesterEmail, setRequesterEmail] = useState('');
  const [requestReason, setRequestReason] = useState('');
  const [requestSubmitted, setRequestSubmitted] = useState(false);
  const [requestDetails, setRequestDetails] = useState<any>(null);
  const [copiedShareLink, setCopiedShareLink] = useState(false);

  // Change password form
  const [currentMasterKey, setCurrentMasterKey] = useState('');
  const [showCurrentMasterKey, setShowCurrentMasterKey] = useState(false);
  const [newPasskey, setNewPasskey] = useState('');
  const [showNewPasskey, setShowNewPasskey] = useState(false);
  const [confirmNewPasskey, setConfirmNewPasskey] = useState('');
  const [showConfirmNewPasskey, setShowConfirmNewPasskey] = useState(false);
  const [changeSuccess, setChangeSuccess] = useState(false);

  if (!isOpen) return null;

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch(resolveApiUrl('/api/developer/auth'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passkey }),
      });
      const res = await response.json().catch(() => null);
      if (response.ok && res?.success) {
        onSuccess();
        onClose();
      } else {
        setError(
          res?.error?.message ||
          (response.ok ? 'Invalid developer passkey.' : `Developer sign-in failed (HTTP ${response.status}).`)
        );
      }
    } catch {
      setError('Connection error.');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requesterEmail.trim()) {
      setError('Please provide your email address.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await safePost<any>('/api/developer/request-access', {
        requesterName: requesterName.trim() || 'Fellow Developer',
        requesterEmail: requesterEmail.trim(),
        reason: requestReason.trim(),
      });
      if (res?.success) {
        setRequestSubmitted(true);
        setRequestDetails(res);
      } else {
        setError(res?.error?.message || 'Failed to submit access request.');
      }
    } catch {
      setError('Connection error.');
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPasskey !== confirmNewPasskey) {
      setError('New passkey and confirmation do not match.');
      return;
    }
    if (newPasskey.length < 6) {
      setError('New passkey must be at least 6 characters.');
      return;
    }

    setLoading(true);
    try {
      const res = await safePost<any>('/api/developer/change-passkey', {
        currentPasskey: currentMasterKey,
        newPasskey,
      });
      if (res?.success) {
        setChangeSuccess(true);
        setTimeout(() => {
          setViewMode('unlock');
          setChangeSuccess(false);
          setPasskey(newPasskey);
        }, 2200);
      } else {
        setError(res?.error?.message || 'Current passkey verification failed.');
      }
    } catch {
      setError('Connection error.');
    } finally {
      setLoading(false);
    }
  };

  const copyWhatsAppShare = (msg: string) => {
    navigator.clipboard.writeText(msg);
    setCopiedShareLink(true);
    setTimeout(() => setCopiedShareLink(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
      <div className={`w-full max-w-md ${t.card} border ${t.cardBorder} rounded-2xl p-6 shadow-2xl space-y-4 relative my-auto animate-in fade-in zoom-in-95 duration-150`}>
        {/* Close Button */}
        <button
          onClick={onClose}
          className={`absolute top-4 right-4 p-2 rounded-xl ${t.cardSub} ${t.textMuted} hover:text-white transition`}
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header */}
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Developer Space Security</h3>
            <p className={`text-xs ${t.textDim}`}>
              {viewMode === 'unlock'
                ? 'Privileged self-development security barrier'
                : viewMode === 'request_access'
                ? 'Request Access from Owner (rarelivescore@gmail.com)'
                : 'Protected Developer Passkey Change'}
            </p>
          </div>
        </div>

        {/* View Mode 1: Regular Unlock */}
        {viewMode === 'unlock' && (
          <form onSubmit={handleAuth} className="space-y-4">
            <p className={`text-xs ${t.textMuted}`}>
              Please enter the developer passkey to access Developer Space and autonomous self-development capabilities.
            </p>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-200">Developer Passkey</label>
                <button
                  type="button"
                  onClick={() => setShowPasskey((prev) => !prev)}
                  className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center space-x-1"
                >
                  <span>{showPasskey ? 'Hide' : 'Show'}</span>
                </button>
              </div>

              <div className="relative">
                <input
                  type={showPasskey ? 'text' : 'password'}
                  value={passkey}
                  onChange={(e) => setPasskey(e.target.value)}
                  placeholder="Enter passkey..."
                  className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-xl px-3 py-2.5 pr-10 text-xs focus:outline-none`}
                />
                
                {/* Persistent Eye Toggle Button */}
                <button
                  type="button"
                  onClick={() => setShowPasskey((prev) => !prev)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-white rounded-md transition"
                  title={showPasskey ? 'Click to hide password' : 'Click to show password'}
                >
                  {showPasskey ? (
                    // Eye Open Icon
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  ) : (
                    // Eye Closed / Slashed Icon
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{error}</span>
              </div>
            )}

            {/* Assistance links: Forgot password or change password */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between text-[11px] gap-2 pt-1 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setViewMode('request_access');
                  setError('');
                }}
                className="text-amber-400 hover:text-amber-300 underline font-medium"
              >
                Forgot password? Request access from Owner
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewMode('change_password');
                  setError('');
                }}
                className="text-slate-400 hover:text-slate-200 underline"
              >
                Change Passkey
              </button>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className={`px-4 py-2 rounded-xl ${t.cardSub} ${t.textMuted} border ${t.cardBorder} text-xs`}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !passkey.trim()}
                className={`px-5 py-2 rounded-xl ${t.accentBg} ${t.accentBgHover} text-white text-xs font-semibold disabled:opacity-40 shadow-md`}
              >
                {loading ? 'Verifying...' : 'Unlock Developer Space'}
              </button>
            </div>
          </form>
        )}

        {/* View Mode 2: Request Access from Owner (rarelivescore@gmail.com) */}
        {viewMode === 'request_access' && (
          <div className="space-y-4">
            {!requestSubmitted ? (
              <form onSubmit={handleRequestAccess} className="space-y-3.5">
                <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-xs space-y-1">
                  <div className="flex items-center space-x-1.5 font-bold">
                    <ShieldCheck className="w-4 h-4 text-indigo-400" />
                    <span>Strictly Guarded Access Request</span>
                  </div>
                  <p className="text-[11px] text-slate-300">
                    Access requests are dispatched directly to the App Owner at <span className="font-mono text-indigo-200 font-semibold">rarelivescore@gmail.com</span> (like Google Docs edit permission requests). Once approved, the owner will send you the developer password via WhatsApp or email.
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-300">Your Full Name</label>
                  <input
                    type="text"
                    value={requesterName}
                    onChange={(e) => setRequesterName(e.target.value)}
                    placeholder="e.g. Fellow Engineer Alex"
                    className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-xl px-3 py-2 text-xs focus:outline-none`}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-300">Your Email Address</label>
                  <input
                    type="email"
                    value={requesterEmail}
                    onChange={(e) => setRequesterEmail(e.target.value)}
                    placeholder="your.email@example.com"
                    required
                    className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-xl px-3 py-2 text-xs focus:outline-none`}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-300">Reason / Developer Role</label>
                  <textarea
                    rows={2}
                    value={requestReason}
                    onChange={(e) => setRequestReason(e.target.value)}
                    placeholder="I forgot my passkey / need access to work on self-development feature..."
                    className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-xl px-3 py-2 text-xs focus:outline-none resize-none`}
                  />
                </div>

                {error && (
                  <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center space-x-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                    <span>{error}</span>
                  </div>
                )}

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setViewMode('unlock');
                      setError('');
                    }}
                    className={`text-xs ${t.textMuted} hover:text-white underline`}
                  >
                    Back to Passkey
                  </button>

                  <button
                    type="submit"
                    disabled={loading || !requesterEmail.trim()}
                    className={`px-5 py-2 rounded-xl ${t.accentBg} ${t.accentBgHover} text-white text-xs font-semibold flex items-center space-x-1.5 shadow-md disabled:opacity-50`}
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{loading ? 'Sending Request...' : 'Send Request to Gmail'}</span>
                  </button>
                </div>
              </form>
            ) : (
              /* Request Sent Confirmation */
              <div className="space-y-4 pt-1">
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs space-y-2">
                  <div className="flex items-center space-x-2 font-bold text-sm text-emerald-400">
                    <CheckCircle2 className="w-5 h-5" />
                    <span>Access Request Dispatched!</span>
                  </div>
                  <p className="text-slate-300">
                    Notification dispatched to Owner at <span className="font-semibold text-white">rarelivescore@gmail.com</span>.
                  </p>
                  <div className="text-[11px] text-slate-400 font-mono bg-black/40 p-2.5 rounded-lg border border-slate-800">
                    Request ID: {requestDetails?.requestId || 'req_live'}
                    <br />
                    Status: Pending Owner Approval
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-300">
                    Quick WhatsApp / Chat Request Text
                  </p>
                  <p className="text-[11px] text-slate-400">
                    You can also copy this message and send it directly to the owner on WhatsApp:
                  </p>
                  <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-[11px] text-slate-300 font-mono">
                    "Hi, I requested developer access for RARE Intelligence for {requesterEmail}. Please send me the passkey when you can!"
                  </div>
                  <button
                    type="button"
                    onClick={() => copyWhatsAppShare(`Hi, I requested developer access for RARE Intelligence for ${requesterEmail}. Please send me the passkey when you can!`)}
                    className="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 font-medium flex items-center justify-center space-x-1.5 transition"
                  >
                    {copiedShareLink ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-400" />
                        <span>Copied to Clipboard!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>Copy Message for WhatsApp / Chat</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setRequestSubmitted(false);
                      setViewMode('unlock');
                    }}
                    className={`px-4 py-2 rounded-xl ${t.accentBg} text-white text-xs font-semibold`}
                  >
                    Return to Login
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* View Mode 3: Strictly Guarded Change Password */}
        {viewMode === 'change_password' && (
          <form onSubmit={handleChangePassword} className="space-y-3.5">
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
              <span className="font-bold">Guarded Passkey Change:</span> To change the developer master passkey, you must provide the current passkey first.
            </div>

            {changeSuccess ? (
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center space-x-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <span>Developer passkey updated successfully! Redirecting to unlock...</span>
              </div>
            ) : (
              <>
                {/* Current Passkey with Eye */}
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-300">Current Passkey</label>
                  <div className="relative">
                    <input
                      type={showCurrentMasterKey ? 'text' : 'password'}
                      value={currentMasterKey}
                      onChange={(e) => setCurrentMasterKey(e.target.value)}
                      placeholder="Enter current passkey..."
                      required
                      className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-xl px-3 py-2 pr-10 text-xs focus:outline-none`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentMasterKey((prev) => !prev)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white rounded transition"
                      title={showCurrentMasterKey ? 'Hide' : 'Show'}
                    >
                      {showCurrentMasterKey ? (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                {/* New Passkey with Eye */}
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-300">New Developer Passkey</label>
                  <div className="relative">
                    <input
                      type={showNewPasskey ? 'text' : 'password'}
                      value={newPasskey}
                      onChange={(e) => setNewPasskey(e.target.value)}
                      placeholder="Minimum 6 characters..."
                      required
                      className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-xl px-3 py-2 pr-10 text-xs focus:outline-none`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPasskey((prev) => !prev)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white rounded transition"
                      title={showNewPasskey ? 'Hide' : 'Show'}
                    >
                      {showNewPasskey ? (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                {/* Confirm New Passkey with Eye */}
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-300">Confirm New Passkey</label>
                  <div className="relative">
                    <input
                      type={showConfirmNewPasskey ? 'text' : 'password'}
                      value={confirmNewPasskey}
                      onChange={(e) => setConfirmNewPasskey(e.target.value)}
                      placeholder="Repeat new passkey..."
                      required
                      className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-xl px-3 py-2 pr-10 text-xs focus:outline-none`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmNewPasskey((prev) => !prev)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white rounded transition"
                      title={showConfirmNewPasskey ? 'Hide' : 'Show'}
                    >
                      {showConfirmNewPasskey ? (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center space-x-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                    <span>{error}</span>
                  </div>
                )}

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setViewMode('unlock');
                      setError('');
                    }}
                    className={`text-xs ${t.textMuted} hover:text-white underline`}
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    disabled={loading || !newPasskey || !currentMasterKey}
                    className={`px-5 py-2 rounded-xl ${t.accentBg} ${t.accentBgHover} text-white text-xs font-semibold shadow-md disabled:opacity-50`}
                  >
                    {loading ? 'Updating...' : 'Update Passkey'}
                  </button>
                </div>
              </>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

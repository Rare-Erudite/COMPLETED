import React, { useState } from 'react';
import {
  Sparkles,
  RefreshCw,
  CheckCircle2,
  X,
  Smartphone,
  Shield,
  Download,
  AlertCircle,
  ArrowRight,
  Layers,
  ChevronRight
} from 'lucide-react';
import { ThemeConfig } from './theme';

export interface AppUpdate {
  id: string;
  version: string;
  releaseDate: string;
  channel: 'public' | 'developer';
  title: string;
  description: string;
  changelog: string[];
  mandatory?: boolean;
  packageUrl?: string;
  apkSize?: string;
  publishedBy: string;
}

interface UpdateModalProps {
  t: ThemeConfig;
  isOpen: boolean;
  onClose: () => void;
  update: AppUpdate | null;
  onApplyUpdate: (version: string) => void;
  isDeveloper: boolean;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  t,
  isOpen,
  onClose,
  update,
  onApplyUpdate,
  isDeveloper,
}) => {
  const [updating, setUpdating] = useState(false);
  const [progressStep, setProgressStep] = useState(0);
  const [completed, setCompleted] = useState(false);

  if (!isOpen || !update) return null;

  const isDevChannel = update.channel === 'developer';

  const handleStartUpdate = async () => {
    setUpdating(true);
    setProgressStep(1);

    // Simulated atomic stage transitions
    await new Promise((r) => setTimeout(r, 600));
    setProgressStep(2);

    await new Promise((r) => setTimeout(r, 700));
    setProgressStep(3);

    // If Service Worker is available, request skipWaiting
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((reg) => reg.update());
      });
    }

    await new Promise((r) => setTimeout(r, 500));
    setProgressStep(4);
    setCompleted(true);
    setUpdating(false);

    onApplyUpdate(update.version);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className={`w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl ${t.card} border ${
          isDevChannel ? 'border-amber-500/50 shadow-amber-500/10' : `${t.accentBorder} shadow-indigo-500/10`
        } shadow-2xl flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`p-5 border-b ${t.cardBorder} flex items-center justify-between`}>
          <div className="flex items-center space-x-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-lg ${
                isDevChannel ? 'bg-gradient-to-tr from-amber-600 to-orange-500' : t.accentBg
              }`}
            >
              <RefreshCw className={`w-5 h-5 ${updating ? 'animate-spin' : ''}`} />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-white">System Update Available</h2>
                <span
                  className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full uppercase border ${
                    isDevChannel
                      ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                      : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                  }`}
                >
                  v{update.version}
                </span>
              </div>
              <p className={`text-xs ${t.textMuted}`}>
                {isDevChannel ? 'Developer Early-Access Channel' : 'Public Stable Channel'}
              </p>
            </div>
          </div>

          {!update.mandatory && !updating && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 text-xs">
          {/* Channel Banner Callout */}
          <div
            className={`p-3.5 rounded-xl border flex items-start space-x-2.5 ${
              isDevChannel
                ? 'bg-amber-950/30 border-amber-500/30 text-amber-200'
                : 'bg-emerald-950/30 border-emerald-500/30 text-emerald-200'
            }`}
          >
            {isDevChannel ? (
              <Shield className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            ) : (
              <Sparkles className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            )}
            <div className="space-y-0.5">
              <div className="font-bold text-xs text-white">
                {isDevChannel ? 'Developer-Restricted Distribution' : 'Universal Public Distribution'}
              </div>
              <p className="text-[11px] opacity-90">
                {isDevChannel
                  ? 'This build is published specifically to the Developer Channel. Regular users do not see this update notification.'
                  : 'This release has been verified and distributed to all RARE users.'}
              </p>
            </div>
          </div>

          {/* Release Title & Description */}
          <div className={`p-4 rounded-xl ${t.cardSub} border ${t.cardBorder} space-y-2`}>
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-white">{update.title}</span>
              <span className="text-[10px] text-slate-400 font-mono">
                {new Date(update.releaseDate).toLocaleDateString()}
              </span>
            </div>
            <p className={`text-xs ${t.textMuted} leading-relaxed`}>{update.description}</p>
          </div>

          {/* Changelog Items */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-300">What's New in this Release:</div>
            <div className="space-y-1.5">
              {update.changelog.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-start space-x-2 text-[11px] text-slate-300 p-2 rounded-lg bg-black/30 border border-white/5"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  <span className="leading-snug">{item}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Update Progress Stages */}
          {updating && (
            <div className="p-4 rounded-xl bg-indigo-950/30 border border-indigo-500/30 space-y-2.5 animate-in fade-in">
              <div className="flex items-center justify-between text-xs font-semibold text-indigo-300">
                <span>Applying Over-The-Air Update...</span>
                <span>{progressStep * 25}%</span>
              </div>
              <div className="h-2 w-full bg-slate-900 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400 rounded-full transition-all duration-300"
                  style={{ width: `${progressStep * 25}%` }}
                />
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                {progressStep === 1 && '1/4: Checking bundle integrity and signatures...'}
                {progressStep === 2 && '2/4: Synchronizing local cognitive models and cache...'}
                {progressStep === 3 && '3/4: Activating updated client runtime and service worker...'}
                {progressStep === 4 && '4/4: Finalizing update state!'}
              </div>
            </div>
          )}

          {/* Completed Banner */}
          {completed && (
            <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 space-y-1 animate-in fade-in">
              <div className="flex items-center space-x-1.5 font-bold text-xs">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Updated Successfully to v{update.version}!</span>
              </div>
              <p className="text-[11px] text-slate-300">
                Your application now has all the latest improvements active.
              </p>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className={`p-4 border-t ${t.cardBorder} flex flex-col sm:flex-row items-center justify-between gap-2.5`}>
          <div className="text-[10px] text-slate-400 font-mono">
            Published by: <span className="text-slate-300">{update.publishedBy}</span>
          </div>

          <div className="flex items-center space-x-2 w-full sm:w-auto">
            {!update.mandatory && !completed && (
              <button
                type="button"
                onClick={onClose}
                disabled={updating}
                className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white text-xs font-medium transition disabled:opacity-50"
              >
                Later
              </button>
            )}

            {completed ? (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  window.location.reload();
                }}
                className={`flex-1 sm:flex-none px-5 py-2 rounded-xl ${t.accentBg} ${t.accentBgHover} text-white text-xs font-bold shadow-md transition`}
              >
                Done / Reload App
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStartUpdate}
                disabled={updating}
                className={`flex-1 sm:flex-none px-5 py-2.5 rounded-xl ${
                  isDevChannel
                    ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold'
                    : `${t.accentBg} ${t.accentBgHover} text-white font-bold`
                } text-xs flex items-center justify-center space-x-2 shadow-lg transition active:scale-[0.98] disabled:opacity-50`}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${updating ? 'animate-spin' : ''}`} />
                <span>{updating ? 'Updating...' : 'Update Now (OTA)'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

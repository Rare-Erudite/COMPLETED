import React, { useState } from 'react';
import {
  Sparkles,
  RefreshCw,
  CheckCircle2,
  X,
  Smartphone,
  Shield,
  AlertCircle,
  Layers,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { ThemeConfig } from './theme';
import { apiFetch } from './api';

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
  artifactSizeBytes?: number;
  sha256?: string;
  platform?: 'web' | 'android' | 'windows';
  publishedBy: string;
}

interface UpdateModalProps {
  t: ThemeConfig;
  isOpen: boolean;
  onClose: () => void;
  update: AppUpdate | null;
  isDeveloper: boolean;
}

/**
 * What the server reports after download + verification + activation.
 * Mirrors the `/api/updates/apply` response contract exactly.
 */
interface ApplyResult {
  success: boolean;
  updateId?: string;
  version?: string;
  channel?: string;
  platform?: string;
  stage?: string;
  action?: string;
  activated?: boolean;
  checksumVerified?: boolean;
  message?: string;
  error?: { message?: string };
}

/** The ordered stages the UI exposes. A stage is only reached when the server says so. */
type Stage = 'idle' | 'applying' | 'verified' | 'pending' | 'activated' | 'failed';

/**
 * Update modal — download, verify, then *activate through the backend*.
 *
 * The previous version downloaded the artifact with `fetch`, verified its
 * SHA-256 in the browser and then called an `onApplyUpdate` that no caller
 * wired up. The result was a file in the Downloads folder and a screen that
 * said the update was complete, while `/api/updates/apply` sat unused and
 * answered 501. Nothing was ever activated.
 *
 * Now the server is the single source of truth for the lifecycle:
 *
 *   downloaded → verified → activation_pending → activated | failed
 *
 * The client never claims a stage the server did not report. In particular the
 * web platform cannot be `activated` by this component at all — activation for a
 * deployed bundle *is* the reload — so it hands that step to the user and says
 * exactly that, instead of asserting success it cannot observe.
 */
export const UpdateModal: React.FC<UpdateModalProps> = ({
  t,
  isOpen,
  onClose,
  update,
  isDeveloper,
}) => {
  const [stage, setStage] = useState<Stage>('idle');
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen || !update) return null;

  const isDevChannel = update.channel === 'developer';
  const busy = stage === 'applying';

  const reset = () => {
    setStage('idle');
    setResult(null);
    setErrorMessage(null);
  };

  /**
   * Hand the update to the backend and render whatever it truthfully reports.
   * The browser performs no download here: the server fetches, verifies the
   * checksum against the published value and records the outcome, so there is
   * one verifier rather than two that can disagree.
   */
  const handleApply = async () => {
    setStage('applying');
    setErrorMessage(null);
    setResult(null);
    try {
      if (!update.packageUrl || !update.artifactSizeBytes || !update.sha256) {
        throw new Error('This release is missing its verified download metadata, so it cannot be applied.');
      }

      const response = await apiFetch('/api/updates/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updateId: update.id,
          // The channel is asserted explicitly so a developer release can never
          // resolve on the public channel, and a public user can never resolve a
          // developer one.
          channel: update.channel,
          platform: update.platform || 'web',
          runningVersion: clientVersion(),
        }),
      });

      const payload: ApplyResult = await response.json().catch(() => ({ success: false }));

      if (!response.ok || !payload.success) {
        const message =
          payload.message ||
          payload.error?.message ||
          `The update could not be applied (HTTP ${response.status}).`;
        setResult(payload);
        setErrorMessage(message);
        setStage('failed');
        return;
      }

      setResult(payload);
      if (payload.stage === 'activated') {
        setStage('activated');
      } else if (payload.stage === 'activation_pending') {
        setStage('pending');
      } else if (payload.stage === 'failed') {
        setStage('failed');
      } else {
        // `verified` (or anything unrecognised) is emphatically not "installed".
        setStage('verified');
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The update could not be applied.');
      setStage('failed');
    }
  };

  /** Re-check whether the reload actually produced the new version. */
  const confirmAfterReload = async () => {
    try {
      await apiFetch(`/api/updates/confirm?version=${encodeURIComponent(update.version)}`);
    } catch {
      // Confirmation is best-effort telemetry; the reload is what matters.
    }
    window.location.reload();
  };

  const actionLabel = result?.action?.replace(/_/g, ' ') || '';
  const platformLabel = update.platform || 'web';

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
              <RefreshCw className={`w-5 h-5 ${busy ? 'animate-spin' : ''}`} />
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

          {!update.mandatory && !busy && (
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
          {/* Channel banner */}
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
                  ? 'This build is published to the Developer Channel. Regular users do not see this update notification.'
                  : 'This release has been verified and distributed to all RARE users.'}
              </p>
            </div>
          </div>

          {/* Release info */}
          <div className={`p-4 rounded-xl ${t.cardSub} border ${t.cardBorder} space-y-2`}>
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-white">{update.title}</span>
              <span className="text-[10px] text-slate-400 font-mono">
                {new Date(update.releaseDate).toLocaleDateString()}
              </span>
            </div>
            <p className={`text-xs ${t.textMuted} leading-relaxed`}>{update.description}</p>
            <p className="text-[10px] text-slate-400">
              {platformLabel} · {update.apkSize || 'Size unavailable'}
            </p>
          </div>

          {/* Changelog */}
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

          {/* Lifecycle */}
          <StageTimeline stage={stage} t={t} />

          {/* Applying */}
          {busy && (
            <div className="p-4 rounded-xl bg-indigo-950/30 border border-indigo-500/30 space-y-2.5 animate-in fade-in">
              <div className="flex items-center space-x-2 text-xs font-semibold text-indigo-300">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Downloading and verifying the release…</span>
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                The server fetches the artifact, checks its SHA-256 against the published value, then activates it.
              </div>
            </div>
          )}

          {/* Terminal outcome — states only what the server confirmed */}
          {(stage === 'pending' || stage === 'activated' || stage === 'verified') && result && (
            <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 space-y-1.5 animate-in fade-in">
              <div className="flex items-center space-x-1.5 font-bold text-xs">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>
                  {stage === 'activated'
                    ? `v${update.version} is active`
                    : `v${update.version} downloaded and verified`}
                </span>
              </div>
              <p className="text-[11px] text-slate-300">{result.message}</p>
              <div className="flex items-center space-x-1.5 pt-0.5">
                <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  {String(result.stage).replace(/_/g, ' ')}
                </span>
                {actionLabel && (
                  <span className="text-[10px] font-mono text-slate-400">{actionLabel}</span>
                )}
                <span className="text-[10px] font-mono text-slate-500">
                  checksum {result.checksumVerified ? 'verified' : 'unverified'}
                </span>
              </div>

              {stage === 'pending' && result.action === 'reload_required' && (
                <button
                  type="button"
                  onClick={confirmAfterReload}
                  className="mt-1 text-[11px] font-semibold underline text-emerald-300 hover:text-emerald-200"
                >
                  Reload now to load v{update.version}
                </button>
              )}

              {(result.action === 'user_install_required' || result.action === 'user_elevation_required') && (
                <p className="text-[10px] text-amber-300/90 pt-1 flex items-start space-x-1.5">
                  <Smartphone className="w-3 h-3 shrink-0 mt-0.5" />
                  <span>
                    The verified file is saved on the server. Completing the install needs your action on this
                    {platformLabel === 'android' ? ' device' : ' machine'} — RARE cannot do it silently.
                  </span>
                </p>
              )}
            </div>
          )}

          {/* Failure — never dressed up as success */}
          {stage === 'failed' && (
            <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-200 space-y-1 animate-in fade-in">
              <div className="flex items-center space-x-1.5 font-bold text-xs">
                <AlertCircle className="w-4 h-4 text-rose-400" />
                <span>The update was not applied</span>
              </div>
              <p className="text-[11px] text-slate-300">
                {errorMessage || 'The release could not be downloaded and verified.'}
              </p>
              <p className="text-[10px] text-slate-400">
                Your current version is unchanged.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`p-4 border-t ${t.cardBorder} flex flex-col sm:flex-row items-center justify-between gap-2.5`}>
          <div className="text-[10px] text-slate-400 font-mono">
            Published by: <span className="text-slate-300">{update.publishedBy}</span>
          </div>

          <div className="flex items-center space-x-2 w-full sm:w-auto">
            {!update.mandatory && stage !== 'pending' && stage !== 'activated' && (
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white text-xs font-medium transition disabled:opacity-50"
              >
                Later
              </button>
            )}

            {stage === 'activated' || stage === 'pending' ? (
              <button
                type="button"
                onClick={onClose}
                className={`flex-1 sm:flex-none px-5 py-2 rounded-xl ${t.accentBg} text-white text-xs font-bold shadow-md transition`}
              >
                Close
              </button>
            ) : stage === 'failed' ? (
              <button
                type="button"
                onClick={reset}
                className={`flex-1 sm:flex-none px-5 py-2.5 rounded-xl ${t.accentBg} text-white text-xs font-bold shadow-lg transition`}
              >
                Try again
              </button>
            ) : (
              <button
                type="button"
                onClick={handleApply}
                disabled={busy}
                className={`flex-1 sm:flex-none px-5 py-2.5 rounded-xl ${
                  isDevChannel
                    ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold'
                    : `${t.accentBg} ${t.accentBgHover} text-white font-bold`
                } text-xs flex items-center justify-center space-x-2 shadow-lg transition active:scale-[0.98] disabled:opacity-50`}
              >
                {busy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
                <span>{busy ? 'Applying…' : 'Download & Apply'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/** The version this client is actually running, as reported by the build. */
function clientVersion(): string {
  return (import.meta as any)?.env?.VITE_APP_VERSION || '1.0.0';
}

/**
 * Renders the lifecycle so the user can see which stage is *confirmed* rather
 * than a single spinner that implies everything succeeded.
 */
const StageTimeline: React.FC<{ stage: Stage; t: ThemeConfig }> = ({ stage, t }) => {
  const steps: Array<{ key: Stage; label: string }> = [
    { key: 'idle', label: 'Discovered' },
    { key: 'applying', label: 'Downloaded & verified' },
    { key: 'pending', label: 'Activation' },
    { key: 'activated', label: 'Active' },
  ];
  const order: Stage[] = ['idle', 'applying', 'verified', 'pending', 'activated'];
  const currentIndex = order.indexOf(stage === 'failed' ? 'applying' : stage);

  return (
    <div className="flex items-center space-x-1.5">
      {steps.map((step) => {
        const stepIndex = order.indexOf(step.key === 'idle' ? 'idle' : step.key);
        const done = stage !== 'failed' && currentIndex >= stepIndex && stage !== 'idle';
        return (
          <React.Fragment key={step.key}>
            <div
              className={`flex items-center space-x-1 px-2 py-1 rounded-lg border text-[10px] font-mono ${
                done
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : `border-white/10 bg-black/20 ${t.textMuted}`
              }`}
            >
              {done && <CheckCircle2 className="w-2.5 h-2.5" />}
              <span>{step.label}</span>
            </div>
            {step.key !== 'activated' && <Layers className="w-2.5 h-2.5 text-slate-600 shrink-0" />}
          </React.Fragment>
        );
      })}
    </div>
  );
};

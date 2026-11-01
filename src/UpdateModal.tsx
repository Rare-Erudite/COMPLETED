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
import { getBackendUrl } from './api';

/**
 * Origin used to resolve a same-origin package path (e.g. "/api/download/apk")
 * advertised by the update feed. Falls back to the current page origin, which
 * is already the RARE backend for the deployed web app.
 */
function getBackendOrigin(): string {
  try {
    const backend = getBackendUrl();
    if (backend) return new URL(backend).origin;
  } catch {
    // ignore — fall through to the page origin
  }
  return window.location.origin;
}

/**
 * Native installer bridge exposed by the RARE Android shell
 * (see scripts/build_apk.sh -> MainActivity.InstallerBridge).
 *
 * Present only inside the Android app. In a normal browser `window.RareInstaller`
 * is undefined and the update falls back to saving the verified file for the
 * user to open manually.
 */
interface RareInstallerBridge {
  canInstall(): boolean;
  installedVersionName(): string;
  installedVersionCode(): number;
  openInstallPermissionSettings(): void;
  /** Streams verified APK bytes into a system PackageInstaller session. */
  installVerifiedApk(base64Apk: string): string;
}

function getNativeInstaller(): RareInstallerBridge | null {
  const bridge = (window as unknown as { RareInstaller?: RareInstallerBridge }).RareInstaller;
  return bridge && typeof bridge.installVerifiedApk === 'function' ? bridge : null;
}

/**
 * Convert bytes to base64 in chunks. A single String.fromCharCode(...bytes)
 * call overflows the argument limit for a multi-hundred-KB APK.
 */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + CHUNK) as unknown as number[],
    );
  }
  return btoa(binary);
}

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
  onApplyUpdate: (version: string) => void;
  isDeveloper: boolean;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  t,
  isOpen,
  onClose,
  update,
  isDeveloper,
}) => {
  const [updating, setUpdating] = useState(false);
  const [progressStep, setProgressStep] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [needsInstallPermission, setNeedsInstallPermission] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [installOutcome, setInstallOutcome] = useState<{ ok: boolean; message: string } | null>(null);

  // Listen for the genuine result reported by Android's PackageInstaller.
  React.useEffect(() => {
    const onResult = (event: Event) => {
      const detail = (event as CustomEvent<{ ok: boolean; status: number; message: string }>).detail;
      setAwaitingConfirmation(false);
      if (detail?.ok) {
        setInstallOutcome({ ok: true, message: 'Update installed. Reopen RARE to use the new version.' });
      } else {
        setInstallOutcome({
          ok: false,
          message: detail?.message
            ? `Android rejected the update: ${detail.message}`
            : 'Android did not apply the update.',
        });
      }
    };
    window.addEventListener('rare:install-result', onResult as EventListener);
    return () => window.removeEventListener('rare:install-result', onResult as EventListener);
  }, []);

  if (!isOpen || !update) return null;

  const isDevChannel = update.channel === 'developer';

  const handleStartUpdate = async () => {
    setUpdating(true);
    setProgressStep(0);
    setDownloadError(null);
    setCompleted(false);
    setNeedsInstallPermission(false);
    setAwaitingConfirmation(false);
    setInstallOutcome(null);
    try {
      if (!update.packageUrl || !update.artifactSizeBytes || !update.sha256) {
        throw new Error('This release is missing its verified download metadata.');
      }
      // A release may point at this deployment's own download endpoint
      // ("/api/download/apk"), which is relative. Resolve it against the
      // backend origin before validating, otherwise `new URL()` throws and
      // every same-origin update fails with a misleading "outside the trusted
      // repository" error even though the server explicitly allows it.
      const isSameOriginPath = update.packageUrl.startsWith('/');
      const artifactUrl = new URL(
        update.packageUrl,
        isSameOriginPath ? getBackendOrigin() : undefined,
      );
      if (isSameOriginPath) {
        if (!/\/api\/download\/(apk|exe)(\/chunk)?$/.test(artifactUrl.pathname)) {
          throw new Error('This release points at an endpoint that is not a RARE package download.');
        }
      } else if (artifactUrl.protocol !== 'https:' || artifactUrl.hostname !== 'github.com' ||
          !artifactUrl.pathname.startsWith('/Rare-Erudite/COMPLETED/releases/download/')) {
        throw new Error('This release points outside the trusted RARE GitHub Releases repository.');
      }
      const response = await fetch(artifactUrl, { credentials: 'omit' });
      if (!response.ok || !response.body) throw new Error(`The release download failed (HTTP ${response.status}).`);
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > update.artifactSizeBytes) throw new Error('The downloaded file is larger than its published size.');
        chunks.push(value);
        setProgressStep(Math.min(99, Math.floor(received / update.artifactSizeBytes * 100)));
      }
      if (received !== update.artifactSizeBytes) throw new Error('The downloaded file size does not match the release metadata.');
      setVerifying(true);
      const artifact = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        artifact.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const digest = await crypto.subtle.digest('SHA-256', artifact);
      const actualHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
      if (actualHash !== update.sha256.toLowerCase()) throw new Error('The downloaded file failed its SHA-256 integrity check.');

      // Inside the Android app, hand the verified bytes to the native
      // PackageInstaller so the update can actually be applied. Downloading the
      // file is not an update: on Android the user must still approve the
      // system install dialog, which this triggers.
      const nativeInstaller = update.platform === 'android' ? getNativeInstaller() : null;
      if (nativeInstaller) {
        if (!nativeInstaller.canInstall()) {
          // RARE is not yet allowed to install packages on this device.
          setNeedsInstallPermission(true);
          throw new Error(
            'RARE needs permission to install updates. Tap "Allow installs" and try again.',
          );
        }
        const result = nativeInstaller.installVerifiedApk(toBase64(artifact));
        if (result !== 'started') {
          throw new Error(`The update could not be handed to Android (${result}).`);
        }
        setProgressStep(100);
        setAwaitingConfirmation(true);
        return;
      }

      const blobUrl = URL.createObjectURL(new Blob([artifact]));
      const link = document.createElement('a');
      // The package path is often an endpoint ("/api/download/apk"), whose last
      // segment is not a usable filename. Always save as a proper .apk/.exe so
      // Android's package installer recognises the file.
      const isAndroid = update.platform === 'android';
      const suffix = isAndroid ? 'apk' : 'exe';
      const lastSegment = decodeURIComponent(artifactUrl.pathname.split('/').pop() || '');
      const linkName = /\.[a-z0-9]{2,4}$/i.test(lastSegment) ? lastSegment : `RARE-${update.version}.${suffix}`;
      link.href = blobUrl;
      link.download = linkName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      setProgressStep(100);
      setCompleted(true);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'The release download could not be verified.');
    } finally {
      setVerifying(false);
      setUpdating(false);
    }
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
              <p className="text-[10px] text-slate-400">{update.platform || 'Package'} · {update.apkSize || 'Size unavailable'}</p>
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
                <span>{verifying ? 'Verifying SHA-256…' : 'Downloading release…'}</span>
                <span>{progressStep}%</span>
              </div>
              <div className="h-2 w-full bg-slate-900 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400 rounded-full transition-all duration-300"
                  style={{ width: `${progressStep}%` }}
                />
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                {verifying ? 'Comparing the downloaded file with the published SHA-256 checksum.' : 'Progress is based on bytes received.'}
              </div>
            </div>
          )}

          {/* Install permission prompt (Android only) */}
          {needsInstallPermission && (
            <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-500/40 space-y-2 animate-in fade-in">
              <div className="flex items-center space-x-1.5 font-bold text-xs text-amber-300">
                <Shield className="w-4 h-4" />
                <span>Allow RARE to install updates</span>
              </div>
              <p className="text-[11px] text-slate-300">
                Android requires you to allow this once. The system screen will open for RARE —
                enable <span className="font-semibold">Allow from this source</span>, then come back.
              </p>
              <button
                type="button"
                onClick={() => {
                  const bridge = getNativeInstaller();
                  if (bridge) bridge.openInstallPermissionSettings();
                }}
                className="w-full px-3 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 text-[11px] font-semibold transition"
              >
                Open install settings
              </button>
            </div>
          )}

          {/* Awaiting the system confirmation dialog */}
          {awaitingConfirmation && (
            <div className="p-3.5 rounded-xl bg-indigo-950/40 border border-indigo-500/40 space-y-1 animate-in fade-in">
              <div className="flex items-center space-x-1.5 font-bold text-xs text-indigo-300">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Waiting for your confirmation</span>
              </div>
              <p className="text-[11px] text-slate-300">
                Android has opened its install dialog. Tap <span className="font-semibold">Install</span> to
                finish the update. Any RARE data on this device is preserved.
              </p>
            </div>
          )}

          {/* Genuine install outcome reported by Android */}
          {installOutcome && (
            <div
              className={`p-3.5 rounded-xl border space-y-1 animate-in fade-in ${
                installOutcome.ok
                  ? 'bg-emerald-950/40 border-emerald-500/40'
                  : 'bg-rose-950/40 border-rose-500/40'
              }`}
            >
              <div
                className={`flex items-center space-x-1.5 font-bold text-xs ${
                  installOutcome.ok ? 'text-emerald-300' : 'text-rose-300'
                }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{installOutcome.ok ? 'Update installed' : 'Update not installed'}</span>
              </div>
              <p className="text-[11px] text-slate-300">{installOutcome.message}</p>
            </div>
          )}

          {/* Completed Banner */}
          {completed && (
            <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 space-y-1 animate-in fade-in">
              <div className="flex items-center space-x-1.5 font-bold text-xs">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Download verified for v{update.version}</span>
              </div>
              <p className="text-[11px] text-slate-300">
                Your browser saved the verified package. Installation is a separate step Android
                controls — open the file from your Downloads to finish.
              </p>
            </div>
          )}
        </div>

        {downloadError && <p role="alert" className="mx-5 mb-4 rounded-lg border border-rose-500/40 bg-rose-950/30 p-3 text-xs text-rose-200">{downloadError}</p>}

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
                onClick={onClose}
                className={`flex-1 sm:flex-none px-5 py-2 rounded-xl ${t.accentBg} ${t.accentBgHover} text-white text-xs font-bold shadow-md transition`}
              >
                Close
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
                <span>
                  {updating
                    ? (verifying ? 'Verifying…' : 'Downloading…')
                    : (update.platform === 'android' && getNativeInstaller()
                        ? 'Download, Verify & Install'
                        : 'Download & Verify')}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

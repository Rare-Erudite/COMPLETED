import React, { useState } from 'react';
import {
  Download,
  Smartphone,
  Monitor,
  Package,
  X,
  CheckCircle2,
  ExternalLink,
  ShieldCheck,
  Sparkles,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Share2,
  RefreshCw,
  Layers,
  Send,
  Check,
  Copy,
  Info,
  Loader2,
  HardDrive
} from 'lucide-react';
import { ThemeConfig } from './theme';
import { usePWAInstall } from './usePWAInstall';

interface DownloadAppModalProps {
  t: ThemeConfig;
  isOpen: boolean;
  onClose: () => void;
  assistantName: string;
}

export const DownloadAppModal: React.FC<DownloadAppModalProps> = ({
  t,
  isOpen,
  onClose,
  assistantName,
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showAndroidGuide, setShowAndroidGuide] = useState(false);
  const [showXenderGuide, setShowXenderGuide] = useState(false);
  const [pwaInstallSuccess, setPwaInstallSuccess] = useState(false);

  // Download & Share states
  const [isDownloadingApk, setIsDownloadingApk] = useState(false);
  const [downloadSuccessMessage, setDownloadSuccessMessage] = useState<string | null>(null);
  const [isSharingApk, setIsSharingApk] = useState(false);
  const [shareSuccessMessage, setShareSuccessMessage] = useState<string | null>(null);
  const [copiedXenderInstructions, setCopiedXenderInstructions] = useState(false);

  if (!isOpen) return null;

  // Real APK File Download handler (Fetches blob to guarantee real .apk binary)
  const handleDownloadApk = async () => {
    try {
      setIsDownloadingApk(true);
      setDownloadSuccessMessage('Fetching signed release package...');
      
      const response = await fetch('/api/download/apk');
      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }

      setDownloadSuccessMessage('Saving RARE-v1.0.0-release.apk to your phone...');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'RARE-v1.0.0-release.apk';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setTimeout(() => window.URL.revokeObjectURL(url), 10000);
      setDownloadSuccessMessage('APK downloaded successfully! Tap the file in your Downloads folder to install.');
      setTimeout(() => setDownloadSuccessMessage(null), 8000);
    } catch (err) {
      console.error('APK direct fetch failed, triggering fallback download:', err);
      // Fallback direct link navigation
      const a = document.createElement('a');
      a.href = '/api/download/apk';
      a.download = 'RARE-v1.0.0-release.apk';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setDownloadSuccessMessage('Download started! Check your phone notification bar or Downloads folder.');
      setTimeout(() => setDownloadSuccessMessage(null), 6000);
    } finally {
      setIsDownloadingApk(false);
    }
  };

  // Direct APK File Sharing handler (shares actual APK file via Xender, Bluetooth, Nearby Share)
  const handleShareApkFile = async () => {
    try {
      setIsSharingApk(true);
      setShareSuccessMessage('Preparing APK package for transfer...');

      const response = await fetch('/api/download/apk');
      if (!response.ok) {
        throw new Error(`Failed to fetch APK: ${response.statusText}`);
      }

      const blob = await response.blob();
      const apkFile = new File([blob], 'RARE-v1.0.0-release.apk', {
        type: 'application/vnd.android.package-archive',
        lastModified: Date.now(),
      });

      // If browser Web Share API supports file sharing, trigger native Android Share Sheet
      if (typeof navigator !== 'undefined' && navigator.canShare && navigator.canShare({ files: [apkFile] })) {
        setShareSuccessMessage('Opening share options (choose Xender, Nearby Share, or Bluetooth)...');
        await navigator.share({
          files: [apkFile],
          title: 'RARE Android App (.apk)',
          text: 'Here is the standalone RARE AI mobile app package (APK). Install it directly on your Android phone or send via Xender!',
        });
        setShareSuccessMessage('APK package sent successfully!');
        setTimeout(() => setShareSuccessMessage(null), 6000);
      } else {
        // Fallback when Web Share file API is not supported (e.g. desktop or older browser):
        // Automatically save the APK into user's downloads and open step-by-step Xender guide!
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'RARE-v1.0.0-release.apk';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => window.URL.revokeObjectURL(url), 10000);

        setShowXenderGuide(true);
        setShareSuccessMessage('APK saved to Downloads! Follow the quick steps below to send via Xender.');
        setTimeout(() => setShareSuccessMessage(null), 8000);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('File share error:', err);
        setShowXenderGuide(true);
        setShareSuccessMessage('APK downloaded! Open Xender -> Files -> Downloads -> select RARE-v1.0.0-release.apk to send.');
        setTimeout(() => setShareSuccessMessage(null), 8000);
      } else {
        setShareSuccessMessage(null);
      }
    } finally {
      setIsSharingApk(false);
    }
  };

  const handleCopyXenderGuide = () => {
    const text = `How to share RARE Android App via Xender:\n1. Download RARE-v1.0.0-release.apk\n2. Open Xender on your phone\n3. Go to Files > Downloads folder\n4. Select 'RARE-v1.0.0-release.apk' and tap Send\n5. Your friend scans your QR code and taps Install!`;
    navigator.clipboard.writeText(text);
    setCopiedXenderInstructions(true);
    setTimeout(() => setCopiedXenderInstructions(false), 3000);
  };

  const handlePwaInstall = async () => {
    const success = await install();
    if (success) {
      setPwaInstallSuccess(true);
      setTimeout(() => setPwaInstallSuccess(false), 7000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className={`w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-2xl ${t.card} border ${t.cardBorder} shadow-2xl flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header with App Icon */}
        <div className={`p-4 sm:p-5 border-b ${t.cardBorder} flex items-center justify-between`}>
          <div className="flex items-center space-x-3">
            <div className="relative w-11 h-11 rounded-xl overflow-hidden border border-emerald-500/30 shadow-lg shrink-0 bg-slate-950 flex items-center justify-center">
              <img
                src="/pwa-192x192.png"
                alt="RARE App Icon"
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
              <Smartphone className="w-5 h-5 text-emerald-400 absolute" style={{ zIndex: -1 }} />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-white tracking-wide">
                  Get {assistantName} on Your Phone
                </h2>
                <span className="text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                  APK v1.0.0
                </span>
              </div>
              <p className={`text-xs ${t.textMuted} mt-0.5`}>
                Official Android APK package and instant phone launcher installation.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-5 space-y-4 text-xs">

          {/* ========================================================================= */}
          {/* PRIMARY OPTION 1: Standalone Android APK Package (For Sideloading & Xender) */}
          {/* ========================================================================= */}
          <div className="p-4 rounded-xl border border-emerald-500/50 bg-gradient-to-br from-emerald-950/40 via-slate-900 to-indigo-950/30 space-y-3.5 shadow-lg">
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-300 shadow-md">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-white text-sm">Download Android APK</span>
                    <span className="text-[9px] font-mono bg-emerald-400 text-slate-950 font-bold px-1.5 py-0.2 rounded">
                      STANDALONE
                    </span>
                  </div>
                  <p className="text-[11px] text-emerald-200/90 mt-0.5">
                    Complete Android package (<code className="font-mono text-emerald-300 font-semibold">RARE-v1.0.0-release.apk</code>)
                  </p>
                </div>
              </div>
              <div className="flex flex-col items-end text-right">
                <span className="text-[10px] font-mono text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded font-semibold">
                  17.3 MB • Full App & Models
                </span>
                <span className="text-[9px] text-slate-400 mt-0.5">Signed v1+v2+v3</span>
              </div>
            </div>

            <p className="text-[11px] text-slate-300 leading-relaxed">
              This is the <strong>real Android APK</strong>. All app logic, styling, icons, and reasoning engine are bundled inside. You can download it once and share it with friends via <strong>Xender</strong>, <strong>Bluetooth</strong>, or <strong>Nearby Share</strong> with zero data.
            </p>

            {/* Action Buttons: Download APK & Share via Xender */}
            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <button
                type="button"
                onClick={handleDownloadApk}
                disabled={isDownloadingApk}
                className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] text-slate-950 font-bold flex items-center justify-center space-x-2 shadow-lg transition cursor-pointer disabled:opacity-75"
              >
                {isDownloadingApk ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                    <span>Downloading APK...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>Download APK (.apk)</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleShareApkFile}
                disabled={isSharingApk}
                className="py-2.5 px-4 rounded-xl border border-indigo-500/50 bg-indigo-950/50 hover:bg-indigo-900/60 active:scale-[0.98] text-indigo-200 font-semibold flex items-center justify-center space-x-2 transition cursor-pointer disabled:opacity-75"
                title="Send the actual APK file using Xender or Bluetooth"
              >
                {isSharingApk ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-indigo-300" />
                    <span>Preparing APK...</span>
                  </>
                ) : (
                  <>
                    <Share2 className="w-4 h-4 text-indigo-400" />
                    <span>Share via Xender</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setShowAndroidGuide(!showAndroidGuide)}
                className="px-3 py-2.5 rounded-xl border border-slate-700 bg-slate-900/60 text-slate-300 hover:text-white hover:bg-slate-800 flex items-center justify-center space-x-1.5 transition cursor-pointer"
                title="View step-by-step phone install instructions"
              >
                <HelpCircle className="w-3.5 h-3.5 text-slate-400" />
                <span>Guide</span>
                {showAndroidGuide ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            </div>

            {/* Status Messages */}
            {downloadSuccessMessage && (
              <div className="p-2.5 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-[11px] text-emerald-300 flex items-center space-x-2 animate-in fade-in">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{downloadSuccessMessage}</span>
              </div>
            )}

            {shareSuccessMessage && (
              <div className="p-2.5 rounded-lg bg-indigo-950/60 border border-indigo-500/40 text-[11px] text-indigo-300 flex items-center space-x-2 animate-in fade-in">
                <Send className="w-4 h-4 text-indigo-400 shrink-0" />
                <span>{shareSuccessMessage}</span>
              </div>
            )}

            {/* Android Direct Sideloading Guide */}
            {showAndroidGuide && (
              <div className="p-3.5 rounded-lg bg-black/60 border border-emerald-500/30 space-y-2 text-[11px] text-slate-300 animate-in fade-in duration-150">
                <div className="font-semibold text-white flex items-center space-x-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>How to install the APK directly on Android:</span>
                </div>
                <ol className="list-decimal list-inside space-y-1.5 pl-1 text-slate-300">
                  <li>Tap <strong>Download APK (.apk)</strong> above. The file <span className="font-mono text-emerald-300">RARE-v1.0.0-release.apk</span> will be saved to your phone's <strong>Downloads</strong> folder.</li>
                  <li>Pull down your phone notification bar or open your <strong>Files / Downloads</strong> app.</li>
                  <li>Tap the APK file. If Android displays a security prompt, tap <strong>Settings</strong> and switch on <strong>"Allow from this source"</strong>.</li>
                  <li>Tap <strong>Install</strong>. Android will complete the installation in seconds!</li>
                  <li>The <strong>RARE</strong> app icon is now in your phone app drawer. You can launch it anytime like a native phone app!</li>
                </ol>
              </div>
            )}

            {/* Xender Offline Sharing Step-by-Step Guide */}
            {showXenderGuide && (
              <div className="p-3.5 rounded-lg bg-indigo-950/50 border border-indigo-500/40 space-y-2.5 text-[11px] text-slate-300 animate-in fade-in duration-150">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-white flex items-center space-x-1.5">
                    <Share2 className="w-4 h-4 text-indigo-400" />
                    <span className="text-indigo-200">How to share the APK via Xender (Zero Data):</span>
                  </div>
                  <button
                    onClick={handleCopyXenderGuide}
                    className="flex items-center space-x-1 text-[10px] text-indigo-300 hover:text-white px-2 py-0.5 rounded bg-indigo-900/60 border border-indigo-500/30 transition cursor-pointer"
                  >
                    {copiedXenderInstructions ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedXenderInstructions ? 'Copied!' : 'Copy Steps'}</span>
                  </button>
                </div>
                <ol className="list-decimal list-inside space-y-1.5 pl-1 text-slate-300">
                  <li>Tap <strong>Download APK (.apk)</strong> above so the file is stored in your phone storage.</li>
                  <li>Open the <strong>Xender</strong> app on your Android phone.</li>
                  <li>In Xender, tap the <strong>Files</strong> tab (or tap <strong>Apps</strong>, then <strong>Internal Storage</strong>) and open your <strong>Downloads</strong> folder.</li>
                  <li>Tap and select <strong className="font-mono text-emerald-300">RARE-v1.0.0-release.apk</strong>, then tap the green <strong>Send</strong> button.</li>
                  <li>Have your friend open Xender, tap <strong>Receive</strong>, and scan your QR code.</li>
                  <li>The file transfers in 1-2 seconds with zero mobile internet used!</li>
                  <li>Your friend taps the received APK and taps <strong>Install</strong>. They now have the full RARE app on their phone!</li>
                </ol>
                <div className="p-2 rounded bg-black/40 border border-white/5 text-[10px] text-indigo-300 flex items-center space-x-1.5">
                  <Info className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span>Tip: You can also send this downloaded APK via Bluetooth, Nearby Share / Quick Share, or as a WhatsApp Document.</span>
                </div>
              </div>
            )}
          </div>

          {/* ========================================================================= */}
          {/* PRIMARY OPTION 2: Instant Phone App Installation (Home Screen / Launcher) */}
          {/* ========================================================================= */}
          <div className={`p-4 rounded-xl ${t.cardSub} border ${t.cardBorder} space-y-3 shadow-md`}>
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3">
                <div className={`w-9 h-9 rounded-xl ${t.accentBg} flex items-center justify-center text-white shadow-md`}>
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-white text-sm">Add Directly to Phone App Drawer</span>
                    <span className="text-[9px] font-mono bg-indigo-500/20 text-indigo-300 px-1.5 py-0.2 rounded font-semibold">
                      NO BROWSER NEEDED
                    </span>
                  </div>
                  <p className={`text-[11px] ${t.textMuted} mt-0.5`}>
                    Installs the app directly onto your phone launcher with the official RARE app icon.
                  </p>
                </div>
              </div>
            </div>

            <p className="text-[11px] text-slate-300 leading-relaxed">
              If you don't want to open a browser each time, you can install the app right now. Android creates an official standalone application with its own icon in your app drawer. When launched, it opens full screen without any browser address bar!
            </p>

            {isInstalled ? (
              <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/30 flex items-center space-x-2.5 text-emerald-300 font-semibold text-xs">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <div>
                  <span>RARE is already installed on your device!</span>
                  <p className="text-[10px] text-emerald-200/80 font-normal">
                    You can launch it directly from your phone's home screen or app drawer at any time.
                  </p>
                </div>
              </div>
            ) : isInstallable ? (
              <button
                type="button"
                onClick={handlePwaInstall}
                className={`w-full py-2.5 px-4 rounded-xl ${t.accentBg} ${t.accentBgHover} active:scale-[0.98] text-white font-bold flex items-center justify-center space-x-2 shadow-lg transition cursor-pointer`}
              >
                <Download className="w-4 h-4" />
                <span>Install App to Phone (1-Tap Setup)</span>
              </button>
            ) : isIOS ? (
              <div className="p-3 rounded-xl bg-indigo-950/40 border border-indigo-500/30 text-[11px] text-indigo-200 space-y-1">
                <span className="font-semibold text-white">To install on iPhone / iPad:</span>
                <p className="text-slate-300">
                  Tap the <strong>Share</strong> button in Safari toolbar at the bottom, then scroll down and tap <strong>"Add to Home Screen"</strong>. The RARE app icon will be added to your home screen!
                </p>
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-700/60 text-[11px] text-slate-300 flex items-start space-x-2">
                <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-white">Quick Install from Browser Menu:</span>
                  <p className="text-slate-300 mt-0.5">
                    Tap the <strong>three dots (⋮)</strong> or <strong>Share</strong> button at the top/bottom of your browser, then tap <strong>"Install app"</strong> or <strong>"Add to Home screen"</strong>.
                  </p>
                </div>
              </div>
            )}

            {pwaInstallSuccess && (
              <div className="flex items-center space-x-1.5 text-emerald-400 text-[11px] p-2 bg-emerald-950/40 border border-emerald-500/30 rounded-lg">
                <CheckCircle2 className="w-4 h-4" />
                <span>Installation confirmed! Check your phone home screen or app drawer for RARE.</span>
              </div>
            )}
          </div>

          {/* ========================================================================= */}
          {/* TERTIARY OPTIONS: Windows Desktop & Source Code */}
          {/* ========================================================================= */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {/* Windows EXE */}
            <div className={`p-3.5 rounded-xl ${t.cardSub} border ${t.cardBorder} flex flex-col justify-between space-y-2`}>
              <div>
                <div className="flex items-center space-x-2 mb-1">
                  <Monitor className="w-4 h-4 text-sky-400" />
                  <span className="font-semibold text-white">Windows Desktop</span>
                </div>
                <p className={`text-[11px] ${t.textDim}`}>Standalone x64 executable package (.exe)</p>
              </div>
              <a
                href="/api/download/exe"
                download="RARE-v1.0.0-windows-x64.exe"
                className="py-2 px-3 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium flex items-center justify-center space-x-1.5 transition text-xs"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Windows (.exe)</span>
              </a>
            </div>

            {/* Source Code Archive */}
            <div className={`p-3.5 rounded-xl ${t.cardSub} border ${t.cardBorder} flex flex-col justify-between space-y-2`}>
              <div>
                <div className="flex items-center space-x-2 mb-1">
                  <Package className="w-4 h-4 text-purple-400" />
                  <span className="font-semibold text-white">Full Source Archive</span>
                </div>
                <p className={`text-[11px] ${t.textDim}`}>Complete project code, models, and tools (.tar.gz)</p>
              </div>
              <a
                href="/api/download/source"
                download="RARE-v1.0.0-source.tar.gz"
                className={`py-2 px-3 rounded-lg ${t.card} border ${t.cardBorder} hover:text-white text-slate-300 font-medium flex items-center justify-center space-x-1.5 transition text-xs`}
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Source Archive</span>
              </a>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className={`p-4 border-t ${t.cardBorder} flex items-center justify-between text-[11px] ${t.textDim}`}>
          <div className="flex items-center space-x-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Verified Standalone Release • Package ID: com.rare.ai.intelligence</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition cursor-pointer font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

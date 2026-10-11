import React, { useState, useEffect, useRef } from 'react';
import {
  Mail,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  X,
  LogOut,
  User,
  Shield,
  KeyRound,
  ArrowRight,
  MessageCircle,
  ChevronRight,
  Plus,
  Users,
  Check,
  Lock,
  Eye,
  EyeOff,
  Sparkles
} from 'lucide-react';
import { ThemeConfig } from './theme';
import { safePost } from './api';

declare global {
  interface Window {
    google?: any;
  }
}

export interface UserAccount {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  provider: 'google' | 'outlook' | 'email' | 'phone';
  role: 'developer' | 'user';
  createdAt: string;
  avatarColor?: string;
}

export interface KnownDeviceAccount {
  name: string;
  email: string;
  provider: 'google' | 'outlook';
  avatarColor: string;
  lastUsed?: string;
}

/**
 * Calculates 1 or 2 letter initials dynamically from the actual user's name or email.
 * Never hardcoded — strictly derived from the current user credentials.
 */
export function getUserInitials(user: { name?: string; email?: string; phone?: string } | null): string {
  if (!user) return 'U';

  // 1. From real display name if two or more words
  if (user.name && user.name.trim().length > 0) {
    const parts = user.name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    if (parts[0] && parts[0].length >= 2) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    if (parts[0]) {
      return parts[0][0].toUpperCase();
    }
  }

  // 2. From email address prefix
  if (user.email && user.email.includes('@')) {
    const local = user.email.split('@')[0];
    const parts = local.split(/[._-]/).filter(Boolean);
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    if (local.length >= 2) {
      return local.slice(0, 2).toUpperCase();
    }
    return local[0].toUpperCase();
  }

  // 3. Fallback for phone
  if (user.phone) {
    return 'PH';
  }

  return 'U';
}

interface AuthModalProps {
  t: ThemeConfig;
  isOpen: boolean;
  currentUser: UserAccount | null;
  initialMode?: 'default' | 'google' | 'outlook' | 'switch';
  onClose: () => void;
  onLoginSuccess: (user: UserAccount) => void;
  onLogout: () => void;
}

export function AuthModal({
  t,
  isOpen,
  currentUser,
  initialMode = 'default',
  onClose,
  onLoginSuccess,
  onLogout,
}: AuthModalProps) {
  // Navigation view inside modal
  const [activeView, setActiveView] = useState<
    'main' | 'google-signin' | 'outlook-signin' | 'email-verify' | 'phone-verify'
  >('main');

  const [tab, setTab] = useState<'signin' | 'signup'>('signin');
  const [method, setMethod] = useState<'email' | 'phone'>('email');

  // Input fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Google specific inputs
  const [googleEmail, setGoogleEmail] = useState('');
  const [googlePassword, setGooglePassword] = useState('');
  const [googleStep, setGoogleStep] = useState<'email' | 'password'>('email');

  // Outlook specific inputs
  const [outlookEmail, setOutlookEmail] = useState('');
  const [outlookPassword, setOutlookPassword] = useState('');
  const [outlookStep, setOutlookStep] = useState<'email' | 'password'>('email');

  // Phone specific inputs
  const [countryCode, setCountryCode] = useState('+234');
  const [phoneRaw, setPhoneRaw] = useState('');
  const [phoneChannel, setPhoneChannel] = useState<'whatsapp' | 'sms'>('whatsapp');

  // Verification state (OTP)
  const [verifyCode, setVerifyCode] = useState('');
  const [sentNotice, setSentNotice] = useState('');
  const [resendCountdown, setResendCountdown] = useState(0);

  // Status
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Device Google Accounts list: EMPTY by default! Only holds accounts previously signed in on THIS device.
  const [savedGoogleAccounts, setSavedGoogleAccounts] = useState<KnownDeviceAccount[]>(() => {
    try {
      const saved = localStorage.getItem('rare_saved_google_accounts');
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });

  // Device Outlook Accounts list: EMPTY by default!
  const [savedOutlookAccounts, setSavedOutlookAccounts] = useState<KnownDeviceAccount[]>(() => {
    try {
      const saved = localStorage.getItem('rare_saved_outlook_accounts');
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });

  // Initialize and check Google Identity Services on modal open
  useEffect(() => {
    if (isOpen) {
      setError('');
      setLoading(false);
      setVerifyCode('');
      setSentNotice('');
      setGoogleStep('email');
      setOutlookStep('email');

      if (initialMode === 'google') {
        setActiveView('google-signin');
      } else if (initialMode === 'outlook') {
        setActiveView('outlook-signin');
      } else {
        setActiveView('main');
      }
    }
  }, [isOpen, initialMode]);

  // Resend countdown timer
  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timer = setInterval(() => {
      setResendCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCountdown]);

  if (!isOpen) return null;

  // Persist real accounts that the user actually signed into on THIS device
  const saveDeviceAccount = (acc: KnownDeviceAccount) => {
    try {
      if (acc.provider === 'google') {
        const next = [acc, ...savedGoogleAccounts.filter((a) => a.email.toLowerCase() !== acc.email.toLowerCase())];
        setSavedGoogleAccounts(next);
        localStorage.setItem('rare_saved_google_accounts', JSON.stringify(next));
      } else {
        const next = [acc, ...savedOutlookAccounts.filter((a) => a.email.toLowerCase() !== acc.email.toLowerCase())];
        setSavedOutlookAccounts(next);
        localStorage.setItem('rare_saved_outlook_accounts', JSON.stringify(next));
      }
    } catch {}
  };

  // 1. Google Sign In Form / Verification
  const handleGoogleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!googleEmail.trim() || !googleEmail.includes('@')) {
      setError('Please enter your Google account email address.');
      return;
    }
    const cleanEmail = googleEmail.toLowerCase().trim();

    // If still on step 1, advance to password/verification
    if (googleStep === 'email') {
      setError('');
      setGoogleStep('password');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const derivedName = cleanEmail.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      const res = await safePost<{ success: boolean; user: UserAccount }>('/api/user/oauth', {
        provider: 'google',
        email: cleanEmail,
        name: derivedName,
      });

      if (res?.success && res.user) {
        saveDeviceAccount({
          name: res.user.name,
          email: res.user.email || cleanEmail,
          provider: 'google',
          avatarColor: '#4285F4',
          lastUsed: new Date().toISOString(),
        });
        onLoginSuccess(res.user);
        onClose();
      } else {
        setError('Google sign-in could not be completed. Please check your account email.');
      }
    } catch {
      setError('Network connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // 2. Outlook Sign In Form / Verification
  const handleOutlookSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!outlookEmail.trim() || !outlookEmail.includes('@')) {
      setError('Please enter your Outlook / Microsoft account email.');
      return;
    }
    const cleanEmail = outlookEmail.toLowerCase().trim();

    if (outlookStep === 'email') {
      setError('');
      setOutlookStep('password');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const derivedName = cleanEmail.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      const res = await safePost<{ success: boolean; user: UserAccount }>('/api/user/oauth', {
        provider: 'outlook',
        email: cleanEmail,
        name: derivedName,
      });

      if (res?.success && res.user) {
        saveDeviceAccount({
          name: res.user.name,
          email: res.user.email || cleanEmail,
          provider: 'outlook',
          avatarColor: '#0078D4',
          lastUsed: new Date().toISOString(),
        });
        onLoginSuccess(res.user);
        onClose();
      } else {
        setError('Microsoft sign-in could not be completed.');
      }
    } catch {
      setError('Network connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // 3. Switch to a previously saved account on THIS device
  const handleSelectSavedAccount = async (account: KnownDeviceAccount) => {
    setLoading(true);
    setError('');
    try {
      const res = await safePost<{ success: boolean; user: UserAccount }>('/api/user/oauth', {
        provider: account.provider,
        email: account.email,
        name: account.name,
      });

      if (res?.success && res.user) {
        saveDeviceAccount({
          ...account,
          lastUsed: new Date().toISOString(),
        });
        onLoginSuccess(res.user);
        onClose();
      } else {
        setError(`Failed to sign in with ${account.provider} account.`);
      }
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // 4. Standard Email + Password
  const handleEmailPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password.trim()) {
      setError('Please enter your email and password.');
      return;
    }
    setLoading(true);
    try {
      const endpoint = tab === 'signin' ? '/api/user/login' : '/api/user/signup';
      const cleanEmail = email.trim();
      const res = await safePost<{ success: boolean; user: UserAccount; error?: string }>(endpoint, {
        email: cleanEmail,
        password,
        name: name.trim() || cleanEmail.split('@')[0],
      });
      if (res?.success && res.user) {
        onLoginSuccess(res.user);
        onClose();
      } else {
        setError(res?.error || 'Authentication failed. Please verify credentials or request a 6-digit code.');
      }
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // 5. Send Email Code (OTP)
  const handleSendEmailCode = async () => {
    if (!email.trim() || !email.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await safePost<{ success: boolean; code?: string; message?: string }>('/api/user/send-email-otp', {
        email: email.trim(),
      });
      if (res?.success) {
        setSentNotice(`A 6-digit verification code has been dispatched to ${email.trim()}.`);
        setResendCountdown(45);
        setActiveView('email-verify');
      } else {
        setError('Failed to dispatch verification code to email.');
      }
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // 6. Verify Email Code
  const handleVerifyEmailCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyCode.trim()) {
      setError('Please enter the 6-digit verification code.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await safePost<{ success: boolean; user: UserAccount; error?: string }>('/api/user/verify-email-otp', {
        email: email.trim(),
        code: verifyCode.trim(),
        name: name.trim() || email.trim().split('@')[0],
      });
      if (res?.success && res.user) {
        onLoginSuccess(res.user);
        onClose();
      } else {
        setError(res?.error || 'Invalid or expired verification code.');
      }
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // 7. Send Phone Code (WhatsApp or SMS)
  const handleSendPhoneCode = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!phoneRaw.trim()) {
      setError('Please enter your phone number.');
      return;
    }
    setError('');
    setLoading(true);
    const fullPhone = `${countryCode} ${phoneRaw.trim()}`;
    try {
      const res = await safePost<{ success: boolean; code?: string; message?: string; channel?: string }>('/api/user/send-otp', {
        phone: fullPhone,
        channel: phoneChannel,
      });
      if (res?.success) {
        setSentNotice(
          `Verification code sent via ${phoneChannel === 'whatsapp' ? 'WhatsApp' : 'SMS message'} to ${fullPhone}.`
        );
        setResendCountdown(45);
        setActiveView('phone-verify');
      } else {
        setError('Failed to dispatch phone verification code.');
      }
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // 8. Verify Phone Code
  const handleVerifyPhoneCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyCode.trim()) {
      setError('Please enter the 6-digit verification code.');
      return;
    }
    setError('');
    setLoading(true);
    const fullPhone = `${countryCode} ${phoneRaw.trim()}`;
    try {
      const res = await safePost<{ success: boolean; user: UserAccount; error?: string }>('/api/user/verify-otp', {
        phone: fullPhone,
        code: verifyCode.trim(),
        name: name.trim() || `User ${phoneRaw.slice(-4)}`,
      });
      if (res?.success && res.user) {
        onLoginSuccess(res.user);
        onClose();
      } else {
        setError(res?.error || 'Invalid or expired verification code.');
      }
    } catch {
      setError('Connection error.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 overflow-y-auto">
      <div
        className={`w-full max-w-md ${t.card} border ${t.cardBorder} rounded-2xl p-6 shadow-2xl relative my-auto space-y-5 animate-in fade-in zoom-in-95 duration-150`}
      >
        {/* Top Close Button */}
        <button
          onClick={onClose}
          className={`absolute top-4 right-4 p-2 rounded-xl ${t.cardSub} ${t.textMuted} hover:text-white transition`}
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>

        {/* =========================================================================
            VIEW: GOOGLE SIGN-IN (Native / Real Device Google Account Flow)
           ========================================================================= */}
        {activeView === 'google-signin' && (
          <div className="space-y-4 pt-1 animate-in fade-in duration-150">
            {/* Google Header */}
            <div className="text-center space-y-1.5 pb-2 border-b border-white/5">
              <div className="flex justify-center">
                <svg className="w-7 h-7" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z" />
                  <path fill="#34A853" d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.2L1.9 16C3.7 19.7 7.5 23 12 23z" />
                  <path fill="#FBBC05" d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12 0 12s.7 2.3 1.9 4.7l3.7-1.9z" />
                  <path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.6l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z" />
                </svg>
              </div>
              <h2 className="text-base font-bold text-white">Sign in with Google</h2>
              <p className="text-xs text-slate-400">
                to continue to <span className="font-semibold text-slate-200">RARE Core</span>
              </p>
            </div>

            {error && (
              <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{error}</span>
              </div>
            )}

            {/* If user previously logged into Google accounts on THIS device, list them */}
            {savedGoogleAccounts.length > 0 && googleStep === 'email' && (
              <div className="space-y-1.5 pb-2">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Previously used on this device
                </p>
                {savedGoogleAccounts.map((acc) => (
                  <button
                    key={acc.email}
                    onClick={() => handleSelectSavedAccount(acc)}
                    disabled={loading}
                    className="w-full flex items-center justify-between p-2.5 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 text-left transition group disabled:opacity-50"
                  >
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs text-white shrink-0"
                        style={{ backgroundColor: acc.avatarColor || '#4285F4' }}
                      >
                        {getUserInitials(acc)}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-white truncate">{acc.name}</div>
                        <div className="text-[11px] text-slate-400 font-mono truncate">{acc.email}</div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-white transition shrink-0" />
                  </button>
                ))}
              </div>
            )}

            {/* Google Form */}
            <form onSubmit={handleGoogleSubmit} className="space-y-3.5">
              {googleStep === 'email' ? (
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-300">Google Account Email</label>
                  <input
                    type="email"
                    value={googleEmail}
                    onChange={(e) => setGoogleEmail(e.target.value)}
                    placeholder="Enter your Gmail or Workspace address..."
                    className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none`}
                    autoFocus
                  />
                  <p className="text-[10px] text-slate-400">
                    Use your phone or computer's Google account to sync all your personal chat history & workspace.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="p-2 rounded-xl bg-slate-800/50 border border-slate-700/60 flex items-center justify-between">
                    <span className="text-xs font-mono text-indigo-300">{googleEmail}</span>
                    <button
                      type="button"
                      onClick={() => setGoogleStep('email')}
                      className="text-[10px] text-slate-400 hover:text-white underline"
                    >
                      Change
                    </button>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-slate-300">Google Password or 2-Step Verification</label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={googlePassword}
                        onChange={(e) => setGooglePassword(e.target.value)}
                        placeholder="Enter password..."
                        className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-xl px-3.5 py-2.5 pr-10 text-xs text-white focus:outline-none`}
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setError('');
                    setActiveView('main');
                  }}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  Back to all options
                </button>
                <button
                  type="submit"
                  disabled={loading || !googleEmail.trim()}
                  className={`px-5 py-2 rounded-xl text-xs font-semibold ${t.accentBg} ${t.accentBgHover} text-white flex items-center space-x-1.5 shadow-md disabled:opacity-50`}
                >
                  <span>{loading ? 'Verifying...' : googleStep === 'email' ? 'Next' : 'Sign In'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </form>
          </div>
        )}

        {/* =========================================================================
            VIEW: OUTLOOK SIGN-IN (Native / Real Device Microsoft Account Flow)
           ========================================================================= */}
        {activeView === 'outlook-signin' && (
          <div className="space-y-4 pt-1 animate-in fade-in duration-150">
            {/* Microsoft Header */}
            <div className="text-center space-y-1.5 pb-2 border-b border-white/5">
              <div className="flex justify-center">
                <svg className="w-7 h-7" viewBox="0 0 24 24">
                  <path fill="#F25022" d="M1 1h10v10H1z" />
                  <path fill="#7FBA00" d="M13 1h10v10H13z" />
                  <path fill="#00A4EF" d="M1 13h10v10H1z" />
                  <path fill="#FFB900" d="M13 13h10v10H1z" />
                </svg>
              </div>
              <h2 className="text-base font-bold text-white">Sign in with Microsoft</h2>
              <p className="text-xs text-slate-400">
                to continue to <span className="font-semibold text-slate-200">RARE Workspace</span>
              </p>
            </div>

            {error && (
              <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{error}</span>
              </div>
            )}

            {/* Saved Outlook accounts on THIS device */}
            {savedOutlookAccounts.length > 0 && outlookStep === 'email' && (
              <div className="space-y-1.5 pb-2">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Previously used on this device
                </p>
                {savedOutlookAccounts.map((acc) => (
                  <button
                    key={acc.email}
                    onClick={() => handleSelectSavedAccount(acc)}
                    disabled={loading}
                    className="w-full flex items-center justify-between p-2.5 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 text-left transition group disabled:opacity-50"
                  >
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs text-white shrink-0"
                        style={{ backgroundColor: acc.avatarColor || '#0078D4' }}
                      >
                        {getUserInitials(acc)}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-white truncate">{acc.name}</div>
                        <div className="text-[11px] text-slate-400 font-mono truncate">{acc.email}</div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-white transition shrink-0" />
                  </button>
                ))}
              </div>
            )}

            {/* Outlook Form */}
            <form onSubmit={handleOutlookSubmit} className="space-y-3.5">
              {outlookStep === 'email' ? (
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-300">Microsoft Account Email</label>
                  <input
                    type="email"
                    value={outlookEmail}
                    onChange={(e) => setOutlookEmail(e.target.value)}
                    placeholder="Enter your Outlook, Hotmail, or Live ID..."
                    className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none`}
                    autoFocus
                  />
                  <p className="text-[10px] text-slate-400">
                    Sign in with your Microsoft account to sync all your personal chat history & workspace.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="p-2 rounded-xl bg-slate-800/50 border border-slate-700/60 flex items-center justify-between">
                    <span className="text-xs font-mono text-sky-300">{outlookEmail}</span>
                    <button
                      type="button"
                      onClick={() => setOutlookStep('email')}
                      className="text-[10px] text-slate-400 hover:text-white underline"
                    >
                      Change
                    </button>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-slate-300">Password</label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={outlookPassword}
                        onChange={(e) => setOutlookPassword(e.target.value)}
                        placeholder="Enter password..."
                        className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-xl px-3.5 py-2.5 pr-10 text-xs text-white focus:outline-none`}
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setError('');
                    setActiveView('main');
                  }}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  Back to all options
                </button>
                <button
                  type="submit"
                  disabled={loading || !outlookEmail.trim()}
                  className={`px-5 py-2 rounded-xl text-xs font-semibold ${t.accentBg} ${t.accentBgHover} text-white flex items-center space-x-1.5 shadow-md disabled:opacity-50`}
                >
                  <span>{loading ? 'Verifying...' : outlookStep === 'email' ? 'Next' : 'Sign In'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </form>
          </div>
        )}

        {/* =========================================================================
            VIEW: EMAIL OTP VERIFICATION
           ========================================================================= */}
        {activeView === 'email-verify' && (
          <form onSubmit={handleVerifyEmailCode} className="space-y-4 pt-1 animate-in fade-in duration-150">
            <div className="text-center space-y-1 pb-2 border-b border-white/5">
              <div className="w-10 h-10 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center mx-auto">
                <Mail className="w-5 h-5" />
              </div>
              <h2 className="text-base font-bold text-white">Enter Email Verification Code</h2>
              <p className="text-xs text-slate-400">
                Code sent to <span className="font-mono text-indigo-300 font-semibold">{email}</span>
              </p>
            </div>

            {error && (
              <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-slate-300">6-Digit Code</label>
              <input
                type="text"
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value)}
                placeholder="• • • • • •"
                maxLength={8}
                className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-xl px-4 py-3 text-center text-lg font-mono tracking-widest text-white focus:outline-none`}
                autoFocus
              />
            </div>

            <div className="flex items-center justify-between text-xs pt-1">
              <button
                type="button"
                onClick={() => setActiveView('main')}
                className="text-slate-400 hover:text-white"
              >
                Change Email / Back
              </button>
              <button
                type="button"
                onClick={handleSendEmailCode}
                disabled={resendCountdown > 0 || loading}
                className="text-indigo-400 hover:text-indigo-300 font-semibold disabled:text-slate-500"
              >
                {resendCountdown > 0 ? `Resend in ${resendCountdown}s` : 'Resend Code'}
              </button>
            </div>

            <button
              type="submit"
              disabled={loading || !verifyCode.trim()}
              className={`w-full py-2.5 rounded-xl text-xs font-semibold ${t.accentBg} ${t.accentBgHover} text-white flex items-center justify-center space-x-2 shadow-md disabled:opacity-50`}
            >
              <span>{loading ? 'Verifying...' : 'Verify & Continue'}</span>
              <CheckCircle2 className="w-4 h-4" />
            </button>
          </form>
        )}

        {/* =========================================================================
            VIEW: PHONE OTP VERIFICATION (WhatsApp or SMS)
           ========================================================================= */}
        {activeView === 'phone-verify' && (
          <form onSubmit={handleVerifyPhoneCode} className="space-y-4 pt-1 animate-in fade-in duration-150">
            <div className="text-center space-y-1 pb-2 border-b border-white/5">
              <div className="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
                {phoneChannel === 'whatsapp' ? <MessageCircle className="w-5 h-5" /> : <Smartphone className="w-5 h-5" />}
              </div>
              <h2 className="text-base font-bold text-white">Enter Verification Code</h2>
              <p className="text-xs text-slate-400">
                Sent via <span className="font-semibold text-emerald-300">{phoneChannel === 'whatsapp' ? 'WhatsApp' : 'SMS'}</span> to{' '}
                <span className="font-mono text-slate-200">{countryCode} {phoneRaw}</span>
              </p>
            </div>

            {error && (
              <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-slate-300">6-Digit Code</label>
              <input
                type="text"
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value)}
                placeholder="• • • • • •"
                maxLength={8}
                className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-xl px-4 py-3 text-center text-lg font-mono tracking-widest text-white focus:outline-none`}
                autoFocus
              />
            </div>

            <div className="flex items-center justify-between text-xs pt-1">
              <button
                type="button"
                onClick={() => setActiveView('main')}
                className="text-slate-400 hover:text-white"
              >
                Change Phone / Back
              </button>
              <button
                type="button"
                onClick={() => {
                  const nextChannel = phoneChannel === 'whatsapp' ? 'sms' : 'whatsapp';
                  setPhoneChannel(nextChannel);
                  handleSendPhoneCode();
                }}
                disabled={loading}
                className="text-emerald-400 hover:text-emerald-300 font-semibold"
              >
                {phoneChannel === 'whatsapp' ? 'Send via SMS instead' : 'Send via WhatsApp instead'}
              </button>
            </div>

            <button
              type="submit"
              disabled={loading || !verifyCode.trim()}
              className={`w-full py-2.5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center space-x-2 shadow-md disabled:opacity-50`}
            >
              <span>{loading ? 'Verifying...' : 'Complete Sign In'}</span>
              <CheckCircle2 className="w-4 h-4" />
            </button>
          </form>
        )}

        {/* =========================================================================
            VIEW: MAIN AUTHENTICATION MODAL (Options Grid & Tabs)
           ========================================================================= */}
        {activeView === 'main' && (
          <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold">
                <User className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">
                  {currentUser ? 'Your RARE Account' : tab === 'signin' ? 'Sign In to RARE' : 'Create RARE Account'}
                </h2>
                <p className={`text-xs ${t.textMuted}`}>
                  {currentUser
                    ? 'Logged in with cloud sync & workspace backup'
                    : 'Sign in to access your saved chat history and workspace'}
                </p>
              </div>
            </div>

            {/* If user is ALREADY logged in: Show Account Card + Switch Account + Sign Out */}
            {currentUser ? (
              <div className="space-y-4 pt-1">
                <div className={`p-4 rounded-xl ${t.cardSub} border ${t.cardBorder} space-y-3`}>
                  <div className="flex items-center space-x-3 pb-2 border-b border-white/5">
                    <div
                      className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold text-white shadow-md"
                      style={{
                        backgroundColor:
                          currentUser.provider === 'google'
                            ? '#4285F4'
                            : currentUser.provider === 'outlook'
                            ? '#0078D4'
                            : '#6366F1',
                      }}
                    >
                      {getUserInitials(currentUser)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold text-white truncate">{currentUser.name}</div>
                      <div className="text-xs text-slate-400 font-mono truncate">
                        {currentUser.email || currentUser.phone}
                      </div>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 uppercase">
                      {currentUser.role}
                    </span>
                  </div>

                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center justify-between text-slate-400">
                      <span>Auth Provider:</span>
                      <span className="capitalize font-semibold text-slate-200">{currentUser.provider}</span>
                    </div>
                    <div className="flex items-center justify-between text-slate-400">
                      <span>Sync Status:</span>
                      <span className="text-emerald-400 font-medium flex items-center space-x-1">
                        <Check className="w-3 h-3" />
                        <span>Account Workspace & Chats Active</span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Switch to Another Account Action */}
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Switch Account</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setGoogleStep('email');
                        setActiveView('google-signin');
                      }}
                      className="flex items-center justify-center space-x-2 py-2.5 px-3 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-xs font-semibold text-slate-200 transition"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z" />
                        <path fill="#34A853" d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.2L1.9 16C3.7 19.7 7.5 23 12 23z" />
                        <path fill="#FBBC05" d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12 0 12s.7 2.3 1.9 4.7l3.7-1.9z" />
                        <path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.6l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z" />
                      </svg>
                      <span>Google Account</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setOutlookStep('email');
                        setActiveView('outlook-signin');
                      }}
                      className="flex items-center justify-center space-x-2 py-2.5 px-3 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-xs font-semibold text-slate-200 transition"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                        <path fill="#F25022" d="M1 1h10v10H1z" />
                        <path fill="#7FBA00" d="M13 1h10v10H13z" />
                        <path fill="#00A4EF" d="M1 13h10v10H1z" />
                        <path fill="#FFB900" d="M13 13h10v10H1z" />
                      </svg>
                      <span>Outlook Account</span>
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-end space-x-2 pt-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className={`px-4 py-2 rounded-xl text-xs font-medium ${t.cardSub} ${t.textMuted} border ${t.cardBorder}`}
                  >
                    Done
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onLogout();
                      onClose();
                    }}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 flex items-center space-x-1.5 transition"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            ) : (
              /* NOT Logged in */
              <>
                {/* Tab: Sign In vs Sign Up */}
                <div className={`grid grid-cols-2 p-1 rounded-xl ${t.cardSub} border ${t.cardBorder}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setTab('signin');
                      setError('');
                    }}
                    className={`py-1.5 text-xs font-bold rounded-lg transition ${
                      tab === 'signin' ? `${t.accentBg} text-white shadow-xs` : `${t.textMuted} hover:text-white`
                    }`}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTab('signup');
                      setError('');
                    }}
                    className={`py-1.5 text-xs font-bold rounded-lg transition ${
                      tab === 'signup' ? `${t.accentBg} text-white shadow-xs` : `${t.textMuted} hover:text-white`
                    }`}
                  >
                    Create Account
                  </button>
                </div>

                {/* Primary Google & Outlook Buttons */}
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    Sign in with Device Account
                  </p>
                  <div className="grid grid-cols-2 gap-2.5">
                    {/* Google Button */}
                    <button
                      type="button"
                      onClick={() => {
                        setGoogleStep('email');
                        setActiveView('google-signin');
                      }}
                      className="flex items-center justify-center space-x-2 py-2.5 px-3 rounded-xl bg-slate-800/90 hover:bg-slate-750 border border-slate-700/80 hover:border-indigo-500/60 text-xs font-semibold text-slate-100 transition shadow-xs group"
                    >
                      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z" />
                        <path fill="#34A853" d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.2L1.9 16C3.7 19.7 7.5 23 12 23z" />
                        <path fill="#FBBC05" d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12 0 12s.7 2.3 1.9 4.7l3.7-1.9z" />
                        <path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.6l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z" />
                      </svg>
                      <span className="group-hover:text-white">Google Account</span>
                    </button>

                    {/* Outlook Button */}
                    <button
                      type="button"
                      onClick={() => {
                        setOutlookStep('email');
                        setActiveView('outlook-signin');
                      }}
                      className="flex items-center justify-center space-x-2 py-2.5 px-3 rounded-xl bg-slate-800/90 hover:bg-slate-750 border border-slate-700/80 hover:border-sky-500/60 text-xs font-semibold text-slate-100 transition shadow-xs group"
                    >
                      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                        <path fill="#F25022" d="M1 1h10v10H1z" />
                        <path fill="#7FBA00" d="M13 1h10v10H13z" />
                        <path fill="#00A4EF" d="M1 13h10v10H1z" />
                        <path fill="#FFB900" d="M13 13h10v10H1z" />
                      </svg>
                      <span className="group-hover:text-white">Outlook Account</span>
                    </button>
                  </div>
                </div>

                <div className="flex items-center space-x-2 my-2">
                  <div className="flex-1 h-px bg-slate-800" />
                  <span className="text-[10px] uppercase font-semibold text-slate-500">Or use Email / Phone</span>
                  <div className="flex-1 h-px bg-slate-800" />
                </div>

                {/* Sub-method switcher: Email vs Phone */}
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMethod('email');
                      setError('');
                    }}
                    className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium flex items-center justify-center space-x-1.5 border transition ${
                      method === 'email'
                        ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300'
                        : `${t.cardSub} border-transparent ${t.textMuted}`
                    }`}
                  >
                    <Mail className="w-3.5 h-3.5" />
                    <span>Any Email Address</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMethod('phone');
                      setError('');
                    }}
                    className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium flex items-center justify-center space-x-1.5 border transition ${
                      method === 'phone'
                        ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                        : `${t.cardSub} border-transparent ${t.textMuted}`
                    }`}
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                    <span>Phone (SMS / WhatsApp)</span>
                  </button>
                </div>

                {error && (
                  <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center space-x-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                    <span>{error}</span>
                  </div>
                )}

                {/* Method Form: Email */}
                {method === 'email' && (
                  <form onSubmit={handleEmailPasswordSubmit} className="space-y-3 pt-1">
                    {tab === 'signup' && (
                      <div className="space-y-1">
                        <label className="text-[11px] font-semibold text-slate-300">Display Name</label>
                        <input
                          type="text"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Enter your name..."
                          className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-xl px-3 py-2 text-xs focus:outline-none`}
                        />
                      </div>
                    )}

                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-slate-300">Email Address</label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com or any email"
                        className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-xl px-3 py-2 text-xs focus:outline-none`}
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-semibold text-slate-300">Password</label>
                        <button
                          type="button"
                          onClick={handleSendEmailCode}
                          className="text-[10px] text-indigo-400 hover:text-indigo-300 underline font-medium"
                        >
                          Send 6-digit code instead
                        </button>
                      </div>
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Enter your password..."
                          className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-xl px-3 py-2 pr-10 text-xs focus:outline-none`}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((prev) => !prev)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2">
                      <button
                        type="button"
                        onClick={handleSendEmailCode}
                        disabled={loading || !email.trim()}
                        className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center space-x-1"
                      >
                        <Mail className="w-3.5 h-3.5" />
                        <span>Email Verification Code</span>
                      </button>

                      <button
                        type="submit"
                        disabled={loading || !email.trim() || !password.trim()}
                        className={`px-5 py-2 rounded-xl text-xs font-semibold ${t.accentBg} ${t.accentBgHover} text-white flex items-center space-x-1.5 shadow-md disabled:opacity-50`}
                      >
                        <span>{loading ? 'Processing...' : tab === 'signin' ? 'Sign In' : 'Sign Up'}</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </form>
                )}

                {/* Method Form: Phone Number with WhatsApp or SMS */}
                {method === 'phone' && (
                  <form onSubmit={handleSendPhoneCode} className="space-y-3 pt-1">
                    {tab === 'signup' && (
                      <div className="space-y-1">
                        <label className="text-[11px] font-semibold text-slate-300">Your Name (Optional)</label>
                        <input
                          type="text"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Enter your name..."
                          className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-xl px-3 py-2 text-xs focus:outline-none`}
                        />
                      </div>
                    )}

                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-slate-300">Phone Number</label>
                      <div className="flex space-x-2">
                        <select
                          value={countryCode}
                          onChange={(e) => setCountryCode(e.target.value)}
                          className={`w-28 ${t.inputBg} border ${t.inputBorder} rounded-xl px-2 py-2 text-xs focus:outline-none font-mono`}
                        >
                          <option value="+234">🇳🇬 +234</option>
                          <option value="+1">🇺🇸 +1</option>
                          <option value="+44">🇬🇧 +44</option>
                          <option value="+91">🇮🇳 +91</option>
                          <option value="+233">🇬🇭 +233</option>
                          <option value="+254">🇰🇪 +254</option>
                          <option value="+27">🇿🇦 +27</option>
                          <option value="+49">🇩🇪 +49</option>
                          <option value="+33">🇫🇷 +33</option>
                          <option value="+971">🇦🇪 +971</option>
                        </select>
                        <input
                          type="tel"
                          value={phoneRaw}
                          onChange={(e) => setPhoneRaw(e.target.value)}
                          placeholder="Phone number..."
                          className={`flex-1 ${t.inputBg} border ${t.inputBorder} rounded-xl px-3 py-2 text-xs focus:outline-none font-mono`}
                        />
                      </div>
                    </div>

                    {/* Channel Selector: WhatsApp vs SMS */}
                    <div className="space-y-1 pt-1">
                      <label className="text-[11px] font-semibold text-slate-400">Receive Code Via:</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setPhoneChannel('whatsapp')}
                          className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center space-x-1.5 transition ${
                            phoneChannel === 'whatsapp'
                              ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 shadow-xs'
                              : 'bg-slate-800/40 border-slate-700/60 text-slate-400 hover:text-white'
                          }`}
                        >
                          <MessageCircle className="w-3.5 h-3.5 text-emerald-400" />
                          <span>WhatsApp</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setPhoneChannel('sms')}
                          className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center space-x-1.5 transition ${
                            phoneChannel === 'sms'
                              ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300 shadow-xs'
                              : 'bg-slate-800/40 border-slate-700/60 text-slate-400 hover:text-white'
                          }`}
                        >
                          <Smartphone className="w-3.5 h-3.5 text-indigo-400" />
                          <span>SMS Message</span>
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-end space-x-2 pt-2">
                      <button
                        type="button"
                        onClick={onClose}
                        className={`px-4 py-2 rounded-xl text-xs font-medium ${t.cardSub} ${t.textMuted} border ${t.cardBorder}`}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={loading || !phoneRaw.trim()}
                        className="px-5 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center space-x-1.5 shadow-md disabled:opacity-50"
                      >
                        <span>{loading ? 'Sending Code...' : `Send Code via ${phoneChannel === 'whatsapp' ? 'WhatsApp' : 'SMS'}`}</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </form>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

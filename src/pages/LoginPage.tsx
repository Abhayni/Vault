import { useState, type FormEvent } from 'react';
import {
  Lock,
  Mail,
  ArrowRight,
  KeyRound,
  Wrench,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Sparkles,
  Eye,
  EyeOff,
} from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VaultConfigStatus } from '../types/vault';
import { SetupGuidePanel } from '../components/SetupGuidePanel';
import backdropImg from '../assets/images/login_vault_backdrop_1794588541489.jpg';
import emblemImg from '../assets/images/vault_obsidian_emblem_1794588538953.jpg';

interface LoginPageProps {
  config: VaultConfigStatus | null;
  supabase: SupabaseClient | null;
  isRecoveryMode: boolean;
  onRecheckConfig: () => Promise<void>;
  checkingConfig: boolean;
  onAuthenticated: () => Promise<void>;
  authError: string | null;
}

export function LoginPage({
  config,
  supabase,
  isRecoveryMode,
  onRecheckConfig,
  checkingConfig,
  onAuthenticated,
  authError,
}: LoginPageProps) {
  const [mode, setMode] = useState<'signin' | 'otp' | 'reset'>('signin');
  const [showSetup, setShowSetup] = useState<boolean>(Boolean(config && !config.configured));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const isConfigured = Boolean(config?.configured && supabase);
  const displayError = localError || authError;

  const verifyAndCompleteSignIn = async (accessToken: string) => {
    if (!supabase) return;
    const verifyRes = await fetch('/api/auth/verify', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const verifyBody = (await verifyRes.json().catch(() => ({}))) as { error?: string };

    if (!verifyRes.ok) {
      await supabase.auth.signOut();
      throw new Error(verifyBody.error || 'Account is not authorized for this private vault.');
    }

    await onAuthenticated();
  };

  const handleSignIn = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setStatusMessage(null);

    if (!supabase || !isConfigured) {
      setLocalError('Configure Supabase URL, Anon Key, and OWNER_EMAIL before signing in.');
      setShowSetup(true);
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        if (
          error.message.toLowerCase().includes('invalid login credentials') &&
          config?.ownerAccountReady === false
        ) {
          throw new Error(
            'Your owner user does not exist in Supabase Auth yet. Create it in Supabase Dashboard -> Authentication -> Users (Auto Confirm enabled), then sign in.',
          );
        }
        throw error;
      }

      if (!data.session?.access_token) {
        throw new Error('Authentication succeeded without a valid session token.');
      }

      await verifyAndCompleteSignIn(data.session.access_token);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendOtp = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setStatusMessage(null);

    if (!supabase || !isConfigured) {
      setLocalError('Supabase Auth is not configured yet.');
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: window.location.origin,
          shouldCreateUser: false,
        },
      });
      if (error) throw error;
      setOtpSent(true);
      setStatusMessage(
        'Sign-in link and verification code sent if this address matches your owner account.',
      );
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to send sign-in email.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyOtp = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setStatusMessage(null);
    if (!supabase || !isConfigured) return;

    setSubmitting(true);
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: otpCode.trim(),
        type: 'email',
      });
      if (error) throw error;
      if (!data.session?.access_token) {
        throw new Error('Verification succeeded without a valid session token.');
      }
      await verifyAndCompleteSignIn(data.session.access_token);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Invalid or expired verification code.');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePasswordReset = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setStatusMessage(null);

    if (!supabase || !isConfigured) {
      setLocalError('Supabase Auth is not configured yet.');
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin,
      });
      if (error) throw error;
      setStatusMessage(
        'If that address matches the vault owner, a password reset link has been sent.',
      );
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to send reset email.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdatePassword = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setStatusMessage(null);
    if (!supabase) return;

    if (newPassword.length < 8) {
      setLocalError('Password must be at least 8 characters.');
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setStatusMessage('Password updated. Opening your vault...');
      await onAuthenticated();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to update password.');
    } finally {
      setSubmitting(false);
    }
  };

  const needsSupabaseInit =
    isConfigured && (config?.ownerAccountReady === false || config?.schemaReady === false);

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#090B12] text-slate-900 dark:text-[#F1F3F9] flex flex-col">
      {/* Top minimal bar */}
      <header className="h-16 px-6 lg:px-10 bg-white/80 dark:bg-transparent border-b border-slate-200 dark:border-white/8 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 shrink-0">
          <img
            src={emblemImg}
            alt="MOD VAULT emblem"
            referrerPolicy="no-referrer"
            className="w-8 h-8 rounded-lg object-cover border border-slate-200 dark:border-white/15"
          />
          <span className="font-display text-base font-bold tracking-tight text-slate-950 dark:text-white whitespace-nowrap">
            MOD VAULT
          </span>
        </div>

        <button
          type="button"
          onClick={() => setShowSetup((prev) => !prev)}
          className="vault-glow-ring inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#151925] text-slate-700 dark:text-[#CBD5E1] hover:text-slate-950 dark:hover:text-white hover:border-[#8B5CF6]/50 transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
        >
          <Wrench className="w-3.5 h-3.5" aria-hidden="true" />
          {showSetup ? 'Back to Sign In' : 'Setup Guide'}
        </button>
      </header>

      {showSetup ? (
        <main className="flex-1 p-6 lg:p-10 max-w-5xl w-full mx-auto space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-950 dark:text-white">
                MOD VAULT Setup Guide
              </h1>
              <p className="text-sm text-slate-500 dark:text-[#94A3B8] mt-1">
                Review your Google Drive storage, Supabase connection, and owner login settings.
              </p>
            </div>
          </div>
          <SetupGuidePanel
            config={config}
            onRecheck={onRecheckConfig}
            checking={checkingConfig}
          />
        </main>
      ) : (
        <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 items-stretch">
          {/* Left visual obsidian chamber (dark photo overlay stays dark in both themes) */}
          <div className="hidden lg:flex lg:col-span-7 relative overflow-hidden border-r border-slate-200 dark:border-white/8 bg-[#090B12]">
            <img
              src={backdropImg}
              alt="Obsidian digital vault chamber"
              referrerPolicy="no-referrer"
              className="absolute inset-0 w-full h-full object-cover opacity-75"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#090B12] via-[#090B12]/55 to-[#090B12]/30" />
            <div className="relative z-10 mt-auto p-12 max-w-xl space-y-4">
              <h1 className="font-display text-4xl font-bold text-white leading-tight">
                Your Private Minecraft Mod &amp; File Vault
              </h1>
              <p className="text-sm sm:text-base text-[#CBD5E1] leading-relaxed">
                Keep your mods, modpacks, backups, and personal folders neatly organized in your 5 TB Google Drive — accessible only by you.
              </p>
              <div className="flex items-center gap-2 text-xs text-[#94A3B8] pt-2">
                <span>5 TB Google Drive</span>
                <span aria-hidden="true">·</span>
                <span>Fast Search &amp; Folders</span>
                <span aria-hidden="true">·</span>
                <span>Private Owner Access</span>
              </div>
            </div>
          </div>

          {/* Right authentication panel */}
          <div className="lg:col-span-5 flex items-center justify-center p-6 sm:p-10 lg:p-12">
            <div className="w-full max-w-md space-y-5">
              {!isConfigured && (
                <div className="rounded-xl border border-amber-300 dark:border-amber-500/35 bg-amber-50 dark:bg-amber-500/10 p-4 space-y-2.5">
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="text-xs text-amber-950 dark:text-amber-100 leading-relaxed">
                      <p className="font-semibold">Cloud setup needed</p>
                      <p className="text-amber-800 dark:text-amber-200/85 mt-1">
                        Missing: <span className="font-mono">{config?.missingKeys.join(', ') || 'Environment variables'}</span>.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowSetup(true)}
                    className="w-full py-2 px-3 text-xs font-semibold rounded-lg bg-amber-100 dark:bg-amber-500/20 hover:bg-amber-200 dark:hover:bg-amber-500/30 text-amber-950 dark:text-amber-100 border border-amber-300 dark:border-amber-400/30 transition-colors min-h-[40px]"
                  >
                    Open Setup Guide
                  </button>
                </div>
              )}

              {needsSupabaseInit && (
                <div className="rounded-xl border border-blue-200 dark:border-[#3B82F6]/35 bg-blue-50 dark:bg-[#3B82F6]/10 p-4 space-y-2.5">
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 text-blue-600 dark:text-[#60A5FA] shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="text-xs text-slate-700 dark:text-[#E2E8F0] leading-relaxed space-y-1">
                      <p className="font-semibold text-slate-950 dark:text-white">
                        One-time database step recommended
                      </p>
                      {config?.ownerAccountReady === false && (
                        <p className="text-slate-600 dark:text-[#CBD5E1]">
                          1. Create your owner user (<span className="font-mono">{config.ownerEmailHint}</span>) in{' '}
                          <span className="font-medium text-slate-900 dark:text-white">
                            Supabase Dashboard -&gt; Authentication -&gt; Users
                          </span>.
                        </p>
                      )}
                      {config?.schemaReady === false && (
                        <p className="text-slate-600 dark:text-[#CBD5E1]">
                          {config?.ownerAccountReady === false ? '2.' : '1.'} Run the SQL script in{' '}
                          <span className="font-medium text-slate-900 dark:text-white">Setup Guide</span> inside Supabase SQL Editor.
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowSetup(true)}
                    className="w-full py-2 px-3 text-xs font-semibold rounded-lg bg-blue-100 dark:bg-[#3B82F6]/20 hover:bg-blue-200 dark:hover:bg-[#3B82F6]/30 text-blue-950 dark:text-white border border-blue-300 dark:border-[#3B82F6]/40 transition-colors min-h-[40px]"
                  >
                    View SQL &amp; Setup Steps
                  </button>
                </div>
              )}

              <div className="vault-glass rounded-xl p-6 sm:p-7 space-y-6">
                <div>
                  <h2 className="font-display text-2xl font-bold text-slate-950 dark:text-white">
                    {isRecoveryMode
                      ? 'Set New Password'
                      : mode === 'signin'
                        ? 'Owner Sign In'
                        : mode === 'otp'
                          ? 'Email Sign-In Code'
                          : 'Reset Password'}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-[#94A3B8] mt-1">
                    {isRecoveryMode
                      ? 'Choose a new password for your owner account.'
                      : mode === 'signin'
                        ? 'Private vault locked to the owner account. Public registration is disabled.'
                        : mode === 'otp'
                          ? 'We will email a one-time link and code to your owner address.'
                          : 'We will email a password reset link to your owner address.'}
                  </p>
                </div>

                {displayError && (
                  <div
                    role="alert"
                    className="rounded-lg border border-red-200 dark:border-red-500/35 bg-red-50 dark:bg-red-500/10 px-3.5 py-3 text-xs text-red-800 dark:text-red-200 flex items-start gap-2"
                  >
                    <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{displayError}</span>
                  </div>
                )}

                {statusMessage && (
                  <div className="rounded-lg border border-emerald-200 dark:border-emerald-500/35 bg-emerald-50 dark:bg-emerald-500/10 px-3.5 py-3 text-xs text-emerald-800 dark:text-emerald-200 flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{statusMessage}</span>
                  </div>
                )}

                {isRecoveryMode ? (
                  <form onSubmit={handleUpdatePassword} className="space-y-4">
                    <div>
                      <label htmlFor="new-password" className="block text-xs font-medium text-slate-700 dark:text-[#CBD5E1] mb-1.5">
                        New Password
                      </label>
                      <div className="relative">
                        <KeyRound
                          className="w-4 h-4 text-slate-400 dark:text-[#64748B] absolute left-3.5 top-1/2 -translate-y-1/2"
                          aria-hidden="true"
                        />
                        <input
                          id="new-password"
                          type={showNewPassword ? 'text' : 'password'}
                          required
                          minLength={8}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="Minimum 8 characters"
                          className="vault-glow-ring w-full pl-10 pr-11 py-2.5 text-sm rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-[#64748B]"
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewPassword((p) => !p)}
                          aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-2 text-slate-400 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-white"
                        >
                          {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="vault-glow-ring w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white transition-colors min-h-[44px] disabled:opacity-60"
                    >
                      {submitting && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                      Update Password
                    </button>
                  </form>
                ) : mode === 'signin' ? (
                  <form onSubmit={handleSignIn} className="space-y-4">
                    <div>
                      <label htmlFor="owner-email" className="block text-xs font-medium text-slate-700 dark:text-[#CBD5E1] mb-1.5">
                        Owner Email
                      </label>
                      <div className="relative">
                        <Mail
                          className="w-4 h-4 text-slate-400 dark:text-[#64748B] absolute left-3.5 top-1/2 -translate-y-1/2"
                          aria-hidden="true"
                        />
                        <input
                          id="owner-email"
                          type="email"
                          required
                          autoComplete="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder={config?.ownerEmailHint || 'owner@example.com'}
                          className="vault-glow-ring w-full pl-10 pr-3.5 py-2.5 text-sm rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-[#64748B]"
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label htmlFor="owner-password" className="block text-xs font-medium text-slate-700 dark:text-[#CBD5E1]">
                          Password
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            setMode('reset');
                            setLocalError(null);
                            setStatusMessage(null);
                          }}
                          className="text-xs text-[#7C3AED] dark:text-[#A78BFA] hover:text-slate-950 dark:hover:text-white transition-colors py-0.5"
                        >
                          Forgot password?
                        </button>
                      </div>
                      <div className="relative">
                        <Lock
                          className="w-4 h-4 text-slate-400 dark:text-[#64748B] absolute left-3.5 top-1/2 -translate-y-1/2"
                          aria-hidden="true"
                        />
                        <input
                          id="owner-password"
                          type={showPassword ? 'text' : 'password'}
                          required
                          autoComplete="current-password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Enter your password"
                          className="vault-glow-ring w-full pl-10 pr-11 py-2.5 text-sm rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-[#64748B]"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((p) => !p)}
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-2 text-slate-400 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-white"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={submitting || !isConfigured}
                      className="vault-glow-ring w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white transition-colors min-h-[44px] disabled:opacity-50"
                    >
                      {submitting ? (
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <>
                          Unlock Vault
                          <ArrowRight className="w-4 h-4" aria-hidden="true" />
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setMode('otp');
                        setOtpSent(false);
                        setOtpCode('');
                        setLocalError(null);
                        setStatusMessage(null);
                      }}
                      className="w-full inline-flex items-center justify-center gap-1.5 py-2 text-xs text-slate-600 dark:text-[#CBD5E1] hover:text-slate-950 dark:hover:text-white transition-colors min-h-[40px]"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-[#7C3AED] dark:text-[#A78BFA]" aria-hidden="true" />
                      Sign in with Email Code instead
                    </button>
                  </form>
                ) : mode === 'otp' ? (
                  <div className="space-y-4">
                    <form onSubmit={otpSent ? handleVerifyOtp : handleSendOtp} className="space-y-4">
                      <div>
                        <label htmlFor="otp-email" className="block text-xs font-medium text-slate-700 dark:text-[#CBD5E1] mb-1.5">
                          Owner Email Address
                        </label>
                        <div className="relative">
                          <Mail
                            className="w-4 h-4 text-slate-400 dark:text-[#64748B] absolute left-3.5 top-1/2 -translate-y-1/2"
                            aria-hidden="true"
                          />
                          <input
                            id="otp-email"
                            type="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder={config?.ownerEmailHint || 'owner@example.com'}
                            className="vault-glow-ring w-full pl-10 pr-3.5 py-2.5 text-sm rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-[#64748B]"
                          />
                        </div>
                      </div>

                      {otpSent && (
                        <div>
                          <label htmlFor="otp-code" className="block text-xs font-medium text-slate-700 dark:text-[#CBD5E1] mb-1.5">
                            6-Digit Code (or click the link in your email)
                          </label>
                          <input
                            id="otp-code"
                            type="text"
                            inputMode="numeric"
                            required
                            value={otpCode}
                            onChange={(e) => setOtpCode(e.target.value)}
                            placeholder="123456"
                            className="vault-glow-ring w-full px-3.5 py-2.5 text-sm font-mono tracking-widest rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-[#64748B]"
                          />
                        </div>
                      )}

                      <button
                        type="submit"
                        disabled={submitting || !isConfigured}
                        className="vault-glow-ring w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white transition-colors min-h-[44px] disabled:opacity-50"
                      >
                        {submitting && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                        {otpSent ? 'Verify Code & Unlock Vault' : 'Send Sign-In Link / Code'}
                      </button>
                    </form>

                    {otpSent && (
                      <button
                        type="button"
                        onClick={() => setOtpSent(false)}
                        className="w-full py-2 text-xs text-[#7C3AED] dark:text-[#A78BFA] hover:text-slate-950 dark:hover:text-white transition-colors min-h-[38px]"
                      >
                        Resend email
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setMode('signin');
                        setLocalError(null);
                        setStatusMessage(null);
                      }}
                      className="w-full py-2 text-xs text-slate-500 dark:text-[#94A3B8] hover:text-slate-950 dark:hover:text-white transition-colors min-h-[38px]"
                    >
                      Back to Password Sign In
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handlePasswordReset} className="space-y-4">
                    <div>
                      <label htmlFor="reset-email" className="block text-xs font-medium text-slate-700 dark:text-[#CBD5E1] mb-1.5">
                        Owner Email Address
                      </label>
                      <div className="relative">
                        <Mail
                          className="w-4 h-4 text-slate-400 dark:text-[#64748B] absolute left-3.5 top-1/2 -translate-y-1/2"
                          aria-hidden="true"
                        />
                        <input
                          id="reset-email"
                          type="email"
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder={config?.ownerEmailHint || 'owner@example.com'}
                          className="vault-glow-ring w-full pl-10 pr-3.5 py-2.5 text-sm rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-[#64748B]"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={submitting || !isConfigured}
                      className="vault-glow-ring w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white transition-colors min-h-[44px] disabled:opacity-50"
                    >
                      {submitting && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                      Send Reset Link
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setMode('signin');
                        setLocalError(null);
                        setStatusMessage(null);
                      }}
                      className="w-full py-2 text-xs text-slate-500 dark:text-[#94A3B8] hover:text-slate-950 dark:hover:text-white transition-colors min-h-[38px]"
                    >
                      Return to Sign In
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        </main>
      )}
    </div>
  );
}

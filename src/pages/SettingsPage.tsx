import { useState } from 'react';
import {
  ShieldCheck,
  KeyRound,
  LogOut,
  Loader2,
  HardDrive,
  ChevronDown,
  ChevronUp,
  Wrench,
  Download,
  SlidersHorizontal,
  Palette,
  DatabaseBackup,
  ArrowRight,
} from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Category,
  DriveQuotaInfo,
  DriveSessionStatus,
  ModRecord,
  ModVersion,
  VaultConfigStatus,
  VaultFile,
  VaultFolder,
  VaultPage,
  VaultPreferences,
  VaultTheme,
} from '../types/vault';
import { formatBytes, GOOGLE_DRIVE_DEFAULT_QUOTA_BYTES, triggerBlobDownload } from '../lib/format';
import { SetupGuidePanel } from '../components/SetupGuidePanel';

interface SettingsPageProps {
  ownerEmail: string;
  userId: string;
  config: VaultConfigStatus | null;
  supabase: SupabaseClient | null;
  driveConnected: boolean;
  driveNeedsReconnect?: boolean;
  driveConnecting: boolean;
  driveSessionInfo?: DriveSessionStatus | null;
  driveQuota: DriveQuotaInfo | null;
  driveError: string | null;
  preferences: VaultPreferences;
  onUpdatePreferences: (patch: Partial<VaultPreferences>) => void;
  mods: ModRecord[];
  versions: ModVersion[];
  categories: Category[];
  vaultFolders: VaultFolder[];
  vaultFiles: VaultFile[];
  onNavigate: (page: VaultPage) => void;
  onConnectDrive: () => Promise<string | null>;
  onDisconnectDrive: () => Promise<void>;
  onRecheckConfig: () => Promise<void>;
  checkingConfig: boolean;
  onSignOut: () => void;
  onNotify: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}

export function SettingsPage({
  ownerEmail,
  userId,
  config,
  supabase,
  driveConnected,
  driveConnecting,
  driveSessionInfo = null,
  driveQuota,
  preferences,
  onUpdatePreferences,
  mods,
  versions,
  categories,
  vaultFolders,
  vaultFiles,
  onNavigate,
  onConnectDrive,
  onRecheckConfig,
  checkingConfig,
  onSignOut,
  onNotify,
}: SettingsPageProps) {
  const [sendingReset, setSendingReset] = useState(false);
  const needsAttention = Boolean(!config?.configured || config?.schemaReady === false);
  const [showTechSetup, setShowTechSetup] = useState(needsAttention);

  const handleSendPasswordReset = async () => {
    if (!supabase) return;
    setSendingReset(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(ownerEmail, {
        redirectTo: window.location.origin,
      });
      if (error) throw error;
      onNotify(
        'success',
        'Password reset email sent',
        `Check ${ownerEmail} for your recovery link.`,
      );
    } catch (err) {
      onNotify(
        'error',
        'Reset failed',
        err instanceof Error ? err.message : 'Unable to send reset email.',
      );
    } finally {
      setSendingReset(false);
    }
  };

  const handleExportCatalogJson = () => {
    const snapshot = {
      exportedAt: new Date().toISOString(),
      ownerEmail,
      storageProvider: 'google-drive',
      totals: {
        mods: mods.length,
        modVersions: versions.length,
        categories: categories.length,
        vaultFolders: vaultFolders.length,
        vaultFiles: vaultFiles.length,
      },
      categories,
      mods,
      modVersions: versions,
      vaultFolders,
      vaultFiles,
    };

    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: 'application/json',
    });
    const stamp = new Date().toISOString().slice(0, 10);
    triggerBlobDownload(blob, `mod-vault-catalog-${stamp}.json`);
    onNotify(
      'success',
      'Catalog exported',
      `Saved ${mods.length} mods and ${vaultFiles.length} vault files to JSON.`,
    );
  };

  const quotaLimit = driveQuota?.limitBytes || GOOGLE_DRIVE_DEFAULT_QUOTA_BYTES;
  const quotaUsed = driveQuota?.usageBytes || 0;
  const quotaPct = Math.min(100, (quotaUsed / quotaLimit) * 100);
  const connectedAccountEmail = driveSessionInfo?.email || driveQuota?.userEmail || null;

  return (
    <div className="space-y-6">
      {/* Account & Security */}
      <section className="vault-glass rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                Account &amp; Security
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-[#94A3B8]">
              Vault access is strictly locked to your single owner email with Supabase Row Level Security.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handleSendPasswordReset}
              disabled={sendingReset}
              className="vault-glow-ring inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/12 bg-slate-50 dark:bg-[#090B12] text-slate-800 dark:text-white hover:border-[#8B5CF6]/50 transition-colors min-h-[40px] disabled:opacity-60"
            >
              {sendingReset ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              Change Password (Email)
            </button>
            <button
              type="button"
              onClick={onSignOut}
              className="vault-glow-ring inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border border-red-300 dark:border-red-500/35 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/15 transition-colors min-h-[40px]"
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
              Sign Out
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 pt-3 border-t border-slate-200 dark:border-white/8 text-xs">
          <div className="py-1">
            <p className="text-slate-500 dark:text-[#94A3B8]">Owner Email</p>
            <p className="font-mono text-slate-900 dark:text-white mt-1 truncate">{ownerEmail}</p>
          </div>
          <div className="py-1">
            <p className="text-slate-500 dark:text-[#94A3B8]">Owner User ID</p>
            <p className="font-mono text-slate-700 dark:text-[#CBD5E1] mt-1 truncate">{userId}</p>
          </div>
          <div className="py-1">
            <p className="text-slate-500 dark:text-[#94A3B8]">Max Upload Size</p>
            <p className="font-mono text-[#7C3AED] dark:text-[#A78BFA] mt-1 truncate tabular-nums">
              {config?.maxUploadMb || 5120} MB per file
            </p>
          </div>
          <div className="py-1">
            <p className="text-slate-500 dark:text-[#94A3B8]">Privacy &amp; Sharing</p>
            <p className="font-mono text-emerald-700 dark:text-emerald-300 mt-1 truncate">
              Private only · No public links
            </p>
          </div>
        </div>
      </section>

      {/* Appearance & Application Preferences */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="vault-glass rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Palette className="w-5 h-5 text-[#7C3AED] dark:text-[#A78BFA]" aria-hidden="true" />
            <h2 className="text-base font-semibold text-slate-950 dark:text-white">
              Appearance &amp; Defaults
            </h2>
          </div>

          <div className="space-y-4 pt-2 border-t border-slate-200 dark:border-white/8 text-xs">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium text-slate-900 dark:text-white">Interface Theme</p>
                <p className="text-slate-500 dark:text-[#94A3B8] mt-0.5">
                  Switch between Arctic White, Dark Mode, or System
                </p>
              </div>
              <select
                aria-label="Interface theme"
                value={preferences.theme}
                onChange={(e) =>
                  onUpdatePreferences({
                    theme: e.target.value as VaultTheme,
                  })
                }
                className="vault-glow-ring px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white min-h-[38px]"
              >
                <option value="light">Arctic White (Light)</option>
                <option value="dark">Dark Mode</option>
                <option value="system">Follow System</option>
              </select>
            </div>

            <label className="flex items-center justify-between gap-4 cursor-pointer">
              <div>
                <p className="font-medium text-slate-900 dark:text-white">Collapse Desktop Sidebar</p>
                <p className="text-slate-500 dark:text-[#94A3B8] mt-0.5">
                  Show a compact icon rail on desktop screens
                </p>
              </div>
              <input
                type="checkbox"
                checked={preferences.sidebarCollapsed}
                onChange={(e) => onUpdatePreferences({ sidebarCollapsed: e.target.checked })}
                className="rounded border-slate-300 dark:border-white/20 bg-white dark:bg-[#090B12] text-[#8B5CF6] w-4 h-4"
              />
            </label>

            <label className="flex items-center justify-between gap-4 cursor-pointer">
              <div>
                <p className="font-medium text-slate-900 dark:text-white">
                  Compact Interface Spacing
                </p>
                <p className="text-slate-500 dark:text-[#94A3B8] mt-0.5">
                  Tighter padding for dense file browsing
                </p>
              </div>
              <input
                type="checkbox"
                checked={preferences.compactDensity}
                onChange={(e) => onUpdatePreferences({ compactDensity: e.target.checked })}
                className="rounded border-slate-300 dark:border-white/20 bg-white dark:bg-[#090B12] text-[#8B5CF6] w-4 h-4"
              />
            </label>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium text-slate-900 dark:text-white">
                  Default File Manager View
                </p>
                <p className="text-slate-500 dark:text-[#94A3B8] mt-0.5">
                  Initial layout when opening File Manager
                </p>
              </div>
              <select
                aria-label="Default File Manager view"
                value={preferences.defaultFileView}
                onChange={(e) =>
                  onUpdatePreferences({
                    defaultFileView: e.target.value as 'list' | 'grid',
                  })
                }
                className="vault-glow-ring px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white min-h-[38px]"
              >
                <option value="list">List View</option>
                <option value="grid">Grid View</option>
              </select>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium text-slate-900 dark:text-white">Default My Mods View</p>
                <p className="text-slate-500 dark:text-[#94A3B8] mt-0.5">
                  Initial layout when opening My Mods
                </p>
              </div>
              <select
                aria-label="Default My Mods view"
                value={preferences.defaultModView}
                onChange={(e) =>
                  onUpdatePreferences({
                    defaultModView: e.target.value as 'table' | 'grid',
                  })
                }
                className="vault-glow-ring px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white min-h-[38px]"
              >
                <option value="table">Table View</option>
                <option value="grid">Card Grid</option>
              </select>
            </div>
          </div>
        </section>

        <section className="vault-glass rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-5 h-5 text-[#0891B2] dark:text-[#06B6D4]" aria-hidden="true" />
            <h2 className="text-base font-semibold text-slate-950 dark:text-white">
              Application Preferences
            </h2>
          </div>

          <div className="space-y-4 pt-2 border-t border-slate-200 dark:border-white/8 text-xs">
            <label className="flex items-center justify-between gap-4 cursor-pointer">
              <div>
                <p className="font-medium text-slate-900 dark:text-white">
                  Confirm Before Moving to Trash
                </p>
                <p className="text-slate-500 dark:text-[#94A3B8] mt-0.5">
                  Show a confirmation dialog before trashing individual files or folders
                </p>
              </div>
              <input
                type="checkbox"
                checked={preferences.confirmBeforeTrash}
                onChange={(e) => onUpdatePreferences({ confirmBeforeTrash: e.target.checked })}
                className="rounded border-slate-300 dark:border-white/20 bg-white dark:bg-[#090B12] text-[#8B5CF6] w-4 h-4"
              />
            </label>

            <label className="flex items-center justify-between gap-4 cursor-pointer">
              <div>
                <p className="font-medium text-slate-900 dark:text-white">
                  Auto-Unzip .zip Uploads by Default
                </p>
                <p className="text-slate-500 dark:text-[#94A3B8] mt-0.5">
                  Extract .zip archives into folders automatically when queued
                </p>
              </div>
              <input
                type="checkbox"
                checked={preferences.autoUnzipOnUpload}
                onChange={(e) => onUpdatePreferences({ autoUnzipOnUpload: e.target.checked })}
                className="rounded border-slate-300 dark:border-white/20 bg-white dark:bg-[#090B12] text-[#8B5CF6] w-4 h-4"
              />
            </label>
          </div>
        </section>
      </div>

      {/* Storage Summary & Metadata Backup */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="vault-glass rounded-xl p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <HardDrive
                className={`w-5 h-5 ${
                  driveConnected
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-[#0891B2] dark:text-[#06B6D4]'
                }`}
                aria-hidden="true"
              />
              <h2 className="text-base font-semibold text-slate-950 dark:text-white">
                Storage Summary
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('drive')}
              className="inline-flex items-center gap-1 text-xs text-[#0891B2] dark:text-[#06B6D4] hover:text-slate-900 dark:hover:text-white"
            >
              Manage Drive
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-white/8 text-xs">
            <p className="text-slate-700 dark:text-[#CBD5E1]">
              {driveConnected
                ? `Connected to ${connectedAccountEmail || 'Google Drive'}`
                : 'Google Drive not connected in this session.'}
            </p>
            <p className="font-mono tabular-nums text-slate-500 dark:text-[#94A3B8]">
              {driveConnected && driveQuota
                ? `${formatBytes(quotaUsed)} / ${formatBytes(quotaLimit)} (${quotaPct.toFixed(2)}% used)`
                : 'Connect Google Drive to view live 5 TB quota'}
            </p>
            {!driveConnected && (
              <button
                type="button"
                disabled={driveConnecting}
                onClick={() => void onConnectDrive()}
                className="mt-2 inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white min-h-[38px]"
              >
                {driveConnecting ? 'Connecting...' : 'Connect Google Drive'}
              </button>
            )}
          </div>
        </section>

        <section className="vault-glass rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <DatabaseBackup className="w-5 h-5 text-[#7C3AED] dark:text-[#8B5CF6]" aria-hidden="true" />
            <h2 className="text-base font-semibold text-slate-950 dark:text-white">
              Backup &amp; Export
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-[#94A3B8] leading-relaxed">
            Download a clean JSON backup of your MOD VAULT catalog — including all mod versions, categories, folder hierarchy, Google Drive file IDs, and SHA-256 checksums.
          </p>
          <button
            type="button"
            onClick={handleExportCatalogJson}
            className="vault-glow-ring inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-white/12 bg-slate-50 dark:bg-[#090B12] text-slate-800 dark:text-white hover:border-[#8B5CF6]/60 min-h-[40px]"
          >
            <Download className="w-3.5 h-3.5 text-[#0891B2] dark:text-[#06B6D4]" aria-hidden="true" />
            Export Vault Catalog (.json)
          </button>
        </section>
      </div>

      {/* Collapsible Technical Setup & SQL Reference */}
      <section className="space-y-3">
        <button
          type="button"
          onClick={() => setShowTechSetup((prev) => !prev)}
          className="vault-glass vault-glass-hover w-full rounded-xl px-5 py-4 flex items-center justify-between gap-4 text-left min-h-[52px]"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Wrench className="w-4 h-4 text-[#7C3AED] dark:text-[#A78BFA] shrink-0" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-slate-950 dark:text-white">
                Technical Setup &amp; Database SQL
              </p>
              <p className="text-xs text-slate-500 dark:text-[#94A3B8]">
                {config?.schemaReady === false
                  ? 'Optional SQL update available to persist Drive sessions across restarts'
                  : 'Environment health checks, SQL schema, and storage limits'}
              </p>
            </div>
          </div>
          {showTechSetup ? (
            <ChevronUp className="w-4 h-4 text-slate-400 dark:text-[#94A3B8] shrink-0" aria-hidden="true" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400 dark:text-[#94A3B8] shrink-0" aria-hidden="true" />
          )}
        </button>

        {showTechSetup && (
          <SetupGuidePanel
            config={config}
            driveConnected={driveConnected}
            driveQuota={driveQuota}
            onRecheck={onRecheckConfig}
            checking={checkingConfig}
          />
        )}
      </section>
    </div>
  );
}

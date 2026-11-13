import {
  HardDrive,
  CheckCircle2,
  AlertCircle,
  Unlink,
  Folder,
  Lock,
  RefreshCw,
} from 'lucide-react';
import type {
  Category,
  DriveQuotaInfo,
  DriveSessionStatus,
  ModLoader,
  ModRecord,
  ModVersion,
  VaultFile,
  VaultFolder,
} from '../types/vault';
import {
  classifyFileExtension,
  formatBytes,
  getLoaderDotColor,
  GOOGLE_DRIVE_DEFAULT_QUOTA_BYTES,
  type FileTypeBucket,
} from '../lib/format';
import { FREE_TIER_LIMITS } from '../lib/setup-snippets';
import { GoogleSignInButton } from '../components/GoogleSignInButton';

interface GoogleDrivePageProps {
  mods: ModRecord[];
  versions: ModVersion[];
  categories: Category[];
  vaultFolders: VaultFolder[];
  vaultFiles: VaultFile[];
  driveConnected: boolean;
  driveNeedsReconnect: boolean;
  driveConnecting: boolean;
  driveSessionInfo: DriveSessionStatus | null;
  driveQuota: DriveQuotaInfo | null;
  driveError: string | null;
  onConnectDrive: () => Promise<string | null>;
  onDisconnectDrive: () => Promise<void>;
  onOpenMod: (modId: string) => void;
}

const BUCKET_COLORS: Record<FileTypeBucket, string> = {
  'Mods (.jar)': '#8B5CF6',
  Archives: '#06B6D4',
  Images: '#10B981',
  'Docs & Configs': '#F59E0B',
  Other: '#64748B',
};

export function GoogleDrivePage({
  mods,
  versions,
  categories,
  vaultFolders,
  vaultFiles,
  driveConnected,
  driveNeedsReconnect,
  driveConnecting,
  driveSessionInfo,
  driveQuota,
  driveError,
  onConnectDrive,
  onDisconnectDrive,
  onOpenMod,
}: GoogleDrivePageProps) {
  const modBytes = versions.reduce((sum, v) => sum + (Number(v.file_size_bytes) || 0), 0);
  const vaultFileBytes = vaultFiles.reduce(
    (sum, f) => sum + (Number(f.file_size_bytes) || 0),
    0,
  );
  const vaultTotalBytes = modBytes + vaultFileBytes;
  const totalFiles = versions.length + vaultFiles.length;

  const limitBytes = driveQuota?.limitBytes || GOOGLE_DRIVE_DEFAULT_QUOTA_BYTES;
  const effectiveUsageBytes =
    driveConnected && driveQuota ? driveQuota.usageBytes : vaultTotalBytes;
  const remainingBytes = Math.max(0, limitBytes - effectiveUsageBytes);
  const usedPct = Math.min(100, (effectiveUsageBytes / limitBytes) * 100);

  const accountEmail =
    driveSessionInfo?.email || driveQuota?.userEmail || null;
  const accountName =
    driveSessionInfo?.displayName || driveQuota?.userDisplayName || null;

  const driveFoldersList = driveSessionInfo?.folders
    ? [
        { label: 'MOD VAULT (Root)', id: driveSessionInfo.folders.rootId, note: 'Private root container' },
        { label: 'Mods (.jar)', id: driveSessionInfo.folders.modsFolderId, note: 'Minecraft mod releases' },
        { label: 'Vault Files', id: driveSessionInfo.folders.vaultFolderId, note: 'Personal folders & files' },
        { label: 'Thumbnails', id: driveSessionInfo.folders.thumbnailsFolderId, note: 'Private mod artwork' },
      ]
    : [];

  // File Type Distribution across all stored objects
  const bucketTotals = new Map<FileTypeBucket, { count: number; bytes: number }>([
    ['Mods (.jar)', { count: versions.length, bytes: modBytes }],
    ['Archives', { count: 0, bytes: 0 }],
    ['Images', { count: 0, bytes: 0 }],
    ['Docs & Configs', { count: 0, bytes: 0 }],
    ['Other', { count: 0, bytes: 0 }],
  ]);

  for (const f of vaultFiles) {
    const bucket = classifyFileExtension(f.file_extension);
    const prev = bucketTotals.get(bucket)!;
    prev.count += 1;
    prev.bytes += Number(f.file_size_bytes) || 0;
  }

  const fileTypeStats = Array.from(bucketTotals.entries()).map(([bucket, stat]) => ({
    bucket,
    count: stat.count,
    bytes: stat.bytes,
    pct: vaultTotalBytes > 0 ? Math.round((stat.bytes / vaultTotalBytes) * 100) : 0,
    color: BUCKET_COLORS[bucket],
  }));

  const loaders: ModLoader[] = ['Fabric', 'Forge', 'NeoForge', 'Quilt'];
  const loaderStats = loaders.map((loader) => {
    const vers = versions.filter((v) => v.loader === loader);
    const bytes = vers.reduce((s, v) => s + (Number(v.file_size_bytes) || 0), 0);
    return {
      loader,
      versionCount: vers.length,
      bytes,
      pct: modBytes > 0 ? Math.round((bytes / modBytes) * 100) : 0,
      color: getLoaderDotColor(loader),
    };
  });

  const mcMap = new Map<string, { count: number; bytes: number }>();
  for (const v of versions) {
    const prev = mcMap.get(v.mc_version) || { count: 0, bytes: 0 };
    prev.count += 1;
    prev.bytes += Number(v.file_size_bytes) || 0;
    mcMap.set(v.mc_version, prev);
  }
  const mcStats = Array.from(mcMap.entries())
    .map(([mc, stat]) => ({ mc, ...stat }))
    .sort((a, b) => b.bytes - a.bytes);

  const modFootprints = mods
    .map((mod) => {
      const modVers = versions.filter((v) => v.mod_id === mod.id);
      const bytes = modVers.reduce((s, v) => s + (Number(v.file_size_bytes) || 0), 0);
      const cat = categories.find((c) => c.id === mod.category_id);
      return {
        mod,
        versionCount: modVers.length,
        bytes,
        categoryName: cat?.name || 'Uncategorized',
      };
    })
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 10);

  const largestVaultFiles = [...vaultFiles]
    .sort((a, b) => (Number(b.file_size_bytes) || 0) - (Number(a.file_size_bytes) || 0))
    .slice(0, 10);

  return (
    <div className="space-y-6">
      {/* Connection, Account Info & Actions */}
      <section className="vault-glass rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <HardDrive
                className={`w-5 h-5 ${
                  driveConnected && !driveNeedsReconnect
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : driveNeedsReconnect
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-[#0891B2] dark:text-[#06B6D4]'
                }`}
                aria-hidden="true"
              />
              <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                Google Drive (5 TB) Connection
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-[#94A3B8]">
              {driveConnected
                ? driveNeedsReconnect
                  ? 'Session token expires soon — reconnect to maintain uninterrupted uploads and downloads.'
                  : 'Private Drive API v3 session verified. All uploads stay restricted to your Google account with zero public sharing links.'
                : 'Connect your Google Drive account to enable uploads, previews, renames, copies, and Trash recovery.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {driveConnected ? (
              <>
                <button
                  type="button"
                  disabled={driveConnecting}
                  onClick={() => void onConnectDrive()}
                  className="vault-glow-ring inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white min-h-[40px] whitespace-nowrap disabled:opacity-60"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${driveConnecting ? 'animate-spin' : ''}`} aria-hidden="true" />
                  {driveConnecting ? 'Reconnecting...' : 'Reconnect Drive'}
                </button>
                <button
                  type="button"
                  onClick={() => void onDisconnectDrive()}
                  className="vault-glow-ring inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/12 bg-slate-50 dark:bg-[#090B12] text-slate-700 dark:text-[#CBD5E1] hover:text-slate-950 dark:hover:text-white hover:border-red-500/40 min-h-[40px] whitespace-nowrap"
                >
                  <Unlink className="w-3.5 h-3.5" aria-hidden="true" />
                  Disconnect
                </button>
              </>
            ) : (
              <GoogleSignInButton
                onClick={() => void onConnectDrive()}
                disabled={driveConnecting}
                label={driveConnecting ? 'Connecting...' : 'Connect Google Drive'}
              />
            )}
          </div>
        </div>

        {driveError && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 dark:border-red-500/35 bg-red-50 dark:bg-red-500/10 px-4 py-3 text-xs text-red-800 dark:text-red-200 flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{driveError}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t border-slate-200 dark:border-white/8 text-xs">
          <div>
            <p className="text-slate-500 dark:text-[#94A3B8]">Status</p>
            <p
              className={`mt-1 font-medium inline-flex items-center gap-1.5 ${
                driveConnected && !driveNeedsReconnect
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : driveNeedsReconnect
                    ? 'text-amber-700 dark:text-amber-300'
                    : 'text-slate-700 dark:text-[#CBD5E1]'
              }`}
            >
              {driveConnected ? (
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 shrink-0 text-[#0891B2] dark:text-[#06B6D4]" aria-hidden="true" />
              )}
              {driveConnected
                ? driveNeedsReconnect
                  ? 'Reconnect recommended'
                  : 'Connected & verified'
                : 'Disconnected'}
            </p>
          </div>

          <div>
            <p className="text-slate-500 dark:text-[#94A3B8]">Google Account</p>
            <p className="mt-1 font-mono text-slate-900 dark:text-white truncate" title={accountEmail || undefined}>
              {driveConnected ? accountEmail || 'Authorized Drive User' : 'Not signed in'}
            </p>
            {accountName && <p className="text-[11px] text-slate-500 dark:text-[#94A3B8] truncate">{accountName}</p>}
          </div>

          <div>
            <p className="text-slate-500 dark:text-[#94A3B8]">Session Persistence</p>
            <p className="mt-1 font-mono text-[#0891B2] dark:text-[#06B6D4] tabular-nums">
              {driveConnected
                ? `${Math.max(1, Math.round((driveSessionInfo?.expiresInSeconds || 3000) / 60))}m remaining · ${
                    driveSessionInfo?.persisted ? 'Saved on server' : 'Server memory'
                  }`
                : 'None active'}
            </p>
          </div>

          <div>
            <p className="text-slate-500 dark:text-[#94A3B8]">Privacy Policy</p>
            <p className="mt-1 text-slate-700 dark:text-[#CBD5E1] inline-flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-[#7C3AED] dark:text-[#8B5CF6] shrink-0" aria-hidden="true" />
              Owner-only · No public links
            </p>
          </div>
        </div>

        {/* Verified Drive Folder Hierarchy */}
        {driveFoldersList.length > 0 && (
          <div className="pt-4 border-t border-slate-200 dark:border-white/8 space-y-2.5">
            <p className="text-xs font-semibold text-slate-700 dark:text-[#CBD5E1]">
              Verified Private Drive Folders
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {driveFoldersList.map((folder) => (
                <div
                  key={folder.id}
                  className="rounded-lg border border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-[#090B12] px-3.5 py-2.5 space-y-1"
                >
                  <div className="flex items-center gap-2 text-xs font-medium text-slate-900 dark:text-white">
                    <Folder className="w-3.5 h-3.5 text-[#0891B2] dark:text-[#06B6D4] shrink-0" aria-hidden="true" />
                    <span className="truncate">{folder.label}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-[#94A3B8] truncate">{folder.note}</p>
                  <p className="text-[10px] font-mono text-slate-400 dark:text-[#64748B] truncate" title={folder.id}>
                    ID: {folder.id}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Live 5 TB Quota Bar */}
      <section className="vault-glass rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
              Google Drive Space Overview
            </h2>
            <p className="text-xs text-slate-500 dark:text-[#94A3B8] mt-0.5 font-mono tabular-nums">
              {totalFiles} tracked files ({versions.length} mod versions · {vaultFiles.length} general files) across {vaultFolders.length} folders
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono tabular-nums text-2xl font-semibold text-slate-950 dark:text-white">
              {formatBytes(effectiveUsageBytes)}{' '}
              <span className="text-sm font-normal text-slate-500 dark:text-[#94A3B8]">
                / {formatBytes(limitBytes)}
              </span>
            </p>
            <p className="text-xs font-mono tabular-nums text-slate-500 dark:text-[#94A3B8] mt-0.5">
              {formatBytes(remainingBytes)} free on Google Drive
            </p>
          </div>
        </div>

        <div className="h-3 rounded-full bg-slate-100 dark:bg-[#090B12] border border-slate-200 dark:border-white/8 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#8B5CF6] to-[#06B6D4] transition-all duration-300"
            style={{ width: `${Math.max(effectiveUsageBytes > 0 ? 1.5 : 0, usedPct)}%` }}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-[#94A3B8] font-mono tabular-nums">
          <span>
            {usedPct.toFixed(2)}% used · MOD VAULT tracks {formatBytes(vaultTotalBytes)}
          </span>
          {driveConnected && driveQuota && (
            <span>
              In Drive: {formatBytes(driveQuota.usageInDriveBytes)} · In Google Trash: {formatBytes(driveQuota.usageInTrashBytes)}
            </span>
          )}
        </div>
      </section>

      {/* File Type Distribution & Loader Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="vault-glass rounded-xl p-5 space-y-4">
          <h3 className="text-base font-semibold text-slate-950 dark:text-white">Files by Type</h3>
          <div className="space-y-3.5">
            {fileTypeStats.map((item) => (
              <div key={item.bucket} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-900 dark:text-white">{item.bucket}</span>
                  <span className="font-mono tabular-nums text-slate-600 dark:text-[#CBD5E1]">
                    {formatBytes(item.bytes)} · {item.count} ({item.pct}%)
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-200 dark:bg-white/8 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${item.pct}%`, backgroundColor: item.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="vault-glass rounded-xl p-5 space-y-4">
          <h3 className="text-base font-semibold text-slate-950 dark:text-white">Mods by Loader</h3>
          <div className="space-y-3.5">
            {loaderStats.map((item) => (
              <div key={item.loader} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-900 dark:text-white">{item.loader}</span>
                  <span className="font-mono tabular-nums text-slate-600 dark:text-[#CBD5E1]">
                    {formatBytes(item.bytes)} · {item.versionCount} ({item.pct}%)
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-200 dark:bg-white/8 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${item.pct}%`, backgroundColor: item.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="vault-glass rounded-xl p-5 space-y-4">
          <h3 className="text-base font-semibold text-slate-950 dark:text-white">
            Mods by Minecraft Version
          </h3>
          {mcStats.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-[#94A3B8] py-6 text-center">
              Upload mods to view per-version usage.
            </p>
          ) : (
            <div className="space-y-3">
              {mcStats.map((row) => {
                const pct = modBytes > 0 ? Math.round((row.bytes / modBytes) * 100) : 0;
                return (
                  <div key={row.mc} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono text-slate-900 dark:text-white">Minecraft {row.mc}</span>
                      <span className="font-mono tabular-nums text-slate-600 dark:text-[#CBD5E1]">
                        {formatBytes(row.bytes)} · {row.count} ({pct}%)
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-200 dark:bg-white/8 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#06B6D4]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Largest Mods & Largest Vault Files */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="vault-glass rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-white/8">
            <h3 className="text-base font-semibold text-slate-950 dark:text-white">Largest Mods</h3>
          </div>
          {modFootprints.length === 0 ? (
            <p className="p-8 text-center text-xs text-slate-500 dark:text-[#94A3B8]">
              No mods saved yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-white/8 text-slate-500 dark:text-[#94A3B8] bg-slate-50 dark:bg-[#090B12]/60">
                    <th className="py-3 pl-5 pr-4 font-semibold">Mod</th>
                    <th className="py-3 px-4 font-semibold">Category</th>
                    <th className="py-3 px-4 text-right font-semibold">Versions</th>
                    <th className="py-3 pl-4 pr-5 text-right font-semibold">Total Size</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-white/6">
                  {modFootprints.map((item) => (
                    <tr key={item.mod.id} className="hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                      <td className="py-3 pl-5 pr-4">
                        <button
                          type="button"
                          onClick={() => onOpenMod(item.mod.id)}
                          className="font-medium text-slate-900 dark:text-white hover:text-[#7C3AED] dark:hover:text-[#A78BFA] transition-colors py-1 text-left"
                        >
                          {item.mod.name}
                        </button>
                      </td>
                      <td className="py-3 px-4 text-slate-500 dark:text-[#94A3B8]">{item.categoryName}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700 dark:text-[#E2E8F0]">
                        {item.versionCount}
                      </td>
                      <td className="py-3 pl-4 pr-5 text-right font-mono tabular-nums text-slate-900 dark:text-white">
                        {formatBytes(item.bytes)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="vault-glass rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-white/8">
            <h3 className="text-base font-semibold text-slate-950 dark:text-white">Largest Files</h3>
          </div>
          {largestVaultFiles.length === 0 ? (
            <p className="p-8 text-center text-xs text-slate-500 dark:text-[#94A3B8]">
              No general files saved yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-white/8 text-slate-500 dark:text-[#94A3B8] bg-slate-50 dark:bg-[#090B12]/60">
                    <th className="py-3 pl-5 pr-4 font-semibold">File Name</th>
                    <th className="py-3 px-4 font-semibold">Type</th>
                    <th className="py-3 pl-4 pr-5 text-right font-semibold">Size</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-white/6">
                  {largestVaultFiles.map((file) => (
                    <tr key={file.id} className="hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                      <td className="py-3 pl-5 pr-4 font-medium text-slate-900 dark:text-white truncate max-w-[220px]">
                        {file.name}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-500 dark:text-[#94A3B8]">
                        {file.file_extension || 'file'}
                      </td>
                      <td className="py-3 pl-4 pr-5 text-right font-mono tabular-nums text-slate-900 dark:text-white">
                        {formatBytes(file.file_size_bytes)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* Infrastructure Limits */}
      <section className="vault-glass rounded-xl p-5 space-y-3">
        <h3 className="text-base font-semibold text-slate-950 dark:text-white">
          Account &amp; Storage Limits
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-white/8 text-slate-500 dark:text-[#94A3B8]">
                <th className="py-2.5 pr-4 font-semibold">Service</th>
                <th className="py-2.5 pr-4 font-semibold">Allowance</th>
                <th className="py-2.5 pr-4 font-semibold">Limitations</th>
                <th className="py-2.5 font-semibold">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-white/6 text-slate-700 dark:text-[#CBD5E1]">
              {FREE_TIER_LIMITS.map((row) => (
                <tr key={row.service}>
                  <td className="py-3 pr-4 font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                    {row.service}
                  </td>
                  <td className="py-3 pr-4">{row.allowance}</td>
                  <td className="py-3 pr-4 text-slate-500 dark:text-[#94A3B8]">{row.limitations}</td>
                  <td className="py-3 font-mono text-[11px]">{row.charges}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

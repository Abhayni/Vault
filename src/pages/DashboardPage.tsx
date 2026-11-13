import {
  Download,
  Upload,
  ArrowRight,
  Package,
  FolderOpen,
  HardDrive,
  Star,
  FolderKanban,
  Compass,
} from 'lucide-react';
import type {
  Category,
  DriveQuotaInfo,
  ModRecord,
  ModVersion,
  VaultFile,
  VaultFolder,
  VaultPage,
} from '../types/vault';
import {
  classifyFileExtension,
  formatBytes,
  formatDate,
  GOOGLE_DRIVE_DEFAULT_QUOTA_BYTES,
  type FileTypeBucket,
} from '../lib/format';
import { VaultArtwork } from '../components/VaultArtwork';

interface DashboardPageProps {
  mods: ModRecord[];
  versions: ModVersion[];
  categories: Category[];
  vaultFolders: VaultFolder[];
  vaultFiles: VaultFile[];
  thumbnailUrls: Record<string, string>;
  driveQuota: DriveQuotaInfo | null;
  driveConnected: boolean;
  favoritesCount: number;
  loading: boolean;
  onNavigate: (page: VaultPage) => void;
  onOpenMod: (modId: string) => void;
  onPreviewVaultFile?: (file: VaultFile) => void;
  onDownloadVersion: (version: ModVersion) => Promise<void>;
  onDownloadVaultFile: (file: VaultFile) => Promise<void>;
}

const BUCKET_COLORS: Record<FileTypeBucket, string> = {
  'Mods (.jar)': '#8B5CF6',
  Archives: '#06B6D4',
  Images: '#10B981',
  'Docs & Configs': '#F59E0B',
  Other: '#64748B',
};

export function DashboardPage({
  mods,
  versions,
  vaultFolders,
  vaultFiles,
  thumbnailUrls,
  driveQuota,
  driveConnected,
  favoritesCount,
  loading,
  onNavigate,
  onOpenMod,
  onPreviewVaultFile,
  onDownloadVersion,
  onDownloadVaultFile,
}: DashboardPageProps) {
  const modBytes = versions.reduce((acc, v) => acc + (Number(v.file_size_bytes) || 0), 0);
  const vaultBytes = vaultFiles.reduce((acc, f) => acc + (Number(f.file_size_bytes) || 0), 0);
  const totalBytes = modBytes + vaultBytes;
  const totalFiles = versions.length + vaultFiles.length;

  const quotaLimitBytes = driveQuota?.limitBytes || GOOGLE_DRIVE_DEFAULT_QUOTA_BYTES;
  const quotaUsedBytes = driveConnected && driveQuota ? driveQuota.usageBytes : totalBytes;
  const storagePercent = Math.min(100, (quotaUsedBytes / quotaLimitBytes) * 100);

  const modById = new Map(mods.map((m) => [m.id, m]));

  const recentActivity = [
    ...versions.map((v) => ({
      kind: 'mod' as const,
      id: v.id,
      createdAt: v.created_at,
      sizeBytes: Number(v.file_size_bytes) || 0,
      version: v,
      parentMod: modById.get(v.mod_id) || null,
    })),
    ...vaultFiles.map((f) => ({
      kind: 'file' as const,
      id: f.id,
      createdAt: f.created_at,
      sizeBytes: Number(f.file_size_bytes) || 0,
      file: f,
    })),
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 8);

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

  const distribution = Array.from(bucketTotals.entries()).map(([bucket, stat]) => ({
    bucket,
    count: stat.count,
    bytes: stat.bytes,
    pct: totalBytes > 0 ? Math.round((stat.bytes / totalBytes) * 100) : 0,
    color: BUCKET_COLORS[bucket],
  }));

  return (
    <div className="space-y-6">
      {/* KPI Metrics Row */}
      <section
        className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4"
        aria-label="Vault overview metrics"
      >
        <button
          type="button"
          onClick={() => onNavigate('drive')}
          className="vault-glass vault-glass-hover rounded-xl p-5 text-left"
        >
          <p className="text-xs font-medium text-slate-500 dark:text-[#94A3B8]">
            {driveConnected ? 'Google Drive Used' : 'Vault Storage Size'}
          </p>
          {loading ? (
            <div className="h-8 w-28 mt-2 rounded bg-slate-200 dark:bg-white/8" />
          ) : (
            <p className="font-mono tabular-nums text-3xl font-semibold text-slate-950 dark:text-white mt-2">
              {formatBytes(quotaUsedBytes)}
            </p>
          )}
          <div className="mt-3 space-y-1.5">
            <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-[#090B12] overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#8B5CF6] to-[#06B6D4] transition-all duration-300"
                style={{ width: `${Math.max(quotaUsedBytes > 0 ? 2 : 0, storagePercent)}%` }}
              />
            </div>
            <p className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-[#94A3B8]">
              {storagePercent.toFixed(2)}% of {formatBytes(quotaLimitBytes)}
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('mods')}
          className="vault-glass vault-glass-hover rounded-xl p-5 text-left"
        >
          <p className="text-xs font-medium text-slate-500 dark:text-[#94A3B8]">Total Mods</p>
          {loading ? (
            <div className="h-8 w-20 mt-2 rounded bg-slate-200 dark:bg-white/8" />
          ) : (
            <p className="font-mono tabular-nums text-3xl font-semibold text-slate-950 dark:text-white mt-2">
              {mods.length}
            </p>
          )}
          <p className="text-xs font-mono tabular-nums text-slate-500 dark:text-[#94A3B8] mt-2">
            {versions.length} saved .jar releases
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('files')}
          className="vault-glass vault-glass-hover rounded-xl p-5 text-left"
        >
          <p className="text-xs font-medium text-slate-500 dark:text-[#94A3B8]">Total Files</p>
          {loading ? (
            <div className="h-8 w-20 mt-2 rounded bg-slate-200 dark:bg-white/8" />
          ) : (
            <p className="font-mono tabular-nums text-3xl font-semibold text-slate-950 dark:text-white mt-2">
              {totalFiles}
            </p>
          )}
          <p className="text-xs font-mono tabular-nums text-slate-500 dark:text-[#94A3B8] mt-2">
            {vaultFiles.length} vault files · {formatBytes(totalBytes)}
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('files')}
          className="vault-glass vault-glass-hover rounded-xl p-5 text-left"
        >
          <p className="text-xs font-medium text-slate-500 dark:text-[#94A3B8]">Folders &amp; Starred</p>
          {loading ? (
            <div className="h-8 w-16 mt-2 rounded bg-slate-200 dark:bg-white/8" />
          ) : (
            <p className="font-mono tabular-nums text-3xl font-semibold text-slate-950 dark:text-white mt-2">
              {vaultFolders.length}
            </p>
          )}
          <span className="text-xs text-[#0891B2] dark:text-[#06B6D4] mt-2 inline-flex items-center gap-1 tabular-nums">
            {favoritesCount} favorite{favoritesCount === 1 ? '' : 's'} pinned
            <ArrowRight className="w-3 h-3" aria-hidden="true" />
          </span>
        </button>
      </section>

      {/* Main Content Split: Recent Uploads / Activity + Quick Actions & Storage Breakdown */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <section className="xl:col-span-8 vault-glass rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-white/8 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-950 dark:text-white">
                Recent Uploads &amp; Activity
              </h2>
              <p className="text-xs text-slate-500 dark:text-[#94A3B8] mt-0.5">
                Click a mod to open its versions, or click any file for an instant private preview
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('recent')}
              className="px-3 py-1.5 text-xs font-medium text-[#0891B2] dark:text-[#06B6D4] hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 min-h-[36px]"
            >
              View All Recent
            </button>
          </div>

          {loading ? (
            <div className="p-5 space-y-3">
              {[1, 2, 3, 4].map((row) => (
                <div key={row} className="h-11 rounded-lg bg-slate-100 dark:bg-white/5" />
              ))}
            </div>
          ) : recentActivity.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <div className="w-12 h-12 rounded-xl bg-[#8B5CF6]/12 dark:bg-[#8B5CF6]/15 border border-[#8B5CF6]/30 mx-auto flex items-center justify-center">
                <Package className="w-6 h-6 text-[#7C3AED] dark:text-[#A78BFA]" aria-hidden="true" />
              </div>
              <h3 className="text-base font-semibold text-slate-950 dark:text-white">
                Your vault is ready
              </h3>
              <p className="text-xs text-slate-500 dark:text-[#94A3B8] max-w-sm mx-auto leading-relaxed">
                Open Upload Center to add Minecraft .jar mods, archives, folders, or documents straight into your 5 TB Google Drive.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => onNavigate('upload')}
                  className="vault-glow-ring inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white transition-colors min-h-[40px]"
                >
                  <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                  Open Upload Center
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('files')}
                  className="vault-glow-ring inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/12 bg-white dark:bg-[#090B12] text-slate-800 dark:text-white hover:border-[#06B6D4]/60 transition-colors min-h-[40px]"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-[#0891B2] dark:text-[#06B6D4]" aria-hidden="true" />
                  Browse File Manager
                </button>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-white/6">
              {recentActivity.map((item) => {
                if (item.kind === 'mod') {
                  const thumbKey =
                    item.parentMod?.thumbnail_drive_id || item.parentMod?.thumbnail_key;
                  const thumbUrl = thumbKey ? thumbnailUrls[thumbKey] : null;
                  return (
                    <div
                      key={`mod-${item.id}`}
                      className="px-5 py-3 flex items-center justify-between gap-4 hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors"
                    >
                      <button
                        type="button"
                        onClick={() => item.parentMod && onOpenMod(item.parentMod.id)}
                        className="flex items-center gap-3.5 min-w-0 text-left flex-1 min-h-[40px]"
                      >
                        <VaultArtwork
                          src={thumbUrl}
                          alt={item.parentMod?.name || item.version.file_name}
                          size="sm"
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                            {item.parentMod?.name || item.version.file_name}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-[#94A3B8] truncate">
                            <span>{item.version.loader}</span>
                            <span className="mx-1.5" aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">MC {item.version.mc_version}</span>
                            <span className="mx-1.5" aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">v{item.version.version_number}</span>
                          </p>
                        </div>
                      </button>

                      <div className="hidden sm:block text-right shrink-0">
                        <p className="text-xs font-mono tabular-nums text-slate-700 dark:text-[#E2E8F0]">
                          {formatBytes(item.sizeBytes)}
                        </p>
                        <p className="text-[11px] text-slate-400 dark:text-[#64748B]">
                          {formatDate(item.createdAt)}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => onDownloadVersion(item.version)}
                        aria-label={`Download ${item.version.file_name}`}
                        className="vault-glow-ring inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#090B12] text-slate-800 dark:text-white hover:border-[#06B6D4]/60 transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
                      >
                        <Download className="w-3.5 h-3.5 text-[#0891B2] dark:text-[#06B6D4]" aria-hidden="true" />
                        <span className="hidden sm:inline">Download</span>
                      </button>
                    </div>
                  );
                }

                return (
                  <div
                    key={`file-${item.id}`}
                    className="px-5 py-3 flex items-center justify-between gap-4 hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        onPreviewVaultFile ? onPreviewVaultFile(item.file) : onNavigate('files')
                      }
                      className="flex items-center gap-3.5 min-w-0 text-left flex-1 min-h-[40px]"
                    >
                      <div className="w-10 h-10 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-[#090B12] flex items-center justify-center shrink-0">
                        <FolderOpen className="w-4 h-4 text-[#0891B2] dark:text-[#06B6D4]" aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                          {item.file.name}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-[#94A3B8] truncate">
                          <span>File</span>
                          <span className="mx-1.5" aria-hidden="true">·</span>
                          <span className="font-mono">{item.file.file_extension || 'file'}</span>
                        </p>
                      </div>
                    </button>

                    <div className="hidden sm:block text-right shrink-0">
                      <p className="text-xs font-mono tabular-nums text-slate-700 dark:text-[#E2E8F0]">
                        {formatBytes(item.sizeBytes)}
                      </p>
                      <p className="text-[11px] text-slate-400 dark:text-[#64748B]">
                        {formatDate(item.createdAt)}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => onDownloadVaultFile(item.file)}
                      aria-label={`Download ${item.file.name}`}
                      className="vault-glow-ring inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#090B12] text-slate-800 dark:text-white hover:border-[#06B6D4]/60 transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
                    >
                      <Download className="w-3.5 h-3.5 text-[#0891B2] dark:text-[#06B6D4]" aria-hidden="true" />
                      <span className="hidden sm:inline">Download</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Right column: Quick Actions & File Type Breakdown */}
        <aside className="xl:col-span-4 space-y-4">
          <div className="vault-glass rounded-xl p-5 space-y-3">
            <h2 className="text-base font-semibold text-slate-950 dark:text-white">Quick Actions</h2>
            <div className="space-y-2.5 pt-1">
              <button
                type="button"
                onClick={() => onNavigate('upload')}
                className="vault-glow-ring w-full flex items-center justify-between gap-3 px-4 py-3 text-left rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white transition-colors min-h-[44px]"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Upload className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold">Upload Files or Mods</p>
                    <p className="text-[11px] text-white/80 truncate">
                      Multi-file queue, folders, .jar &amp; archives
                    </p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 shrink-0" aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={() => onNavigate('files')}
                className="vault-glow-ring w-full flex items-center justify-between gap-3 px-4 py-3 text-left rounded-lg border border-slate-200 dark:border-white/12 bg-slate-50 dark:bg-[#090B12] text-slate-900 dark:text-white hover:border-[#06B6D4]/60 transition-colors min-h-[44px]"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <FolderOpen className="w-4 h-4 text-[#0891B2] dark:text-[#06B6D4] shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold">Open File Manager</p>
                    <p className="text-[11px] text-slate-500 dark:text-[#94A3B8] truncate">
                      Explore folders, preview, copy &amp; move
                    </p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-400 dark:text-[#94A3B8] shrink-0" aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={() => onNavigate('modrinth')}
                className="vault-glow-ring w-full flex items-center justify-between gap-3 px-4 py-3 text-left rounded-lg border border-emerald-200 dark:border-emerald-500/25 bg-emerald-50/70 dark:bg-emerald-500/8 text-emerald-950 dark:text-emerald-100 hover:border-emerald-400 dark:hover:border-emerald-400/50 transition-colors min-h-[44px]"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Compass className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold">Discover on Modrinth</p>
                    <p className="text-[11px] text-emerald-700/80 dark:text-emerald-300/80 truncate">
                      Public catalog · Import manually to vault
                    </p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
              </button>

              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => onNavigate('favorites')}
                  className="vault-glow-ring flex items-center justify-center gap-1.5 px-2.5 py-2.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#090B12] text-slate-700 dark:text-[#CBD5E1] hover:text-slate-950 dark:hover:text-white hover:border-amber-400/50 transition-colors min-h-[42px]"
                >
                  <Star className="w-3.5 h-3.5 text-amber-500 dark:text-amber-300 shrink-0" aria-hidden="true" />
                  <span className="truncate">Favorites</span>
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('categories')}
                  className="vault-glow-ring flex items-center justify-center gap-1.5 px-2.5 py-2.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#090B12] text-slate-700 dark:text-[#CBD5E1] hover:text-slate-950 dark:hover:text-white hover:border-[#8B5CF6]/50 transition-colors min-h-[42px]"
                >
                  <FolderKanban className="w-3.5 h-3.5 text-[#7C3AED] dark:text-[#A78BFA] shrink-0" aria-hidden="true" />
                  <span className="truncate">Categories</span>
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('drive')}
                  className="vault-glow-ring flex items-center justify-center gap-1.5 px-2.5 py-2.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#090B12] text-slate-700 dark:text-[#CBD5E1] hover:text-slate-950 dark:hover:text-white hover:border-[#06B6D4]/50 transition-colors min-h-[42px]"
                >
                  <HardDrive className="w-3.5 h-3.5 text-[#0891B2] dark:text-[#06B6D4] shrink-0" aria-hidden="true" />
                  <span className="truncate">Drive</span>
                </button>
              </div>
            </div>
          </div>

          <div className="vault-glass rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-950 dark:text-white">
                Storage Breakdown
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('drive')}
                className="text-xs text-[#0891B2] dark:text-[#06B6D4] hover:text-slate-900 dark:hover:text-white transition-colors py-1"
              >
                Drive Quota
              </button>
            </div>

            <div className="space-y-3">
              {distribution.map((item) => (
                <div key={item.bucket} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-700 dark:text-[#CBD5E1] font-medium">
                      {item.bucket}
                    </span>
                    <span className="font-mono tabular-nums text-slate-500 dark:text-[#94A3B8]">
                      {item.count} · {formatBytes(item.bytes)} ({item.pct}%)
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-200 dark:bg-[#090B12] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${item.pct}%`,
                        backgroundColor: item.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

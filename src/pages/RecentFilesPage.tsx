import { useMemo, useState } from 'react';
import {
  Clock,
  Search,
  X,
  Package,
  FolderOpen,
  Download,
  Eye,
  Star,
  ArrowRight,
  FileArchive,
  FileText,
  Image as ImageIcon,
  File as FileIcon,
} from 'lucide-react';
import type { ModRecord, ModVersion, VaultFile, VaultFolder, VaultPage } from '../types/vault';
import { classifyFileExtension, formatBytes, formatDateTime, getPreviewKind } from '../lib/format';

interface RecentFilesPageProps {
  mods: ModRecord[];
  versions: ModVersion[];
  vaultFiles: VaultFile[];
  vaultFolders: VaultFolder[];
  searchQuery: string;
  onSearchChange: (value: string) => void;
  favoriteModIds: Set<string>;
  favoriteFileIds: Set<string>;
  onToggleFavoriteMod: (modId: string) => void;
  onToggleFavoriteFile: (fileId: string) => void;
  onOpenMod: (modId: string) => void;
  onDownloadVersion: (version: ModVersion) => Promise<void>;
  onPreviewVaultFile: (file: VaultFile) => void;
  onDownloadVaultFile: (file: VaultFile) => Promise<void>;
  onNavigate: (page: VaultPage) => void;
}

type TypeFilter = 'all' | 'files' | 'mods';
type WindowFilter = 'all' | '7d' | '30d';

export function RecentFilesPage({
  mods,
  versions,
  vaultFiles,
  vaultFolders,
  searchQuery,
  onSearchChange,
  favoriteModIds,
  favoriteFileIds,
  onToggleFavoriteMod,
  onToggleFavoriteFile,
  onOpenMod,
  onDownloadVersion,
  onPreviewVaultFile,
  onDownloadVaultFile,
  onNavigate,
}: RecentFilesPageProps) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [windowFilter, setWindowFilter] = useState<WindowFilter>('all');

  const modById = useMemo(() => new Map(mods.map((m) => [m.id, m])), [mods]);
  const folderById = useMemo(() => new Map(vaultFolders.map((f) => [f.id, f])), [vaultFolders]);

  const resolveFolderPath = (folderId: string | null) => {
    if (!folderId) return 'Vault Root';
    const names: string[] = [];
    let cursor: string | null = folderId;
    let guard = 0;
    while (cursor && guard < 15) {
      const node = folderById.get(cursor);
      if (!node) break;
      names.unshift(node.name);
      cursor = node.parent_id;
      guard += 1;
    }
    return names.length > 0 ? names.join(' / ') : 'Vault Root';
  };

  const recentEntries = useMemo(() => {
    const now = Date.now();
    const cutoffMs =
      windowFilter === '7d'
        ? now - 7 * 86_400_000
        : windowFilter === '30d'
          ? now - 30 * 86_400_000
          : 0;

    type Entry =
      | {
          id: string;
          kind: 'file';
          name: string;
          context: string;
          sizeBytes: number;
          createdAt: string;
          sha256: string;
          file: VaultFile;
        }
      | {
          id: string;
          kind: 'version';
          name: string;
          context: string;
          sizeBytes: number;
          createdAt: string;
          sha256: string;
          version: ModVersion;
          mod: ModRecord | null;
        };

    const list: Entry[] = [];

    if (typeFilter === 'all' || typeFilter === 'files') {
      for (const file of vaultFiles) {
        list.push({
          id: `file:${file.id}`,
          kind: 'file',
          name: file.name,
          context: resolveFolderPath(file.folder_id),
          sizeBytes: Number(file.file_size_bytes) || 0,
          createdAt: file.created_at,
          sha256: file.sha256 || '',
          file,
        });
      }
    }

    if (typeFilter === 'all' || typeFilter === 'mods') {
      for (const ver of versions) {
        const parentMod = modById.get(ver.mod_id) || null;
        list.push({
          id: `ver:${ver.id}`,
          kind: 'version',
          name: ver.file_name,
          context: `${parentMod?.name || 'Mod'} · v${ver.version_number} · ${ver.loader} · MC ${ver.mc_version}`,
          sizeBytes: Number(ver.file_size_bytes) || 0,
          createdAt: ver.created_at,
          sha256: ver.sha256 || '',
          version: ver,
          mod: parentMod,
        });
      }
    }

    const q = searchQuery.trim().toLowerCase();
    return list
      .filter((item) => {
        if (cutoffMs > 0 && new Date(item.createdAt).getTime() < cutoffMs) {
          return false;
        }
        if (!q) return true;
        return (
          item.name.toLowerCase().includes(q) ||
          item.context.toLowerCase().includes(q) ||
          item.sha256.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [vaultFiles, versions, modById, folderById, typeFilter, windowFilter, searchQuery]);

  const renderFileIcon = (fileName: string) => {
    const bucket = classifyFileExtension(fileName);
    if (bucket === 'Mods (.jar)') {
      return <Package className="w-4 h-4 text-[#7C3AED] dark:text-[#A78BFA]" aria-hidden="true" />;
    }
    if (bucket === 'Archives') {
      return <FileArchive className="w-4 h-4 text-[#0891B2] dark:text-[#06B6D4]" aria-hidden="true" />;
    }
    if (bucket === 'Images') {
      return <ImageIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />;
    }
    if (bucket === 'Docs & Configs') {
      return <FileText className="w-4 h-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />;
    }
    return <FileIcon className="w-4 h-4 text-slate-500 dark:text-[#94A3B8]" aria-hidden="true" />;
  };

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <section className="vault-glass rounded-xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center p-1 rounded-lg bg-slate-100 dark:bg-[#090B12] border border-slate-200 dark:border-white/10">
            {(
              [
                ['all', 'All Items'],
                ['files', 'Vault Files'],
                ['mods', 'Mod Releases'],
              ] as Array<[TypeFilter, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setTypeFilter(value)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  typeFilter === value
                    ? 'bg-white dark:bg-[#8B5CF6] text-slate-950 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-[#94A3B8] hover:text-slate-950 dark:hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <select
            aria-label="Time window filter"
            value={windowFilter}
            onChange={(e) => setWindowFilter(e.target.value as WindowFilter)}
            className="vault-glow-ring px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white min-h-[38px]"
          >
            <option value="all">All Time</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
          </select>
        </div>

        <div className="relative flex-1 max-w-sm">
          <Search
            className="w-4 h-4 text-slate-400 dark:text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Filter recent private uploads..."
            aria-label="Filter recent files"
            className="vault-glow-ring w-full pl-9 pr-8 py-2 text-xs rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-[#64748B] min-h-[38px]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="Clear filter"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-900 dark:hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </section>

      {/* Chronological list */}
      {recentEntries.length === 0 ? (
        <section className="vault-glass rounded-xl p-10 text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 flex items-center justify-center mx-auto">
            <Clock className="w-5 h-5 text-[#0891B2] dark:text-[#06B6D4]" aria-hidden="true" />
          </div>
          <h2 className="text-base font-semibold text-slate-950 dark:text-white">
            No recent private uploads match your filters
          </h2>
          <p className="text-xs text-slate-500 dark:text-[#94A3B8] max-w-md mx-auto">
            Files you upload to File Manager or My Mods appear here in chronological order.
          </p>
          <button
            type="button"
            onClick={() => onNavigate('upload')}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white min-h-[40px]"
          >
            Go to Upload Center
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </section>
      ) : (
        <section className="vault-glass rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-white/8 flex items-center justify-between text-xs text-slate-500 dark:text-[#94A3B8]">
            <span className="font-mono tabular-nums">
              {recentEntries.length} recent item{recentEntries.length === 1 ? '' : 's'}
            </span>
            <span>Sorted newest first</span>
          </div>

          <div className="divide-y divide-slate-200 dark:divide-white/6">
            {recentEntries.map((entry) => {
              const isStarred =
                entry.kind === 'file'
                  ? favoriteFileIds.has(entry.file.id)
                  : Boolean(entry.mod && favoriteModIds.has(entry.mod.id));

              return (
                <div
                  key={entry.id}
                  className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors"
                >
                  <div className="flex items-start sm:items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 flex items-center justify-center shrink-0">
                      {entry.kind === 'version' ? (
                        <Package className="w-4 h-4 text-[#7C3AED] dark:text-[#A78BFA]" aria-hidden="true" />
                      ) : (
                        renderFileIcon(entry.name)
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                        {entry.name}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-[#94A3B8] mt-0.5 truncate">
                        {entry.context} ·{' '}
                        <span className="font-mono tabular-nums">{formatBytes(entry.sizeBytes)}</span> ·{' '}
                        {formatDateTime(entry.createdAt)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {(entry.kind === 'file' || entry.mod) && (
                      <button
                        type="button"
                        onClick={() =>
                          entry.kind === 'file'
                            ? onToggleFavoriteFile(entry.file.id)
                            : entry.mod && onToggleFavoriteMod(entry.mod.id)
                        }
                        aria-label={isStarred ? 'Remove from Favorites' : 'Add to Favorites'}
                        title={isStarred ? 'Remove from Favorites' : 'Add to Favorites'}
                        className="p-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-[#94A3B8] hover:text-amber-500 min-h-[36px] min-w-[36px] flex items-center justify-center"
                      >
                        <Star
                          className={`w-4 h-4 ${isStarred ? 'fill-amber-400 text-amber-400' : ''}`}
                        />
                      </button>
                    )}

                    {entry.kind === 'file' && getPreviewKind(entry.file.name, entry.file.mime_type) && (
                      <button
                        type="button"
                        onClick={() => onPreviewVaultFile(entry.file)}
                        aria-label={`Preview ${entry.name}`}
                        title="Preview"
                        className="p-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-[#CBD5E1] hover:text-slate-950 dark:hover:text-white hover:border-[#06B6D4]/50 min-h-[36px] min-w-[36px] flex items-center justify-center"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() =>
                        entry.kind === 'file'
                          ? void onDownloadVaultFile(entry.file)
                          : void onDownloadVersion(entry.version)
                      }
                      aria-label={`Download ${entry.name}`}
                      title="Download"
                      className="p-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-[#CBD5E1] hover:text-slate-950 dark:hover:text-white hover:border-[#8B5CF6]/50 min-h-[36px] min-w-[36px] flex items-center justify-center"
                    >
                      <Download className="w-4 h-4" />
                    </button>

                    {entry.kind === 'version' && entry.mod ? (
                      <button
                        type="button"
                        onClick={() => onOpenMod(entry.mod!.id)}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 text-slate-700 dark:text-[#CBD5E1] hover:text-slate-950 dark:hover:text-white hover:border-[#8B5CF6]/50 min-h-[36px] whitespace-nowrap"
                      >
                        View Mod
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onNavigate('files')}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 text-slate-700 dark:text-[#CBD5E1] hover:text-slate-950 dark:hover:text-white hover:border-[#06B6D4]/50 min-h-[36px] whitespace-nowrap"
                      >
                        <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
                        Open Files
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

import { useMemo, useState } from 'react';
import {
  Star,
  Download,
  Eye,
  Package,
  FolderOpen,
  Search,
  X,
  ArrowRight,
  FileArchive,
  FileText,
  Image as ImageIcon,
  File as FileIcon,
} from 'lucide-react';
import type { Category, ModRecord, ModVersion, VaultFile, VaultFolder, VaultPage } from '../types/vault';
import { classifyFileExtension, formatBytes, formatDate, getPreviewKind } from '../lib/format';
import { VaultArtwork } from '../components/VaultArtwork';

interface FavoritesPageProps {
  mods: ModRecord[];
  versions: ModVersion[];
  categories: Category[];
  files: VaultFile[];
  folders: VaultFolder[];
  thumbnailUrls: Record<string, string>;
  favoriteModIds: Set<string>;
  favoriteFileIds: Set<string>;
  onToggleFavoriteMod: (modId: string) => void;
  onToggleFavoriteFile: (fileId: string) => void;
  onOpenMod: (modId: string) => void;
  onDownloadVersion: (version: ModVersion) => Promise<void>;
  onPreviewFile: (file: VaultFile) => void;
  onDownloadFile: (file: VaultFile) => Promise<void>;
  onNavigate: (page: VaultPage) => void;
}

export function FavoritesPage({
  mods,
  versions,
  categories,
  files,
  folders,
  thumbnailUrls,
  favoriteModIds,
  favoriteFileIds,
  onToggleFavoriteMod,
  onToggleFavoriteFile,
  onOpenMod,
  onDownloadVersion,
  onPreviewFile,
  onDownloadFile,
  onNavigate,
}: FavoritesPageProps) {
  const [filter, setFilter] = useState<'all' | 'mods' | 'files'>('all');
  const [query, setQuery] = useState('');

  const categoryById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );
  const folderById = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);

  const versionsByMod = useMemo(() => {
    const map = new Map<string, ModVersion[]>();
    for (const v of versions) {
      const list = map.get(v.mod_id) || [];
      list.push(v);
      map.set(v.mod_id, list);
    }
    for (const [, list] of map) {
      list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    return map;
  }, [versions]);

  const getFolderPath = (folderId: string | null) => {
    if (!folderId) return 'Vault Home';
    const parts: string[] = [];
    let cur: string | null = folderId;
    let guard = 0;
    while (cur && guard < 20) {
      const node = folderById.get(cur);
      if (!node) break;
      parts.unshift(node.name);
      cur = node.parent_id;
      guard += 1;
    }
    return parts.join(' / ') || 'Vault Home';
  };

  const q = query.trim().toLowerCase();

  const starredMods = useMemo(
    () =>
      mods.filter((m) => {
        if (!favoriteModIds.has(m.id)) return false;
        if (!q) return true;
        return (
          m.name.toLowerCase().includes(q) ||
          m.loader.toLowerCase().includes(q) ||
          m.latest_mc_version.toLowerCase().includes(q)
        );
      }),
    [mods, favoriteModIds, q],
  );

  const starredFiles = useMemo(
    () =>
      files.filter((f) => {
        if (!favoriteFileIds.has(f.id)) return false;
        if (!q) return true;
        return (
          f.name.toLowerCase().includes(q) ||
          f.file_extension.toLowerCase().includes(q)
        );
      }),
    [files, favoriteFileIds, q],
  );

  const showMods = filter === 'all' || filter === 'mods';
  const showFiles = filter === 'all' || filter === 'files';
  const totalStarred = favoriteModIds.size + favoriteFileIds.size;

  const renderFileIcon = (file: VaultFile) => {
    const bucket = classifyFileExtension(file.file_extension);
    if (bucket === 'Images') {
      return <ImageIcon className="w-4 h-4 text-[#7C3AED] dark:text-[#A78BFA] shrink-0" aria-hidden="true" />;
    }
    if (bucket === 'Archives' || bucket === 'Mods (.jar)') {
      return <FileArchive className="w-4 h-4 text-[#0891B2] dark:text-[#06B6D4] shrink-0" aria-hidden="true" />;
    }
    if (bucket === 'Docs & Configs') {
      return <FileText className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />;
    }
    return <FileIcon className="w-4 h-4 text-slate-500 dark:text-[#94A3B8] shrink-0" aria-hidden="true" />;
  };

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="vault-glass rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#090B12] border border-slate-200 dark:border-white/8 self-start">
          {(
            [
              { id: 'all', label: `All (${totalStarred})` },
              { id: 'mods', label: `Mods (${favoriteModIds.size})` },
              { id: 'files', label: `Files (${favoriteFileIds.size})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap min-h-[36px] tabular-nums ${
                filter === tab.id
                  ? 'bg-[#8B5CF6] text-white'
                  : 'text-slate-600 dark:text-[#94A3B8] hover:text-slate-950 dark:hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full md:w-72">
          <Search
            className="w-4 h-4 text-slate-400 dark:text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter favorites..."
            aria-label="Filter favorites"
            className="vault-glow-ring w-full pl-9 pr-8 py-2 text-xs rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-[#64748B] min-h-[40px]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear filter"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {totalStarred === 0 ? (
        <div className="vault-glass rounded-xl p-12 text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-[#8B5CF6]/12 dark:bg-[#8B5CF6]/15 border border-[#8B5CF6]/30 mx-auto flex items-center justify-center">
            <Star className="w-6 h-6 text-[#7C3AED] dark:text-[#A78BFA]" aria-hidden="true" />
          </div>
          <h2 className="text-base font-semibold text-slate-950 dark:text-white">
            No favorites yet
          </h2>
          <p className="text-xs text-slate-500 dark:text-[#94A3B8] max-w-md mx-auto leading-relaxed">
            Click the star icon on any mod in My Mods or any file in File Manager to pin it here for one-click access.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => onNavigate('mods')}
              className="vault-glow-ring inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white min-h-[40px]"
            >
              <Package className="w-3.5 h-3.5" aria-hidden="true" />
              Browse My Mods
            </button>
            <button
              type="button"
              onClick={() => onNavigate('files')}
              className="vault-glow-ring inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/12 bg-white dark:bg-[#090B12] text-slate-800 dark:text-white hover:border-[#06B6D4]/60 min-h-[40px]"
            >
              <FolderOpen className="w-3.5 h-3.5 text-[#0891B2] dark:text-[#06B6D4]" aria-hidden="true" />
              Browse Files
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Starred Mods */}
          {showMods && starredMods.length > 0 && (
            <section className="vault-glass rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 dark:border-white/8 flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-950 dark:text-white">
                  Starred Mods
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigate('mods')}
                  className="inline-flex items-center gap-1 text-xs text-[#7C3AED] dark:text-[#A78BFA] hover:text-slate-950 dark:hover:text-white py-1"
                >
                  Open My Mods
                  <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
              <div className="divide-y divide-slate-200 dark:divide-white/6">
                {starredMods.map((mod) => {
                  const modVers = versionsByMod.get(mod.id) || [];
                  const latestVer = modVers[0];
                  const totalSize = modVers.reduce(
                    (s, v) => s + (Number(v.file_size_bytes) || 0),
                    0,
                  );
                  const category = mod.category_id ? categoryById.get(mod.category_id) : null;
                  const thumbKey = mod.thumbnail_drive_id || mod.thumbnail_key;
                  const thumbUrl = thumbKey ? thumbnailUrls[thumbKey] : null;

                  return (
                    <div
                      key={mod.id}
                      className="px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors"
                    >
                      <button
                        type="button"
                        onClick={() => onOpenMod(mod.id)}
                        className="flex items-center gap-3.5 text-left min-w-0 flex-1 min-h-[40px]"
                      >
                        <VaultArtwork src={thumbUrl} alt={mod.name} size="sm" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                            {mod.name}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-[#94A3B8] truncate">
                            <span>{mod.loader}</span>
                            <span className="mx-1.5" aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">MC {mod.latest_mc_version}</span>
                            <span className="mx-1.5" aria-hidden="true">·</span>
                            <span>{category ? category.name : 'Uncategorized'}</span>
                            <span className="mx-1.5" aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">{formatBytes(totalSize)}</span>
                          </p>
                        </div>
                      </button>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {latestVer && (
                          <button
                            type="button"
                            onClick={() => void onDownloadVersion(latestVer)}
                            aria-label={`Download ${mod.name}`}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#090B12] text-slate-800 dark:text-white hover:border-[#06B6D4]/60 min-h-[40px]"
                          >
                            <Download className="w-3.5 h-3.5 text-[#0891B2] dark:text-[#06B6D4]" aria-hidden="true" />
                            <span className="hidden sm:inline">Download</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onToggleFavoriteMod(mod.id)}
                          aria-label={`Remove ${mod.name} from favorites`}
                          title="Remove from favorites"
                          className="p-2 rounded-lg border border-amber-300 dark:border-amber-400/30 bg-amber-50 dark:bg-amber-400/10 text-amber-500 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-400/20 min-h-[40px] min-w-[40px] flex items-center justify-center"
                        >
                          <Star className="w-4 h-4 fill-amber-400 dark:fill-amber-300" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Starred Vault Files */}
          {showFiles && starredFiles.length > 0 && (
            <section className="vault-glass rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 dark:border-white/8 flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-950 dark:text-white">
                  Starred Files
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigate('files')}
                  className="inline-flex items-center gap-1 text-xs text-[#0891B2] dark:text-[#06B6D4] hover:text-slate-950 dark:hover:text-white py-1"
                >
                  Open File Manager
                  <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
              <div className="divide-y divide-slate-200 dark:divide-white/6">
                {starredFiles.map((file) => {
                  const previewable = getPreviewKind(file.file_extension, file.mime_type) !== null;
                  return (
                    <div
                      key={file.id}
                      className="px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors"
                    >
                      <button
                        type="button"
                        onClick={() => onPreviewFile(file)}
                        className="flex items-center gap-3.5 text-left min-w-0 flex-1 min-h-[40px]"
                      >
                        <div className="w-10 h-10 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-[#090B12] flex items-center justify-center shrink-0">
                          {renderFileIcon(file)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                            {file.name}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-[#94A3B8] truncate">
                            <span>{getFolderPath(file.folder_id)}</span>
                            <span className="mx-1.5" aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">{formatBytes(file.file_size_bytes)}</span>
                            <span className="mx-1.5" aria-hidden="true">·</span>
                            <span>{formatDate(file.created_at)}</span>
                          </p>
                        </div>
                      </button>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {previewable && (
                          <button
                            type="button"
                            onClick={() => onPreviewFile(file)}
                            aria-label={`Preview ${file.name}`}
                            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#090B12] text-[#7C3AED] dark:text-[#A78BFA] hover:border-[#8B5CF6]/60 min-h-[40px]"
                          >
                            <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                            View
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void onDownloadFile(file)}
                          aria-label={`Download ${file.name}`}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#090B12] text-slate-800 dark:text-white hover:border-[#06B6D4]/60 min-h-[40px]"
                        >
                          <Download className="w-3.5 h-3.5 text-[#0891B2] dark:text-[#06B6D4]" aria-hidden="true" />
                          <span className="hidden sm:inline">Download</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onToggleFavoriteFile(file.id)}
                          aria-label={`Remove ${file.name} from favorites`}
                          title="Remove from favorites"
                          className="p-2 rounded-lg border border-amber-300 dark:border-amber-400/30 bg-amber-50 dark:bg-amber-400/10 text-amber-500 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-400/20 min-h-[40px] min-w-[40px] flex items-center justify-center"
                        >
                          <Star className="w-4 h-4 fill-amber-400 dark:fill-amber-300" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {showMods && starredMods.length === 0 && showFiles && starredFiles.length === 0 && (
            <div className="vault-glass rounded-xl p-10 text-center space-y-2">
              <p className="text-sm font-medium text-slate-900 dark:text-white">
                No starred items match &ldquo;{query}&rdquo;
              </p>
              <button
                type="button"
                onClick={() => setQuery('')}
                className="text-xs text-[#7C3AED] dark:text-[#A78BFA] hover:text-slate-950 dark:hover:text-white py-1"
              >
                Clear filter
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

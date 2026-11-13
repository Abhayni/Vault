import { useEffect, useMemo, useState } from 'react';
import {
  Search,
  Download,
  Pencil,
  Trash2,
  LayoutGrid,
  List,
  Upload,
  Package,
  CheckSquare,
  Square,
  X,
  Loader2,
  RotateCcw,
  Star,
  FolderKanban,
} from 'lucide-react';
import type { Category, ModLoader, ModRecord, ModVersion } from '../types/vault';
import { formatBytes, formatDate } from '../lib/format';
import { VaultArtwork } from '../components/VaultArtwork';
import { ConfirmActionModal } from '../components/ConfirmActionModal';

interface MyModsPageProps {
  mods: ModRecord[];
  versions: ModVersion[];
  categories: Category[];
  thumbnailUrls: Record<string, string>;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  initialCategoryFilter: string;
  onClearInitialCategory: () => void;
  defaultViewMode?: 'table' | 'grid';
  favoriteModIds: Set<string>;
  onToggleFavoriteMod: (modId: string) => void;
  onOpenMod: (modId: string) => void;
  onEditMod: (mod: ModRecord) => void;
  onDeleteMod: (mod: ModRecord) => Promise<void>;
  onDownloadVersion: (version: ModVersion) => Promise<void>;
  onBatchDownloadVersions: (versionIds: string[], zipName: string) => Promise<void>;
  batchDownloading: boolean;
  onGoUpload: () => void;
  onOpenCategories?: () => void;
}

type ModSortKey = 'updated' | 'name' | 'size' | 'versions';

const LOADER_FILTERS: Array<'All' | ModLoader> = [
  'All',
  'Fabric',
  'Forge',
  'NeoForge',
  'Quilt',
];

export function MyModsPage({
  mods,
  versions,
  categories,
  thumbnailUrls,
  searchQuery,
  onSearchChange,
  initialCategoryFilter,
  onClearInitialCategory,
  defaultViewMode = 'table',
  favoriteModIds,
  onToggleFavoriteMod,
  onOpenMod,
  onEditMod,
  onDeleteMod,
  onDownloadVersion,
  onBatchDownloadVersions,
  batchDownloading,
  onGoUpload,
  onOpenCategories,
}: MyModsPageProps) {
  const [loaderFilter, setLoaderFilter] = useState<'All' | ModLoader>('All');
  const [mcFilter, setMcFilter] = useState<string>('All');
  const [catFilter, setCatFilter] = useState<string>(initialCategoryFilter || 'All');
  const [sortBy, setSortBy] = useState<ModSortKey>('updated');
  const [viewMode, setViewMode] = useState<'table' | 'grid'>(defaultViewMode);
  const [pendingDeleteMod, setPendingDeleteMod] = useState<ModRecord | null>(null);
  const [deletingMod, setDeletingMod] = useState(false);
  const [selectedModIds, setSelectedModIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setViewMode(defaultViewMode);
  }, [defaultViewMode]);

  useEffect(() => {
    if (initialCategoryFilter) {
      setCatFilter(initialCategoryFilter);
    }
  }, [initialCategoryFilter]);

  const hasActiveFilters =
    loaderFilter !== 'All' ||
    mcFilter !== 'All' ||
    catFilter !== 'All' ||
    searchQuery.trim().length > 0;

  const resetAllFilters = () => {
    setLoaderFilter('All');
    setMcFilter('All');
    setCatFilter('All');
    onClearInitialCategory();
    onSearchChange('');
  };

  const versionsByMod = useMemo(() => {
    const map = new Map<string, ModVersion[]>();
    for (const v of versions) {
      const list = map.get(v.mod_id) || [];
      list.push(v);
      map.set(v.mod_id, list);
    }
    for (const [, list] of map) {
      list.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    }
    return map;
  }, [versions]);

  const sizeByMod = useMemo(() => {
    const map = new Map<string, number>();
    for (const [modId, list] of versionsByMod) {
      map.set(
        modId,
        list.reduce((s, v) => s + (Number(v.file_size_bytes) || 0), 0),
      );
    }
    return map;
  }, [versionsByMod]);

  const categoryById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );

  const mcVersions = useMemo(() => {
    const set = new Set<string>();
    for (const m of mods) set.add(m.latest_mc_version);
    for (const v of versions) set.add(v.mc_version);
    return Array.from(set).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  }, [mods, versions]);

  const filteredMods = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = mods.filter((mod) => {
      const modVersions = versionsByMod.get(mod.id) || [];

      if (loaderFilter !== 'All') {
        const matchesLoader =
          mod.loader === loaderFilter || modVersions.some((v) => v.loader === loaderFilter);
        if (!matchesLoader) return false;
      }

      if (mcFilter !== 'All') {
        const matchesMc =
          mod.latest_mc_version === mcFilter ||
          modVersions.some((v) => v.mc_version === mcFilter);
        if (!matchesMc) return false;
      }

      if (catFilter !== 'All') {
        if (catFilter === 'uncategorized') {
          if (mod.category_id) return false;
        } else if (mod.category_id !== catFilter) {
          return false;
        }
      }

      if (q) {
        const hay = [
          mod.name,
          mod.description,
          mod.loader,
          mod.latest_mc_version,
          ...modVersions.map((v) => `${v.file_name} ${v.version_number}`),
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });

    list.sort((a, b) => {
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name);
      }
      if (sortBy === 'size') {
        return (sizeByMod.get(b.id) || 0) - (sizeByMod.get(a.id) || 0);
      }
      if (sortBy === 'versions') {
        return (versionsByMod.get(b.id)?.length || 0) - (versionsByMod.get(a.id)?.length || 0);
      }
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });

    return list;
  }, [mods, versionsByMod, sizeByMod, loaderFilter, mcFilter, catFilter, searchQuery, sortBy]);

  const selectableMods = filteredMods.filter((m) => (versionsByMod.get(m.id) || []).length > 0);
  const allFilteredSelected =
    selectableMods.length > 0 && selectableMods.every((m) => selectedModIds.has(m.id));

  const toggleModSelection = (modId: string) => {
    setSelectedModIds((prev) => {
      const next = new Set(prev);
      if (next.has(modId)) next.delete(modId);
      else next.add(modId);
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    setSelectedModIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        selectableMods.forEach((m) => next.delete(m.id));
      } else {
        selectableMods.forEach((m) => next.add(m.id));
      }
      return next;
    });
  };

  const handleBatchDownloadSelected = async () => {
    const versionIds: string[] = [];
    for (const modId of selectedModIds) {
      const modVers = versionsByMod.get(modId) || [];
      const preferred =
        modVers.find(
          (v) =>
            (mcFilter === 'All' || v.mc_version === mcFilter) &&
            (loaderFilter === 'All' || v.loader === loaderFilter),
        ) || modVers[0];
      if (preferred) versionIds.push(preferred.id);
    }

    if (versionIds.length === 0) return;
    await onBatchDownloadVersions(
      versionIds,
      `mod-vault-mods-${new Date().toISOString().slice(0, 10)}.zip`,
    );
  };

  return (
    <div className="space-y-5">
      {/* Filter, Sort & Search Toolbar */}
      <div className="vault-glass rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Segmented loader tabs */}
          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#090B12] border border-slate-200 dark:border-white/8 overflow-x-auto max-w-full">
            {LOADER_FILTERS.map((loader) => (
              <button
                key={loader}
                type="button"
                onClick={() => setLoaderFilter(loader)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 min-h-[36px] ${
                  loaderFilter === loader
                    ? 'bg-[#8B5CF6] text-white'
                    : 'text-slate-600 dark:text-[#94A3B8] hover:text-slate-950 dark:hover:text-white'
                }`}
              >
                {loader}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {onOpenCategories && (
              <button
                type="button"
                onClick={onOpenCategories}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#090B12] text-slate-700 dark:text-[#CBD5E1] hover:text-slate-950 dark:hover:text-white hover:border-[#8B5CF6]/50 min-h-[40px] whitespace-nowrap"
              >
                <FolderKanban className="w-3.5 h-3.5 text-[#7C3AED] dark:text-[#A78BFA]" aria-hidden="true" />
                Categories
              </button>
            )}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetAllFilters}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-[#CBD5E1] hover:text-slate-950 dark:hover:text-white min-h-[40px] whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                Reset
              </button>
            )}
            <button
              type="button"
              onClick={() => setViewMode('table')}
              aria-label="List view"
              title="List view"
              className={`p-2 rounded-lg border transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center ${
                viewMode === 'table'
                  ? 'border-[#8B5CF6]/60 bg-[#8B5CF6]/12 dark:bg-[#8B5CF6]/15 text-[#7C3AED] dark:text-white'
                  : 'border-slate-200 dark:border-white/10 text-slate-500 dark:text-[#94A3B8] hover:text-slate-950 dark:hover:text-white'
              }`}
            >
              <List className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              aria-label="Grid view"
              title="Grid view"
              className={`p-2 rounded-lg border transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center ${
                viewMode === 'grid'
                  ? 'border-[#8B5CF6]/60 bg-[#8B5CF6]/12 dark:bg-[#8B5CF6]/15 text-[#7C3AED] dark:text-white'
                  : 'border-slate-200 dark:border-white/10 text-slate-500 dark:text-[#94A3B8] hover:text-slate-950 dark:hover:text-white'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-5 relative">
            <Search
              className="w-4 h-4 text-slate-400 dark:text-[#64748B] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search mods by name, file, or notes..."
              aria-label="Filter mods"
              className="vault-glow-ring w-full pl-10 pr-9 py-2 text-xs rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-[#64748B] min-h-[40px]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                aria-label="Clear mod search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded text-slate-400 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="md:col-span-3">
            <select
              aria-label="Filter by Minecraft version"
              value={mcFilter}
              onChange={(e) => setMcFilter(e.target.value)}
              className="vault-glow-ring w-full px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white min-h-[40px]"
            >
              <option value="All">All Minecraft Versions</option>
              {mcVersions.map((ver) => (
                <option key={ver} value={ver}>
                  Minecraft {ver}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <select
              aria-label="Filter by category"
              value={catFilter}
              onChange={(e) => {
                setCatFilter(e.target.value);
                onClearInitialCategory();
              }}
              className="vault-glow-ring w-full px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white min-h-[40px]"
            >
              <option value="All">All Categories</option>
              <option value="uncategorized">Uncategorized</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <select
              aria-label="Sort mods"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as ModSortKey)}
              className="vault-glow-ring w-full px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white min-h-[40px]"
            >
              <option value="updated">Sort: Updated</option>
              <option value="name">Sort: Name</option>
              <option value="size">Sort: Size</option>
              <option value="versions">Sort: Versions</option>
            </select>
          </div>
        </div>
      </div>

      {/* Batch Mod Selection Bar */}
      {selectedModIds.size > 0 && (
        <div className="vault-glass rounded-xl px-4 py-3 border border-[#8B5CF6]/40 bg-[#8B5CF6]/10 dark:bg-[#8B5CF6]/12 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs font-semibold text-slate-900 dark:text-white font-mono tabular-nums">
            {selectedModIds.size} mod{selectedModIds.size === 1 ? '' : 's'} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={batchDownloading}
              onClick={() => void handleBatchDownloadSelected()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white min-h-[40px] whitespace-nowrap disabled:opacity-50"
            >
              {batchDownloading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              {batchDownloading ? 'Packaging ZIP...' : 'Download Selected (.zip)'}
            </button>
            <button
              type="button"
              onClick={() => setSelectedModIds(new Set())}
              aria-label="Clear mod selection"
              className="p-2 rounded-lg text-slate-500 dark:text-[#CBD5E1] hover:text-slate-900 dark:hover:text-white min-h-[40px] min-w-[40px] flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Results Summary */}
      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-[#94A3B8] px-1">
        <span className="font-mono tabular-nums">
          Showing {filteredMods.length} of {mods.length} mods
        </span>
        {viewMode === 'grid' && selectableMods.length > 0 && (
          <button
            type="button"
            onClick={toggleSelectAllFiltered}
            className="text-xs text-[#7C3AED] dark:text-[#A78BFA] hover:text-slate-950 dark:hover:text-white py-1"
          >
            {allFilteredSelected ? 'Deselect all' : 'Select all shown'}
          </button>
        )}
      </div>

      {filteredMods.length === 0 ? (
        <div className="vault-glass rounded-xl p-12 text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-[#8B5CF6]/12 dark:bg-[#8B5CF6]/15 border border-[#8B5CF6]/30 mx-auto flex items-center justify-center">
            <Package className="w-6 h-6 text-[#7C3AED] dark:text-[#A78BFA]" aria-hidden="true" />
          </div>
          <h2 className="text-base font-semibold text-slate-950 dark:text-white">
            {mods.length === 0 ? 'No mods uploaded yet' : 'No mods match your filters'}
          </h2>
          <p className="text-xs text-slate-500 dark:text-[#94A3B8] max-w-md mx-auto">
            {mods.length === 0
              ? 'Upload your first .jar mod file to start building your private mod library.'
              : 'Try clearing your search or switching your Minecraft version or loader filter.'}
          </p>
          {mods.length === 0 ? (
            <button
              type="button"
              onClick={onGoUpload}
              className="vault-glow-ring inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white transition-colors min-h-[40px]"
            >
              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
              Upload Mod
            </button>
          ) : (
            <button
              type="button"
              onClick={resetAllFilters}
              className="vault-glow-ring inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-white/12 bg-white dark:bg-[#090B12] text-slate-800 dark:text-white hover:border-[#8B5CF6]/50 transition-colors min-h-[40px]"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              Reset All Filters
            </button>
          )}
        </div>
      ) : viewMode === 'table' ? (
        <div className="vault-glass rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/8 text-[11px] font-semibold text-slate-500 dark:text-[#94A3B8] bg-slate-50 dark:bg-[#090B12]/60">
                  <th className="py-3 pl-4 pr-2 w-10">
                    {selectableMods.length > 0 && (
                      <button
                        type="button"
                        onClick={toggleSelectAllFiltered}
                        aria-label={allFilteredSelected ? 'Deselect all mods' : 'Select all mods'}
                        className="p-1.5 text-slate-400 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-white"
                      >
                        {allFilteredSelected ? (
                          <CheckSquare className="w-4 h-4 text-[#7C3AED] dark:text-[#A78BFA]" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                    )}
                  </th>
                  <th className="py-3 px-3">Mod</th>
                  <th className="py-3 px-4">Loader &amp; MC</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4 text-right">Versions</th>
                  <th className="py-3 px-4 text-right">Size</th>
                  <th className="py-3 px-4 text-right">Updated</th>
                  <th className="py-3 pl-4 pr-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-white/6 text-sm">
                {filteredMods.map((mod) => {
                  const modVers = versionsByMod.get(mod.id) || [];
                  const latestVer = modVers[0];
                  const totalSize = sizeByMod.get(mod.id) || 0;
                  const category = mod.category_id ? categoryById.get(mod.category_id) : null;
                  const thumbKey = mod.thumbnail_drive_id || mod.thumbnail_key;
                  const thumbUrl = thumbKey ? thumbnailUrls[thumbKey] : null;
                  const isSelected = selectedModIds.has(mod.id);
                  const isStarred = favoriteModIds.has(mod.id);

                  return (
                    <tr
                      key={mod.id}
                      className={`hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors ${
                        isSelected ? 'bg-[#8B5CF6]/8' : ''
                      }`}
                    >
                      <td className="py-3 pl-4 pr-2">
                        {latestVer && (
                          <button
                            type="button"
                            onClick={() => toggleModSelection(mod.id)}
                            aria-label={isSelected ? `Deselect ${mod.name}` : `Select ${mod.name}`}
                            className="p-1.5 text-slate-400 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-white"
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-[#7C3AED] dark:text-[#A78BFA]" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </button>
                        )}
                      </td>

                      <td className="py-3 px-3">
                        <button
                          type="button"
                          onClick={() => onOpenMod(mod.id)}
                          className="flex items-center gap-3 text-left min-w-0 group"
                        >
                          <VaultArtwork src={thumbUrl} alt={mod.name} size="sm" />
                          <div className="min-w-0">
                            <p className="font-medium text-slate-900 dark:text-white group-hover:text-[#7C3AED] dark:group-hover:text-[#A78BFA] transition-colors truncate max-w-[240px]">
                              {mod.name}
                            </p>
                            <p className="text-xs font-mono text-slate-400 dark:text-[#64748B] truncate max-w-[240px]">
                              {latestVer?.file_name || 'No files yet'}
                            </p>
                          </div>
                        </button>
                      </td>

                      <td className="py-3 px-4 text-xs text-slate-700 dark:text-[#CBD5E1] whitespace-nowrap">
                        <span>{mod.loader}</span>
                        <span className="mx-1.5 text-slate-400 dark:text-[#64748B]" aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{mod.latest_mc_version}</span>
                      </td>

                      <td className="py-3 px-4 text-xs text-slate-500 dark:text-[#94A3B8] whitespace-nowrap">
                        {category ? category.name : 'Uncategorized'}
                      </td>

                      <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-slate-700 dark:text-[#E2E8F0]">
                        {modVers.length}
                      </td>

                      <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-slate-700 dark:text-[#E2E8F0] whitespace-nowrap">
                        {formatBytes(totalSize)}
                      </td>

                      <td className="py-3 px-4 text-right text-xs text-slate-500 dark:text-[#94A3B8] whitespace-nowrap">
                        {formatDate(mod.updated_at)}
                      </td>

                      <td className="py-3 pl-4 pr-5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => onToggleFavoriteMod(mod.id)}
                            title={isStarred ? 'Remove from favorites' : 'Add to favorites'}
                            aria-label={isStarred ? `Unstar ${mod.name}` : `Star ${mod.name}`}
                            className={`p-2 rounded-lg border transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center ${
                              isStarred
                                ? 'border-amber-400/50 bg-amber-50 dark:bg-amber-400/12 text-amber-500 dark:text-amber-300'
                                : 'border-slate-200 dark:border-white/10 text-slate-400 dark:text-[#64748B] hover:text-amber-500 dark:hover:text-amber-300'
                            }`}
                          >
                            <Star className={`w-4 h-4 ${isStarred ? 'fill-amber-400 dark:fill-amber-300' : ''}`} />
                          </button>
                          {latestVer && (
                            <button
                              type="button"
                              onClick={() => onDownloadVersion(latestVer)}
                              title={`Download ${latestVer.file_name}`}
                              aria-label={`Download latest version of ${mod.name}`}
                              className="p-2 rounded-lg border border-slate-200 dark:border-white/10 text-[#0891B2] dark:text-[#06B6D4] hover:bg-[#06B6D4]/10 dark:hover:bg-[#06B6D4]/15 hover:border-[#06B6D4]/40 transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onEditMod(mod)}
                            title="Edit details"
                            aria-label={`Edit ${mod.name}`}
                            className="p-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-[#CBD5E1] hover:text-slate-950 dark:hover:text-white hover:border-[#8B5CF6]/50 transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingDeleteMod(mod)}
                            title="Move to Trash"
                            aria-label={`Move ${mod.name} to Trash`}
                            className="p-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-[#94A3B8] hover:text-red-600 dark:hover:text-red-400 hover:border-red-500/40 transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredMods.map((mod) => {
            const modVers = versionsByMod.get(mod.id) || [];
            const latestVer = modVers[0];
            const totalSize = sizeByMod.get(mod.id) || 0;
            const category = mod.category_id ? categoryById.get(mod.category_id) : null;
            const thumbKey = mod.thumbnail_drive_id || mod.thumbnail_key;
            const thumbUrl = thumbKey ? thumbnailUrls[thumbKey] : null;
            const isSelected = selectedModIds.has(mod.id);
            const isStarred = favoriteModIds.has(mod.id);

            return (
              <article
                key={mod.id}
                className={`vault-glass vault-glass-hover rounded-xl p-5 flex flex-col justify-between gap-4 ${
                  isSelected ? 'border-[#8B5CF6]/60' : ''
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-start gap-3.5">
                    <VaultArtwork src={thumbUrl} alt={mod.name} size="md" />
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => onOpenMod(mod.id)}
                        className="text-left font-semibold text-base text-slate-950 dark:text-white hover:text-[#7C3AED] dark:hover:text-[#A78BFA] transition-colors truncate block w-full"
                      >
                        {mod.name}
                      </button>
                      <p className="text-xs text-slate-500 dark:text-[#94A3B8] mt-0.5 truncate">
                        <span>{mod.loader}</span>
                        <span className="mx-1.5" aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{mod.latest_mc_version}</span>
                        <span className="mx-1.5" aria-hidden="true">·</span>
                        <span>{category ? category.name : 'Uncategorized'}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => onToggleFavoriteMod(mod.id)}
                        aria-label={isStarred ? `Unstar ${mod.name}` : `Star ${mod.name}`}
                        className={`p-1.5 transition-colors ${
                          isStarred
                            ? 'text-amber-500 dark:text-amber-300'
                            : 'text-slate-400 dark:text-[#64748B] hover:text-amber-500 dark:hover:text-amber-300'
                        }`}
                      >
                        <Star className={`w-4 h-4 ${isStarred ? 'fill-amber-400 dark:fill-amber-300' : ''}`} />
                      </button>
                      {latestVer && (
                        <button
                          type="button"
                          onClick={() => toggleModSelection(mod.id)}
                          aria-label={isSelected ? `Deselect ${mod.name}` : `Select ${mod.name}`}
                          className="p-1.5 text-slate-400 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-white"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-[#7C3AED] dark:text-[#A78BFA]" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  <p className="text-xs text-slate-500 dark:text-[#94A3B8] line-clamp-2 leading-relaxed min-h-[32px]">
                    {mod.description || 'No description added yet.'}
                  </p>
                </div>

                <div className="pt-3 border-t border-slate-200 dark:border-white/8 flex items-center justify-between gap-2">
                  <span className="text-xs font-mono tabular-nums text-slate-600 dark:text-[#CBD5E1]">
                    {modVers.length} ver · {formatBytes(totalSize)}
                  </span>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onEditMod(mod)}
                      aria-label={`Edit ${mod.name}`}
                      title="Edit details"
                      className="p-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-[#CBD5E1] hover:text-slate-950 dark:hover:text-white hover:border-[#8B5CF6]/50 transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    {latestVer && (
                      <button
                        type="button"
                        onClick={() => onDownloadVersion(latestVer)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#090B12] text-slate-800 dark:text-white hover:border-[#06B6D4]/60 transition-colors min-h-[40px]"
                      >
                        <Download className="w-3.5 h-3.5 text-[#0891B2] dark:text-[#06B6D4]" aria-hidden="true" />
                        Download
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onOpenMod(mod.id)}
                      className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 text-slate-700 dark:text-[#CBD5E1] hover:text-slate-950 dark:hover:text-white transition-colors min-h-[40px]"
                    >
                      Open
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {pendingDeleteMod && (
        <ConfirmActionModal
          title={`Move "${pendingDeleteMod.name}" to Trash?`}
          description="This moves all saved .jar files and icons for this mod to Trash in Google Drive so you can restore or permanently delete them later."
          items={(versionsByMod.get(pendingDeleteMod.id) || []).map(
            (v) => `${v.file_name} (v${v.version_number})`,
          )}
          confirmLabel="Move to Trash"
          busy={deletingMod}
          onCancel={() => setPendingDeleteMod(null)}
          onConfirm={async () => {
            setDeletingMod(true);
            try {
              await onDeleteMod(pendingDeleteMod);
              setPendingDeleteMod(null);
            } finally {
              setDeletingMod(false);
            }
          }}
        />
      )}
    </div>
  );
}

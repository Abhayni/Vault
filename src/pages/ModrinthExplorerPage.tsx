import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Compass,
  Search,
  X,
  History,
  ArrowLeft,
  Download,
  Heart,
  ExternalLink,
  Package,
  Layers,
  Loader2,
  AlertCircle,
  HardDriveUpload,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
} from 'lucide-react';
import type {
  Category,
  ModLoader,
  ModRecord,
  ModrinthProjectDetails,
  ModrinthSearchHistoryEntry,
  ModrinthSearchHit,
  ModrinthVersionFile,
  ModrinthVersionRecord,
  VaultFolder,
} from '../types/vault';
import { apiRequest, DriveAuthRequiredError } from '../lib/supabase';
import { formatBytes, formatDate } from '../lib/format';
import {
  clearModrinthSearchHistory,
  loadModrinthSearchHistory,
  saveModrinthSearchHistory,
} from '../lib/preferences';

interface ModrinthExplorerPageProps {
  userId: string;
  accessToken: string;
  driveConnected: boolean;
  googleDriveToken: string | null;
  onEnsureDriveConnected: () => Promise<boolean>;
  onDriveAuthInvalid: (message?: string) => void;
  existingMods: ModRecord[];
  categories: Category[];
  vaultFolders: VaultFolder[];
  onImportedToVault: (result: { destination: 'mods' | 'files'; modId?: string }) => Promise<void>;
  onNotify: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}

type ModrinthSort = 'relevance' | 'downloads' | 'follows' | 'newest' | 'updated';

const POPULAR_MC_VERSIONS = [
  '1.21.4',
  '1.21.1',
  '1.21',
  '1.20.4',
  '1.20.1',
  '1.19.2',
  '1.18.2',
  '1.16.5',
  '1.12.2',
];

const LOADER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All Loaders' },
  { value: 'fabric', label: 'Fabric' },
  { value: 'forge', label: 'Forge' },
  { value: 'neoforge', label: 'NeoForge' },
  { value: 'quilt', label: 'Quilt' },
];

function formatCompactCount(num: number): string {
  if (!Number.isFinite(num)) return '0';
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return String(num);
}

function getFileExt(name: string): string {
  const idx = name.lastIndexOf('.');
  if (idx <= 0) return '';
  return name.slice(idx).toLowerCase();
}

function normalizeLoaderLabel(raw: string | undefined): ModLoader {
  const lower = (raw || '').toLowerCase();
  if (lower === 'forge') return 'Forge';
  if (lower === 'neoforge') return 'NeoForge';
  if (lower === 'quilt') return 'Quilt';
  return 'Fabric';
}

export function ModrinthExplorerPage({
  userId,
  accessToken,
  driveConnected,
  googleDriveToken,
  onEnsureDriveConnected,
  onDriveAuthInvalid,
  existingMods,
  categories,
  vaultFolders,
  onImportedToVault,
  onNotify,
}: ModrinthExplorerPageProps) {
  // Independent Modrinth search & filter state (never linked to My Mods or File Manager)
  const [searchInput, setSearchInput] = useState('');
  const [projectType, setProjectType] = useState<'all' | 'mod' | 'modpack'>('all');
  const [loaderFilter, setLoaderFilter] = useState('');
  const [mcVersionFilter, setMcVersionFilter] = useState('');
  const [sortBy, setSortBy] = useState<ModrinthSort>('downloads');
  const [offset, setOffset] = useState(0);
  const pageSize = 18;

  const [hits, setHits] = useState<ModrinthSearchHit[]>([]);
  const [totalHits, setTotalHits] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Separate client-only Modrinth search history
  const [history, setHistory] = useState<ModrinthSearchHistoryEntry[]>(() =>
    loadModrinthSearchHistory(userId),
  );

  // Project details state (read-only Modrinth API)
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [projectDetails, setProjectDetails] = useState<ModrinthProjectDetails | null>(null);
  const [projectVersions, setProjectVersions] = useState<ModrinthVersionRecord[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [versionLoaderFilter, setVersionLoaderFilter] = useState('');
  const [versionMcFilter, setVersionMcFilter] = useState('');

  // Explicit manual "Import to My Vault" modal state
  const [importTarget, setImportTarget] = useState<{
    version: ModrinthVersionRecord;
    file: ModrinthVersionFile;
  } | null>(null);
  const [importDestination, setImportDestination] = useState<'mods' | 'files'>('mods');
  const [importMode, setImportMode] = useState<'new-mod' | 'existing-mod'>('new-mod');
  const [importExistingModId, setImportExistingModId] = useState('');
  const [importCategoryId, setImportCategoryId] = useState('');
  const [importFolderId, setImportFolderId] = useState('');
  const [importing, setImporting] = useState(false);

  const runSearch = useCallback(
    async (params: {
      query: string;
      type: 'all' | 'mod' | 'modpack';
      loader: string;
      mcVersion: string;
      sort: ModrinthSort;
      pageOffset: number;
      recordHistory?: boolean;
    }) => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({
          projectType: params.type,
          sort: params.sort,
          offset: String(params.pageOffset),
          limit: String(pageSize),
        });
        if (params.query.trim()) qs.set('q', params.query.trim());
        if (params.loader) qs.set('loader', params.loader);
        if (params.mcVersion.trim()) qs.set('mcVersion', params.mcVersion.trim());

        const res = await apiRequest<{
          hits: ModrinthSearchHit[];
          total_hits: number;
        }>(`/api/modrinth/search?${qs.toString()}`, accessToken);

        setHits(Array.isArray(res.hits) ? res.hits : []);
        setTotalHits(Number(res.total_hits) || 0);

        if (params.recordHistory && params.query.trim()) {
          const entry: ModrinthSearchHistoryEntry = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            query: params.query.trim(),
            projectType: params.type,
            loader: params.loader,
            mcVersion: params.mcVersion.trim(),
            searchedAt: new Date().toISOString(),
          };
          setHistory((prev) => {
            const deduped = prev.filter(
              (h) =>
                !(
                  h.query.toLowerCase() === entry.query.toLowerCase() &&
                  h.projectType === entry.projectType &&
                  h.loader === entry.loader &&
                  h.mcVersion === entry.mcVersion
                ),
            );
            const next = [entry, ...deduped].slice(0, 12);
            saveModrinthSearchHistory(userId, next);
            return next;
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to reach Modrinth search API.');
      } finally {
        setLoading(false);
      }
    },
    [accessToken, userId],
  );

  // Initial discovery browse on page open
  useEffect(() => {
    void runSearch({
      query: searchInput,
      type: projectType,
      loader: loaderFilter,
      mcVersion: mcVersionFilter,
      sort: sortBy,
      pageOffset: offset,
      recordHistory: false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectType, loaderFilter, mcVersionFilter, sortBy, offset]);

  const handleSubmitSearch = (e: FormEvent) => {
    e.preventDefault();
    setOffset(0);
    void runSearch({
      query: searchInput,
      type: projectType,
      loader: loaderFilter,
      mcVersion: mcVersionFilter,
      sort: sortBy,
      pageOffset: 0,
      recordHistory: true,
    });
  };

  const handleApplyHistoryEntry = (entry: ModrinthSearchHistoryEntry) => {
    setSearchInput(entry.query);
    setProjectType(entry.projectType);
    setLoaderFilter(entry.loader);
    setMcVersionFilter(entry.mcVersion);
    setOffset(0);
    void runSearch({
      query: entry.query,
      type: entry.projectType,
      loader: entry.loader,
      mcVersion: entry.mcVersion,
      sort: sortBy,
      pageOffset: 0,
      recordHistory: false,
    });
  };

  const openProjectDetails = async (slugOrId: string) => {
    setSelectedSlug(slugOrId);
    setProjectDetails(null);
    setProjectVersions([]);
    setDetailsError(null);
    setDetailsLoading(true);
    setVersionLoaderFilter(loaderFilter);
    setVersionMcFilter(mcVersionFilter);
    try {
      const [proj, vers] = await Promise.all([
        apiRequest<ModrinthProjectDetails>(
          `/api/modrinth/project/${encodeURIComponent(slugOrId)}`,
          accessToken,
        ),
        apiRequest<{ versions: ModrinthVersionRecord[] }>(
          `/api/modrinth/project/${encodeURIComponent(slugOrId)}/versions`,
          accessToken,
        ),
      ]);
      setProjectDetails(proj);
      setProjectVersions(Array.isArray(vers.versions) ? vers.versions : []);
    } catch (err) {
      setDetailsError(
        err instanceof Error ? err.message : 'Unable to load Modrinth project details.',
      );
    } finally {
      setDetailsLoading(false);
    }
  };

  const filteredVersions = useMemo(() => {
    return projectVersions.filter((ver) => {
      if (
        versionLoaderFilter &&
        !ver.loaders.some((l) => l.toLowerCase() === versionLoaderFilter.toLowerCase())
      ) {
        return false;
      }
      if (versionMcFilter && !ver.game_versions.includes(versionMcFilter)) {
        return false;
      }
      return true;
    });
  }, [projectVersions, versionLoaderFilter, versionMcFilter]);

  const openImportModal = (version: ModrinthVersionRecord, file: ModrinthVersionFile) => {
    const ext = getFileExt(file.filename);
    const defaultDest: 'mods' | 'files' = ext === '.jar' ? 'mods' : 'files';
    setImportTarget({ version, file });
    setImportDestination(defaultDest);
    setImportMode('new-mod');
    setImportExistingModId(existingMods[0]?.id || '');
    setImportCategoryId('');
    setImportFolderId('');
  };

  const handleConfirmImport = async (e: FormEvent) => {
    e.preventDefault();
    if (!importTarget || !projectDetails) return;

    const { version, file } = importTarget;
    if (importDestination === 'mods' && importMode === 'existing-mod' && !importExistingModId) {
      onNotify('error', 'Select a target mod', 'Choose an existing mod or create a new entry.');
      return;
    }

    const ready = await onEnsureDriveConnected();
    if (!ready) return;

    setImporting(true);
    try {
      const primaryLoader = normalizeLoaderLabel(
        versionLoaderFilter || version.loaders[0] || projectDetails.loaders?.[0],
      );
      const mcVer =
        versionMcFilter && version.game_versions.includes(versionMcFilter)
          ? versionMcFilter
          : version.game_versions[0] || '1.21.1';

      const res = await apiRequest<{
        imported: boolean;
        destination: 'mods' | 'files';
        modId?: string;
      }>(
        '/api/modrinth/import',
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({
            destination: importDestination,
            fileUrl: file.url,
            fileName: file.filename,
            projectTitle: projectDetails.title,
            projectSlug: projectDetails.slug,
            projectSummary: projectDetails.description,
            versionNumber: version.version_number,
            mcVersion: mcVer,
            loader: primaryLoader,
            changelog: version.changelog || '',
            targetModId:
              importDestination === 'mods' && importMode === 'existing-mod'
                ? importExistingModId
                : null,
            categoryId:
              importDestination === 'mods' && importMode === 'new-mod'
                ? importCategoryId || null
                : null,
            targetFolderId: importDestination === 'files' ? importFolderId || null : null,
          }),
        },
        googleDriveToken,
      );

      setImportTarget(null);
      await onImportedToVault({
        destination: res.destination,
        modId: res.modId,
      });
      onNotify(
        'success',
        'Imported to My Vault',
        `${file.filename} saved privately to your Google Drive (${
          res.destination === 'mods' ? 'My Mods' : 'File Manager'
        }).`,
      );
    } catch (err) {
      if (err instanceof DriveAuthRequiredError) {
        onDriveAuthInvalid(err.message);
      }
      onNotify(
        'error',
        'Import failed',
        err instanceof Error ? err.message : 'Unable to import file from Modrinth.',
      );
    } finally {
      setImporting(false);
    }
  };

  // =========================================================================
  // PROJECT DETAILS VIEW (Independent Modrinth Inspect + Manual Import)
  // =========================================================================
  if (selectedSlug) {
    const uniqueMcVersions = Array.from(
      new Set(projectVersions.flatMap((v) => v.game_versions || [])),
    ).slice(0, 30);

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setSelectedSlug(null)}
            className="vault-glow-ring inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#151925] text-slate-700 dark:text-[#CBD5E1] hover:text-slate-950 dark:hover:text-white min-h-[40px]"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            Back to Modrinth Explorer
          </button>

          {projectDetails && (
            <a
              href={`https://modrinth.com/${projectDetails.project_type}/${projectDetails.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 hover:underline"
            >
              View on Modrinth
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            </a>
          )}
        </div>

        {detailsLoading ? (
          <div className="vault-glass rounded-xl p-12 flex flex-col items-center gap-3">
            <Loader2 className="w-7 h-7 animate-spin text-emerald-600 dark:text-emerald-400" />
            <p className="text-xs text-slate-500 dark:text-[#94A3B8]">
              Loading public Modrinth project details...
            </p>
          </div>
        ) : detailsError || !projectDetails ? (
          <div className="vault-glass rounded-xl p-8 text-center space-y-3">
            <AlertCircle className="w-7 h-7 text-red-500 mx-auto" />
            <p className="text-sm font-semibold text-slate-950 dark:text-white">
              Unable to load project
            </p>
            <p className="text-xs text-slate-500 dark:text-[#94A3B8]">
              {detailsError || 'Project details unavailable.'}
            </p>
          </div>
        ) : (
          <>
            {/* Project header card */}
            <section className="vault-glass rounded-xl p-6 space-y-5">
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-5">
                <div className="flex items-start gap-4 min-w-0">
                  {projectDetails.icon_url ? (
                    <img
                      src={projectDetails.icon_url}
                      alt={projectDetails.title}
                      referrerPolicy="no-referrer"
                      className="w-16 h-16 rounded-xl object-cover border border-slate-200 dark:border-white/10 shrink-0 bg-slate-100 dark:bg-[#090B12]"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-xl border border-slate-200 dark:border-white/10 bg-emerald-500/10 flex items-center justify-center shrink-0">
                      <Package className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
                    </div>
                  )}

                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300 font-medium">
                      <span className="capitalize">{projectDetails.project_type}</span>
                      {projectDetails.license?.id && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-slate-500 dark:text-[#94A3B8]">
                            {projectDetails.license.id}
                          </span>
                        </>
                      )}
                    </div>
                    <h2 className="font-display text-2xl font-bold text-slate-950 dark:text-white">
                      {projectDetails.title}
                    </h2>
                    <p className="text-sm text-slate-600 dark:text-[#CBD5E1] leading-relaxed">
                      {projectDetails.description}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-5 shrink-0 text-xs">
                  <div>
                    <p className="text-slate-500 dark:text-[#94A3B8]">Downloads</p>
                    <p className="font-mono text-base font-semibold tabular-nums text-slate-950 dark:text-white mt-0.5 flex items-center gap-1.5">
                      <Download className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      {formatCompactCount(projectDetails.downloads)}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500 dark:text-[#94A3B8]">Followers</p>
                    <p className="font-mono text-base font-semibold tabular-nums text-slate-950 dark:text-white mt-0.5 flex items-center gap-1.5">
                      <Heart className="w-3.5 h-3.5 text-[#8B5CF6]" />
                      {formatCompactCount(projectDetails.followers)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-200 dark:border-white/8 text-xs text-slate-500 dark:text-[#94A3B8]">
                <div className="flex flex-wrap items-center gap-2">
                  <span>Loaders:</span>
                  <span className="text-slate-800 dark:text-[#CBD5E1] font-medium">
                    {(projectDetails.loaders || []).join(' · ') || '—'}
                  </span>
                  {projectDetails.categories.length > 0 && (
                    <>
                      <span aria-hidden="true">/</span>
                      <span>{projectDetails.categories.slice(0, 5).join(' · ')}</span>
                    </>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  {projectDetails.source_url && (
                    <a
                      href={projectDetails.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-slate-950 dark:hover:text-white inline-flex items-center gap-1"
                    >
                      Source <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  {projectDetails.wiki_url && (
                    <a
                      href={projectDetails.wiki_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-slate-950 dark:hover:text-white inline-flex items-center gap-1"
                    >
                      Wiki <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  {projectDetails.issues_url && (
                    <a
                      href={projectDetails.issues_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-slate-950 dark:hover:text-white inline-flex items-center gap-1"
                    >
                      Issues <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
            </section>

            {/* Explicit separation notice */}
            <section className="rounded-xl px-4 py-3 border border-emerald-500/25 bg-emerald-500/8 text-xs text-emerald-900 dark:text-emerald-200 flex items-center gap-2.5">
              <Compass className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>
                Public Modrinth versions are read-only until you click{' '}
                <strong>Import to My Vault</strong> on a compatible file.
              </span>
            </section>

            {/* Versions section */}
            <section className="vault-glass rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 dark:border-white/8 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-950 dark:text-white">
                    Available Versions ({filteredVersions.length})
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-[#94A3B8] mt-0.5">
                    Select any compatible release (.jar, .mrpack, .zip) to import privately
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Filter versions by loader"
                    value={versionLoaderFilter}
                    onChange={(e) => setVersionLoaderFilter(e.target.value)}
                    className="vault-glow-ring px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white min-h-[38px]"
                  >
                    {LOADER_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>

                  <select
                    aria-label="Filter versions by Minecraft version"
                    value={versionMcFilter}
                    onChange={(e) => setVersionMcFilter(e.target.value)}
                    className="vault-glow-ring px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white min-h-[38px]"
                  >
                    <option value="">All MC Versions</option>
                    {uniqueMcVersions.map((ver) => (
                      <option key={ver} value={ver}>
                        MC {ver}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {filteredVersions.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500 dark:text-[#94A3B8]">
                  No Modrinth versions match the selected loader or Minecraft version filters.
                </div>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-white/6">
                  {filteredVersions.slice(0, 40).map((ver) => {
                    const primaryFile =
                      ver.files.find((f) => f.primary) || ver.files[0] || null;
                    const ext = primaryFile ? getFileExt(primaryFile.filename) : '';
                    const isCompatible =
                      Boolean(primaryFile) && ['.jar', '.mrpack', '.zip'].includes(ext);

                    return (
                      <div
                        key={ver.id}
                        className="px-5 py-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-white/[0.02]"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-slate-900 dark:text-white">
                              {ver.name || ver.version_number}
                            </span>
                            <span className="text-xs font-mono text-slate-500 dark:text-[#94A3B8]">
                              v{ver.version_number}
                            </span>
                            <span
                              className={`text-[11px] font-medium capitalize ${
                                ver.version_type === 'release'
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : ver.version_type === 'beta'
                                    ? 'text-amber-700 dark:text-amber-400'
                                    : 'text-red-700 dark:text-red-400'
                              }`}
                            >
                              · {ver.version_type}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 dark:text-[#94A3B8] truncate">
                            {ver.loaders.join(', ') || 'Universal'} · MC{' '}
                            {ver.game_versions.slice(0, 4).join(', ')}
                            {ver.game_versions.length > 4
                              ? ` +${ver.game_versions.length - 4}`
                              : ''}{' '}
                            · {formatDate(ver.date_published)}
                            {primaryFile
                              ? ` · ${primaryFile.filename} (${formatBytes(primaryFile.size)})`
                              : ''}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {primaryFile && (
                            <a
                              href={primaryFile.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 text-slate-700 dark:text-[#CBD5E1] hover:text-slate-950 dark:hover:text-white min-h-[38px] whitespace-nowrap"
                            >
                              <Download className="w-3.5 h-3.5" aria-hidden="true" />
                              Direct File
                            </a>
                          )}

                          {primaryFile && isCompatible && (
                            <button
                              type="button"
                              onClick={() => openImportModal(ver, primaryFile)}
                              className="vault-glow-ring inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white min-h-[38px] whitespace-nowrap"
                            >
                              <HardDriveUpload className="w-3.5 h-3.5" aria-hidden="true" />
                              Import to My Vault
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}

        {/* Explicit manual Import to My Vault Confirmation Modal */}
        {importTarget && projectDetails && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 dark:bg-black/80 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-vault-title"
          >
            <form
              onSubmit={handleConfirmImport}
              className="vault-glass rounded-xl max-w-lg w-full p-6 space-y-5 shadow-2xl border border-slate-200 dark:border-white/15"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3
                    id="import-vault-title"
                    className="text-lg font-semibold text-slate-950 dark:text-white"
                  >
                    Import to My Vault
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-[#94A3B8] mt-1">
                    Explicitly save this public Modrinth file into your private Google Drive and Supabase catalog.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => !importing && setImportTarget(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  aria-label="Close import dialog"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-xs space-y-1">
                <p className="font-semibold text-slate-900 dark:text-white truncate">
                  {importTarget.file.filename}
                </p>
                <p className="text-slate-500 dark:text-[#94A3B8] font-mono tabular-nums">
                  {projectDetails.title} · v{importTarget.version.version_number} ·{' '}
                  {formatBytes(importTarget.file.size)}
                </p>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <p className="font-medium text-slate-700 dark:text-[#CBD5E1] mb-1.5">
                    Private Destination
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={getFileExt(importTarget.file.filename) !== '.jar'}
                      onClick={() => setImportDestination('mods')}
                      className={`px-3 py-2.5 rounded-lg border text-left font-medium transition-colors disabled:opacity-45 ${
                        importDestination === 'mods'
                          ? 'border-[#8B5CF6] bg-[#8B5CF6]/12 text-slate-950 dark:text-white'
                          : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-[#94A3B8]'
                      }`}
                    >
                      My Mods (.jar)
                    </button>
                    <button
                      type="button"
                      onClick={() => setImportDestination('files')}
                      className={`px-3 py-2.5 rounded-lg border text-left font-medium transition-colors ${
                        importDestination === 'files'
                          ? 'border-[#06B6D4] bg-[#06B6D4]/12 text-slate-950 dark:text-white'
                          : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-[#94A3B8]'
                      }`}
                    >
                      File Manager
                    </button>
                  </div>
                </div>

                {importDestination === 'mods' ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-800 dark:text-[#E2E8F0]">
                        <input
                          type="radio"
                          name="import-mod-mode"
                          checked={importMode === 'new-mod'}
                          onChange={() => setImportMode('new-mod')}
                        />
                        Create new mod entry
                      </label>
                      {existingMods.length > 0 && (
                        <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-800 dark:text-[#E2E8F0]">
                          <input
                            type="radio"
                            name="import-mod-mode"
                            checked={importMode === 'existing-mod'}
                            onChange={() => setImportMode('existing-mod')}
                          />
                          Add version to existing mod
                        </label>
                      )}
                    </div>

                    {importMode === 'new-mod' ? (
                      <div>
                        <label className="block text-slate-600 dark:text-[#94A3B8] mb-1">
                          Category (optional)
                        </label>
                        <select
                          value={importCategoryId}
                          onChange={(e) => setImportCategoryId(e.target.value)}
                          className="vault-glow-ring w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white min-h-[38px]"
                        >
                          <option value="">Uncategorized</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div>
                        <label className="block text-slate-600 dark:text-[#94A3B8] mb-1">
                          Target Mod in My Mods
                        </label>
                        <select
                          value={importExistingModId}
                          onChange={(e) => setImportExistingModId(e.target.value)}
                          className="vault-glow-ring w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white min-h-[38px]"
                        >
                          {existingMods.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name} ({m.loader})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <label className="block text-slate-600 dark:text-[#94A3B8] mb-1">
                      Target Folder in File Manager
                    </label>
                    <select
                      value={importFolderId}
                      onChange={(e) => setImportFolderId(e.target.value)}
                      className="vault-glow-ring w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white min-h-[38px]"
                    >
                      <option value="">Vault Root</option>
                      {vaultFolders.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {!driveConnected && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300">
                    Google Drive is not connected yet — confirming will prompt Google Drive authorization first.
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  disabled={importing}
                  onClick={() => setImportTarget(null)}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 text-slate-700 dark:text-[#CBD5E1] min-h-[40px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={importing}
                  className="vault-glow-ring inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white min-h-[40px] disabled:opacity-60"
                >
                  {importing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  {importing ? 'Importing to Drive...' : 'Confirm Import'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // DISCOVERY SEARCH & BROWSE VIEW
  // =========================================================================
  const currentPage = Math.floor(offset / pageSize) + 1;
  const totalPages = Math.max(1, Math.ceil(totalHits / pageSize));

  return (
    <div className="space-y-6">
      {/* Independent Explorer Header Banner */}
      <section className="vault-glass rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 border-emerald-500/25">
        <div className="flex items-start gap-3.5 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/12 border border-emerald-500/25 flex items-center justify-center shrink-0">
            <Compass className="w-5 h-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-950 dark:text-white">
              Modrinth Public Catalog Explorer
            </h2>
            <p className="text-xs text-slate-600 dark:text-[#94A3B8] mt-1 leading-relaxed">
              Browse public Modrinth mods and modpacks independently. Searching or inspecting projects never writes to Supabase, My Mods, or Google Drive unless you click{' '}
              <span className="font-medium text-slate-900 dark:text-white">Import to My Vault</span>.
            </p>
          </div>
        </div>
      </section>

      {/* Independent Search & Filter Controls */}
      <section className="vault-glass rounded-xl p-5 space-y-4">
        <form onSubmit={handleSubmitSearch} className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search
              className="w-4 h-4 text-slate-400 dark:text-[#64748B] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search public Modrinth mods and modpacks (e.g. Sodium, Iris, Create, Fabulously Optimized)..."
              aria-label="Search Modrinth catalog"
              className="vault-glow-ring w-full pl-10 pr-9 py-2.5 text-sm rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-950 dark:text-white placeholder-slate-400 dark:placeholder-[#64748B] min-h-[42px]"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => {
                  setSearchInput('');
                  setOffset(0);
                  void runSearch({
                    query: '',
                    type: projectType,
                    loader: loaderFilter,
                    mcVersion: mcVersionFilter,
                    sort: sortBy,
                    pageOffset: 0,
                  });
                }}
                aria-label="Clear Modrinth search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={loading}
            className="vault-glow-ring inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors min-h-[42px] whitespace-nowrap shrink-0"
          >
            <Search className="w-3.5 h-3.5" aria-hidden="true" />
            Search Modrinth
          </button>
        </form>

        {/* Independent filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-white/8">
          <div className="inline-flex items-center p-1 rounded-lg bg-slate-100 dark:bg-[#090B12] border border-slate-200 dark:border-white/10">
            {(
              [
                ['all', 'All Projects'],
                ['mod', 'Mods'],
                ['modpack', 'Modpacks'],
              ] as Array<['all' | 'mod' | 'modpack', string]>
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => {
                  setOffset(0);
                  setProjectType(val);
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  projectType === val
                    ? 'bg-white dark:bg-emerald-600 text-slate-950 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-[#94A3B8] hover:text-slate-950 dark:hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Modrinth loader filter"
              value={loaderFilter}
              onChange={(e) => {
                setOffset(0);
                setLoaderFilter(e.target.value);
              }}
              className="vault-glow-ring px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white min-h-[38px]"
            >
              {LOADER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            <select
              aria-label="Modrinth Minecraft version filter"
              value={mcVersionFilter}
              onChange={(e) => {
                setOffset(0);
                setMcVersionFilter(e.target.value);
              }}
              className="vault-glow-ring px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white min-h-[38px]"
            >
              <option value="">All MC Versions</option>
              {POPULAR_MC_VERSIONS.map((v) => (
                <option key={v} value={v}>
                  MC {v}
                </option>
              ))}
            </select>

            <select
              aria-label="Modrinth sort order"
              value={sortBy}
              onChange={(e) => {
                setOffset(0);
                setSortBy(e.target.value as ModrinthSort);
              }}
              className="vault-glow-ring px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white min-h-[38px]"
            >
              <option value="downloads">Sort: Downloads</option>
              <option value="relevance">Sort: Relevance</option>
              <option value="follows">Sort: Follows</option>
              <option value="updated">Sort: Recently Updated</option>
              <option value="newest">Sort: Newest</option>
            </select>
          </div>
        </div>

        {/* Independent Search History */}
        {history.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-white/8 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 text-slate-500 dark:text-[#94A3B8]">
                <History className="w-3.5 h-3.5" aria-hidden="true" />
                Recent searches:
              </span>
              {history.slice(0, 6).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleApplyHistoryEntry(item)}
                  className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-white/5 hover:bg-emerald-500/12 text-slate-700 dark:text-[#CBD5E1] hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors"
                >
                  {item.query}
                  {item.loader ? ` (${item.loader})` : ''}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                clearModrinthSearchHistory(userId);
                setHistory([]);
              }}
              className="text-slate-400 hover:text-slate-700 dark:hover:text-white text-[11px]"
            >
              Clear History
            </button>
          </div>
        )}
      </section>

      {/* Results Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div
              key={idx}
              className="vault-glass rounded-xl p-5 h-44 animate-pulse bg-slate-100/70 dark:bg-[#151925]"
            />
          ))}
        </div>
      ) : error ? (
        <section className="vault-glass rounded-xl p-8 text-center space-y-3 border-red-400/35">
          <AlertCircle className="w-7 h-7 text-red-500 mx-auto" />
          <p className="text-sm font-semibold text-slate-950 dark:text-white">
            Modrinth search unavailable
          </p>
          <p className="text-xs text-slate-500 dark:text-[#94A3B8] max-w-md mx-auto">{error}</p>
          <button
            type="button"
            onClick={() =>
              void runSearch({
                query: searchInput,
                type: projectType,
                loader: loaderFilter,
                mcVersion: mcVersionFilter,
                sort: sortBy,
                pageOffset: offset,
              })
            }
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 text-white min-h-[38px]"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            Retry
          </button>
        </section>
      ) : hits.length === 0 ? (
        <section className="vault-glass rounded-xl p-10 text-center space-y-2">
          <Compass className="w-7 h-7 text-emerald-600 dark:text-emerald-400 mx-auto" />
          <h3 className="text-base font-semibold text-slate-950 dark:text-white">
            No matching Modrinth projects found
          </h3>
          <p className="text-xs text-slate-500 dark:text-[#94A3B8]">
            Try broadening your search terms, loader, or Minecraft version filter.
          </p>
        </section>
      ) : (
        <>
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-[#94A3B8]">
            <span className="font-mono tabular-nums">
              Showing {offset + 1}–{Math.min(offset + hits.length, totalHits)} of{' '}
              {totalHits.toLocaleString()} public projects
            </span>
            <span className="font-mono tabular-nums">
              Page {currentPage} / {totalPages}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {hits.map((project) => (
              <button
                key={project.project_id}
                type="button"
                onClick={() => void openProjectDetails(project.slug || project.project_id)}
                className="vault-glass vault-glass-hover rounded-xl p-5 text-left flex flex-col justify-between gap-4 min-h-[168px]"
              >
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    {project.icon_url ? (
                      <img
                        src={project.icon_url}
                        alt={project.title}
                        referrerPolicy="no-referrer"
                        className="w-12 h-12 rounded-lg object-cover border border-slate-200 dark:border-white/10 shrink-0 bg-slate-100 dark:bg-[#090B12]"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-lg border border-slate-200 dark:border-white/10 bg-emerald-500/10 flex items-center justify-center shrink-0">
                        {project.project_type === 'modpack' ? (
                          <Layers className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <Package className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                        )}
                      </div>
                    )}

                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 capitalize">
                        {project.project_type} · by {project.author}
                      </p>
                      <h3 className="text-sm font-semibold text-slate-950 dark:text-white truncate mt-0.5">
                        {project.title}
                      </h3>
                    </div>
                  </div>

                  <p className="text-xs text-slate-600 dark:text-[#94A3B8] line-clamp-2 leading-relaxed">
                    {project.description}
                  </p>
                </div>

                <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-200 dark:border-white/8 text-xs text-slate-500 dark:text-[#94A3B8]">
                  <span className="truncate">
                    {project.display_categories?.slice(0, 3).join(' · ') ||
                      project.categories?.slice(0, 3).join(' · ') ||
                      'Minecraft'}
                  </span>
                  <span className="font-mono tabular-nums inline-flex items-center gap-1 shrink-0 text-slate-700 dark:text-[#CBD5E1]">
                    <Download className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                    {formatCompactCount(project.downloads)}
                  </span>
                </div>
              </button>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - pageSize))}
                className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#151925] text-slate-700 dark:text-[#CBD5E1] disabled:opacity-40 min-h-[38px]"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </button>
              <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-[#94A3B8] px-2">
                {currentPage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={offset + pageSize >= totalHits}
                onClick={() => setOffset(offset + pageSize)}
                className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#151925] text-slate-700 dark:text-[#CBD5E1] disabled:opacity-40 min-h-[38px]"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

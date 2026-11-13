import { useState } from 'react';
import {
  ArrowLeft,
  Download,
  Upload,
  Pencil,
  Trash2,
  Copy,
  Check,
  CheckSquare,
  Square,
  Loader2,
  Star,
} from 'lucide-react';
import type { Category, ModRecord, ModVersion } from '../types/vault';
import { copyText, formatBytes, formatDateTime, slugify } from '../lib/format';
import { VaultArtwork } from '../components/VaultArtwork';
import { ConfirmActionModal } from '../components/ConfirmActionModal';

interface ModDetailsPageProps {
  mod: ModRecord;
  versions: ModVersion[];
  category: Category | null;
  thumbnailUrl: string | null;
  isFavorite?: boolean;
  onToggleFavorite?: (modId: string) => void;
  onBack: () => void;
  onUploadVersion: (modId: string) => void;
  onEditMod: (mod: ModRecord) => void;
  onDeleteMod: (mod: ModRecord) => Promise<void>;
  onDeleteVersion: (version: ModVersion) => Promise<void>;
  onDownloadVersion: (version: ModVersion) => Promise<void>;
  onBatchDownloadVersions: (versionIds: string[], zipName: string) => Promise<void>;
  batchDownloading: boolean;
}

export function ModDetailsPage({
  mod,
  versions,
  category,
  thumbnailUrl,
  isFavorite = false,
  onToggleFavorite,
  onBack,
  onUploadVersion,
  onEditMod,
  onDeleteMod,
  onDeleteVersion,
  onDownloadVersion,
  onBatchDownloadVersions,
  batchDownloading,
}: ModDetailsPageProps) {
  const [copiedSha, setCopiedSha] = useState<string | null>(null);
  const [confirmDeleteModOpen, setConfirmDeleteModOpen] = useState(false);
  const [pendingDeleteVer, setPendingDeleteVer] = useState<ModVersion | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [selectedVerIds, setSelectedVerIds] = useState<Set<string>>(new Set());

  const sortedVersions = [...versions].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  const latestVersion = sortedVersions[0] || null;
  const totalBytes = sortedVersions.reduce(
    (acc, v) => acc + (Number(v.file_size_bytes) || 0),
    0,
  );

  const allSelected =
    sortedVersions.length > 0 && sortedVersions.every((v) => selectedVerIds.has(v.id));

  const toggleAll = () => {
    if (allSelected) {
      setSelectedVerIds(new Set());
    } else {
      setSelectedVerIds(new Set(sortedVersions.map((v) => v.id)));
    }
  };

  const toggleOne = (id: string) => {
    setSelectedVerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCopySha = async (sha: string) => {
    const ok = await copyText(sha);
    if (ok) {
      setCopiedSha(sha);
      setTimeout(() => setCopiedSha((prev) => (prev === sha ? null : prev)), 1800);
    }
  };

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#10121A] text-slate-700 dark:text-[#CBD5E1] hover:text-slate-950 dark:hover:text-white transition-colors min-h-[40px]"
      >
        <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
        Back to My Mods
      </button>

      {/* Mod Summary Header Card */}
      <section className="vault-glass rounded-xl p-6">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
          <div className="flex items-start gap-5 min-w-0">
            <VaultArtwork src={thumbnailUrl} alt={mod.name} size="lg" />
            <div className="space-y-2 min-w-0">
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-slate-950 dark:text-white">
                {mod.name}
              </h2>
              <p className="text-xs text-slate-500 dark:text-[#94A3B8]">
                <span>{mod.loader}</span>
                <span className="mx-1.5" aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">MC {mod.latest_mc_version}</span>
                <span className="mx-1.5" aria-hidden="true">·</span>
                <span>{category ? category.name : 'Uncategorized'}</span>
                <span className="mx-1.5" aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {sortedVersions.length} version{sortedVersions.length === 1 ? '' : 's'} ({formatBytes(totalBytes)})
                </span>
              </p>
              <p className="text-sm text-slate-600 dark:text-[#CBD5E1] leading-relaxed max-w-2xl pt-1">
                {mod.description || 'No notes or description added for this mod.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {onToggleFavorite && (
              <button
                type="button"
                onClick={() => onToggleFavorite(mod.id)}
                aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                className={`vault-glow-ring inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap min-h-[40px] ${
                  isFavorite
                    ? 'border-amber-300 dark:border-amber-400/40 bg-amber-50 dark:bg-amber-400/15 text-amber-600 dark:text-amber-300'
                    : 'border-slate-200 dark:border-white/12 bg-slate-50 dark:bg-[#090B12] text-slate-700 dark:text-[#CBD5E1] hover:text-slate-950 dark:hover:text-white'
                }`}
              >
                <Star className={`w-3.5 h-3.5 ${isFavorite ? 'fill-amber-400 dark:fill-amber-300' : ''}`} aria-hidden="true" />
                {isFavorite ? 'Starred' : 'Favorite'}
              </button>
            )}
            {latestVersion && (
              <button
                type="button"
                onClick={() => onDownloadVersion(latestVersion)}
                className="vault-glow-ring inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white transition-colors whitespace-nowrap min-h-[40px]"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                Download Latest
              </button>
            )}
            <button
              type="button"
              onClick={() => onUploadVersion(mod.id)}
              className="vault-glow-ring inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/12 bg-slate-50 dark:bg-[#090B12] text-slate-800 dark:text-white hover:border-[#8B5CF6]/50 transition-colors whitespace-nowrap min-h-[40px]"
            >
              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
              Upload New Version
            </button>
            <button
              type="button"
              onClick={() => onEditMod(mod)}
              className="vault-glow-ring inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/12 bg-slate-50 dark:bg-[#090B12] text-slate-700 dark:text-[#CBD5E1] hover:text-slate-950 dark:hover:text-white transition-colors whitespace-nowrap min-h-[40px]"
            >
              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
              Edit
            </button>
            <button
              type="button"
              onClick={() => setConfirmDeleteModOpen(true)}
              className="vault-glow-ring inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border border-red-300 dark:border-red-500/30 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/15 transition-colors whitespace-nowrap min-h-[40px]"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              Trash
            </button>
          </div>
        </div>
      </section>

      {/* Version History */}
      <section className="vault-glass rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-white/8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-950 dark:text-white">Saved Versions</h3>
            <p className="text-xs text-slate-500 dark:text-[#94A3B8] mt-0.5">
              Download any release individually, or check multiple versions to download as one ZIP.
            </p>
          </div>

          {selectedVerIds.size > 0 && (
            <button
              type="button"
              disabled={batchDownloading}
              onClick={() =>
                void onBatchDownloadVersions(
                  Array.from(selectedVerIds),
                  `${slugify(mod.name)}-versions.zip`,
                )
              }
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white min-h-[40px] whitespace-nowrap disabled:opacity-50"
            >
              {batchDownloading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              {batchDownloading
                ? 'Packaging ZIP...'
                : `Download ${selectedVerIds.size} Selected (.zip)`}
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-white/8 text-[11px] font-semibold text-slate-500 dark:text-[#94A3B8] bg-slate-50 dark:bg-[#0B0D13]/60">
                <th className="py-3 pl-4 pr-2 w-10">
                  {sortedVersions.length > 0 && (
                    <button
                      type="button"
                      onClick={toggleAll}
                      aria-label={allSelected ? 'Deselect all versions' : 'Select all versions'}
                      className="p-1.5 text-slate-400 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-white"
                    >
                      {allSelected ? (
                        <CheckSquare className="w-4 h-4 text-[#7C3AED] dark:text-[#A78BFA]" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>
                  )}
                </th>
                <th className="py-3 px-3">Version &amp; File</th>
                <th className="py-3 px-4">Loader &amp; MC</th>
                <th className="py-3 px-4">Checksum</th>
                <th className="py-3 px-4 text-right">Size</th>
                <th className="py-3 px-4 text-right">Uploaded</th>
                <th className="py-3 pl-4 pr-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-white/6 text-xs">
              {sortedVersions.map((ver) => {
                const selected = selectedVerIds.has(ver.id);
                return (
                  <tr
                    key={ver.id}
                    className={`hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors ${
                      selected ? 'bg-[#8B5CF6]/8' : ''
                    }`}
                  >
                    <td className="py-3.5 pl-4 pr-2">
                      <button
                        type="button"
                        onClick={() => toggleOne(ver.id)}
                        aria-label={
                          selected
                            ? `Deselect version ${ver.version_number}`
                            : `Select version ${ver.version_number}`
                        }
                        className="p-1.5 text-slate-400 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-white"
                      >
                        {selected ? (
                          <CheckSquare className="w-4 h-4 text-[#7C3AED] dark:text-[#A78BFA]" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                    </td>

                    <td className="py-3.5 px-3">
                      <p className="font-mono font-semibold text-slate-900 dark:text-white">
                        v{ver.version_number}
                      </p>
                      <p className="font-mono text-[11px] text-slate-500 dark:text-[#94A3B8] mt-0.5">
                        {ver.file_name}
                      </p>
                      {ver.changelog && (
                        <p className="text-[11px] text-slate-600 dark:text-[#CBD5E1] mt-1 max-w-md">
                          {ver.changelog}
                        </p>
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-slate-700 dark:text-[#CBD5E1] whitespace-nowrap">
                      <span>{ver.loader}</span>
                      <span className="mx-1.5 text-slate-400 dark:text-[#64748B]" aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{ver.mc_version}</span>
                    </td>

                    <td className="py-3.5 px-4">
                      <button
                        type="button"
                        onClick={() => handleCopySha(ver.sha256)}
                        className="inline-flex items-center gap-1.5 font-mono text-[11px] text-slate-500 dark:text-[#94A3B8] hover:text-slate-950 dark:hover:text-white transition-colors py-1"
                        title="Copy full SHA-256 checksum"
                      >
                        <span>{ver.sha256.slice(0, 12)}...</span>
                        {copiedSha === ver.sha256 ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                        )}
                      </button>
                    </td>

                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-700 dark:text-[#E2E8F0] whitespace-nowrap">
                      {formatBytes(ver.file_size_bytes)}
                    </td>

                    <td className="py-3.5 px-4 text-right text-slate-500 dark:text-[#94A3B8] whitespace-nowrap">
                      {formatDateTime(ver.created_at)}
                    </td>

                    <td className="py-3.5 pl-4 pr-5">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => onDownloadVersion(ver)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#090B12] text-slate-800 dark:text-white hover:border-[#06B6D4]/60 transition-colors min-h-[40px]"
                        >
                          <Download className="w-3.5 h-3.5 text-[#0891B2] dark:text-[#06B6D4]" aria-hidden="true" />
                          Download
                        </button>

                        <button
                          type="button"
                          onClick={() => setPendingDeleteVer(ver)}
                          aria-label={`Delete version ${ver.version_number}`}
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
      </section>

      {confirmDeleteModOpen && (
        <ConfirmActionModal
          title={`Move "${mod.name}" to Trash?`}
          description="This moves all saved .jar files and icons for this mod to Trash in Google Drive so you can restore or permanently delete them later."
          items={sortedVersions.map((v) => `${v.file_name} (v${v.version_number})`)}
          confirmLabel="Move to Trash"
          busy={deletingBusy}
          onCancel={() => setConfirmDeleteModOpen(false)}
          onConfirm={async () => {
            setDeletingBusy(true);
            try {
              await onDeleteMod(mod);
              setConfirmDeleteModOpen(false);
            } finally {
              setDeletingBusy(false);
            }
          }}
        />
      )}

      {pendingDeleteVer && (
        <ConfirmActionModal
          title={`Move version v${pendingDeleteVer.version_number} to Trash?`}
          description="This moves the .jar file to Trash in Google Drive so you can restore or permanently delete it later."
          items={[`${pendingDeleteVer.file_name} (${formatBytes(pendingDeleteVer.file_size_bytes)})`]}
          confirmLabel="Move to Trash"
          busy={deletingBusy}
          onCancel={() => setPendingDeleteVer(null)}
          onConfirm={async () => {
            setDeletingBusy(true);
            try {
              await onDeleteVersion(pendingDeleteVer);
              setPendingDeleteVer(null);
            } finally {
              setDeletingBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}

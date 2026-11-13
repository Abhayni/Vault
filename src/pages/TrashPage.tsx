import { useCallback, useEffect, useState } from 'react';
import {
  Trash2,
  RotateCcw,
  RefreshCw,
  HardDrive,
  Folder,
  Package,
  FileArchive,
  File as FileIcon,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import type { TrashItem } from '../types/vault';
import { apiRequest, DriveAuthRequiredError } from '../lib/supabase';
import { formatBytes, formatDateTime } from '../lib/format';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { ConfirmActionModal } from '../components/ConfirmActionModal';

interface TrashPageProps {
  accessToken: string;
  driveConnected: boolean;
  googleDriveToken: string | null;
  onEnsureDriveConnected: () => Promise<boolean>;
  onDriveAuthInvalid: (message?: string) => void;
  onRestored: () => Promise<void>;
  onNotify: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}

export function TrashPage({
  accessToken,
  driveConnected,
  googleDriveToken,
  onEnsureDriveConnected,
  onDriveAuthInvalid,
  onRestored,
  onNotify,
}: TrashPageProps) {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingPermanent, setPendingPermanent] = useState<TrashItem | null>(null);
  const [confirmEmptyOpen, setConfirmEmptyOpen] = useState(false);
  const [emptyingBusy, setEmptyingBusy] = useState(false);

  const loadTrash = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ items: TrashItem[]; driveConnected: boolean }>(
        '/api/trash',
        accessToken,
        { method: 'GET' },
        googleDriveToken,
      );
      setItems(Array.isArray(res.items) ? res.items : []);
    } catch (err) {
      if (err instanceof DriveAuthRequiredError) {
        onDriveAuthInvalid(err.message);
      }
      setError(err instanceof Error ? err.message : 'Unable to load Trash items.');
    } finally {
      setLoading(false);
    }
  }, [accessToken, googleDriveToken, onDriveAuthInvalid]);

  useEffect(() => {
    void loadTrash();
  }, [loadTrash, driveConnected]);

  const handleRestore = async (item: TrashItem) => {
    const ready = driveConnected || (await onEnsureDriveConnected());
    if (!ready) return;

    setBusyId(item.trashId);
    try {
      await apiRequest(
        '/api/trash/restore',
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({ trashId: item.trashId }),
        },
        googleDriveToken,
      );
      onNotify('success', 'Restored', `${item.title} has been restored to your vault.`);
      await Promise.all([loadTrash(), onRestored()]);
    } catch (err) {
      if (err instanceof DriveAuthRequiredError) {
        onDriveAuthInvalid(err.message);
      }
      onNotify(
        'error',
        'Restore failed',
        err instanceof Error ? err.message : 'Unable to restore item.',
      );
    } finally {
      setBusyId(null);
    }
  };

  const handlePermanentDelete = async (item: TrashItem) => {
    const ready = driveConnected || (await onEnsureDriveConnected());
    if (!ready) return;

    setEmptyingBusy(true);
    try {
      await apiRequest(
        `/api/trash/${encodeURIComponent(item.trashId)}`,
        accessToken,
        { method: 'DELETE' },
        googleDriveToken,
      );
      setPendingPermanent(null);
      onNotify('success', 'Permanently deleted', `${item.title} was deleted from Google Drive.`);
      await loadTrash();
    } catch (err) {
      if (err instanceof DriveAuthRequiredError) {
        onDriveAuthInvalid(err.message);
      }
      onNotify(
        'error',
        'Delete failed',
        err instanceof Error ? err.message : 'Unable to permanently delete item.',
      );
    } finally {
      setEmptyingBusy(false);
    }
  };

  const handleEmptyTrash = async () => {
    const ready = driveConnected || (await onEnsureDriveConnected());
    if (!ready) return;

    setEmptyingBusy(true);
    try {
      await apiRequest(
        '/api/trash/empty',
        accessToken,
        { method: 'POST' },
        googleDriveToken,
      );
      setConfirmEmptyOpen(false);
      onNotify('success', 'Trash emptied', 'All trashed files have been permanently deleted.');
      await loadTrash();
    } catch (err) {
      if (err instanceof DriveAuthRequiredError) {
        onDriveAuthInvalid(err.message);
      }
      onNotify(
        'error',
        'Empty Trash failed',
        err instanceof Error ? err.message : 'Unable to empty Trash.',
      );
    } finally {
      setEmptyingBusy(false);
    }
  };

  const totalTrashBytes = items.reduce((s, item) => s + (Number(item.sizeBytes) || 0), 0);

  const renderKindIcon = (kind: TrashItem['kind']) => {
    if (kind === 'folder') {
      return <Folder className="w-4 h-4 text-[#0891B2] dark:text-[#06B6D4] shrink-0" aria-hidden="true" />;
    }
    if (kind === 'mod') {
      return <Package className="w-4 h-4 text-[#7C3AED] dark:text-[#8B5CF6] shrink-0" aria-hidden="true" />;
    }
    if (kind === 'version') {
      return <FileArchive className="w-4 h-4 text-[#7C3AED] dark:text-[#A78BFA] shrink-0" aria-hidden="true" />;
    }
    return <FileIcon className="w-4 h-4 text-slate-500 dark:text-[#94A3B8] shrink-0" aria-hidden="true" />;
  };

  return (
    <div className="space-y-6">
      {/* Header Toolbar */}
      <section className="vault-glass rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-slate-950 dark:text-white">
            Deleted Items (Trash)
          </h2>
          <p className="text-xs text-slate-500 dark:text-[#94A3B8] font-mono tabular-nums">
            {items.length} item{items.length === 1 ? '' : 's'} · {formatBytes(totalTrashBytes)} recoverable from Google Drive
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadTrash()}
            className="vault-glow-ring inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/12 bg-slate-50 dark:bg-[#090B12] text-slate-700 dark:text-[#CBD5E1] hover:text-slate-950 dark:hover:text-white min-h-[40px] disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </button>

          {items.length > 0 && (
            <button
              type="button"
              onClick={() => setConfirmEmptyOpen(true)}
              className="vault-glow-ring inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg border border-red-300 dark:border-red-500/40 bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-200 hover:bg-red-100 dark:hover:bg-red-500/25 min-h-[40px]"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              Empty Trash
            </button>
          )}
        </div>
      </section>

      {!driveConnected ? (
        <div className="vault-glass rounded-xl p-10 text-center space-y-4">
          <div className="w-12 h-12 rounded-xl bg-[#06B6D4]/12 dark:bg-[#06B6D4]/15 border border-[#06B6D4]/30 mx-auto flex items-center justify-center">
            <HardDrive className="w-6 h-6 text-[#0891B2] dark:text-[#06B6D4]" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-slate-950 dark:text-white">
              Connect Google Drive to access Trash
            </h3>
            <p className="text-xs text-slate-500 dark:text-[#94A3B8] max-w-md mx-auto">
              Trash recovery metadata and trashed files are stored privately inside your MOD VAULT Google Drive folder.
            </p>
          </div>
          <div className="flex justify-center">
            <GoogleSignInButton
              label="Connect Google Drive"
              onClick={() => void onEnsureDriveConnected()}
            />
          </div>
        </div>
      ) : loading ? (
        <div className="vault-glass rounded-xl p-10 flex flex-col items-center justify-center gap-3 text-xs text-slate-500 dark:text-[#94A3B8]">
          <Loader2 className="w-6 h-6 text-[#8B5CF6] animate-spin" aria-hidden="true" />
          <span>Checking Google Drive Trash...</span>
        </div>
      ) : error ? (
        <div className="vault-glass rounded-xl p-6 border border-red-300 dark:border-red-500/35 bg-red-50 dark:bg-red-500/10 flex items-center gap-3 text-xs text-red-800 dark:text-red-200">
          <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : items.length === 0 ? (
        <div className="vault-glass rounded-xl p-12 text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 mx-auto flex items-center justify-center">
            <Trash2 className="w-6 h-6 text-slate-400 dark:text-[#64748B]" aria-hidden="true" />
          </div>
          <h3 className="text-base font-semibold text-slate-950 dark:text-white">Trash is empty</h3>
          <p className="text-xs text-slate-500 dark:text-[#94A3B8] max-w-md mx-auto">
            Files, folders, and mods you move to Trash appear here so you can restore them anytime or delete them permanently.
          </p>
        </div>
      ) : (
        <div className="vault-glass rounded-xl overflow-hidden">
          <div className="divide-y divide-slate-200 dark:divide-white/6">
            {items.map((item) => {
              const isBusy = busyId === item.trashId;
              return (
                <div
                  key={item.trashId}
                  className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors"
                >
                  <div className="flex items-start sm:items-center gap-3.5 min-w-0">
                    <div className="w-10 h-10 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-[#090B12] flex items-center justify-center shrink-0">
                      {renderKindIcon(item.kind)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                        {item.title}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-[#94A3B8] mt-0.5 truncate">
                        <span className="capitalize">{item.kind}</span>
                        <span className="mx-1.5" aria-hidden="true">·</span>
                        <span>{item.subtitle}</span>
                        <span className="mx-1.5" aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{formatBytes(item.sizeBytes)}</span>
                        <span className="mx-1.5" aria-hidden="true">·</span>
                        <span>Deleted {formatDateTime(item.deletedAt)}</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleRestore(item)}
                      className="vault-glow-ring inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white min-h-[40px] whitespace-nowrap disabled:opacity-50"
                    >
                      {isBusy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                      )}
                      Restore
                    </button>

                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => setPendingPermanent(item)}
                      className="vault-glow-ring inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-red-300 dark:border-red-500/35 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/15 min-h-[40px] whitespace-nowrap disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      Delete Forever
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {pendingPermanent && (
        <ConfirmActionModal
          title={`Permanently delete "${pendingPermanent.title}"?`}
          description="This permanently erases the file(s) from Google Drive and cannot be undone."
          items={[`${pendingPermanent.title} (${formatBytes(pendingPermanent.sizeBytes)})`]}
          confirmLabel="Delete Forever"
          busy={emptyingBusy}
          onCancel={() => setPendingPermanent(null)}
          onConfirm={() => handlePermanentDelete(pendingPermanent)}
        />
      )}

      {confirmEmptyOpen && (
        <ConfirmActionModal
          title={`Empty Trash (${items.length} item${items.length === 1 ? '' : 's'})?`}
          description="Every item in MOD VAULT Trash will be permanently erased from Google Drive. This cannot be undone."
          items={items.map((i) => `${i.title} (${formatBytes(i.sizeBytes)})`)}
          confirmLabel="Empty Trash Permanently"
          busy={emptyingBusy}
          onCancel={() => setConfirmEmptyOpen(false)}
          onConfirm={handleEmptyTrash}
        />
      )}
    </div>
  );
}

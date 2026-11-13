import { useEffect, useMemo, useState } from 'react';
import { Folder, FolderRoot, X, Loader2 } from 'lucide-react';
import type { VaultFolder } from '../types/vault';

interface MoveItemsModalProps {
  title: string;
  folders: VaultFolder[];
  currentFolderId: string | null;
  blockedFolderId?: string | null;
  actionLabel?: string;
  onConfirm: (destinationFolderId: string | null) => Promise<void>;
  onClose: () => void;
}

export function MoveItemsModal({
  title,
  folders,
  currentFolderId,
  blockedFolderId,
  actionLabel = 'Move Here',
  onConfirm,
  onClose,
}: MoveItemsModalProps) {
  const [selectedId, setSelectedId] = useState<string | null>(currentFolderId);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saving, onClose]);

  // Exclude blockedFolderId and all its descendants to prevent circular folder moves
  const blockedSet = useMemo(() => {
    const set = new Set<string>();
    if (!blockedFolderId) return set;
    set.add(blockedFolderId);
    let added = true;
    while (added) {
      added = false;
      for (const f of folders) {
        if (f.parent_id && set.has(f.parent_id) && !set.has(f.id)) {
          set.add(f.id);
          added = true;
        }
      }
    }
    return set;
  }, [folders, blockedFolderId]);

  const flatTree = useMemo(() => {
    const childrenMap = new Map<string | null, VaultFolder[]>();
    for (const f of folders) {
      const key = f.parent_id || null;
      const list = childrenMap.get(key) || [];
      list.push(f);
      childrenMap.set(key, list);
    }
    for (const [, list] of childrenMap) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }

    const ordered: Array<{ folder: VaultFolder; depth: number }> = [];
    const walk = (parentId: string | null, depth: number) => {
      const list = childrenMap.get(parentId) || [];
      for (const f of list) {
        if (!blockedSet.has(f.id)) {
          ordered.push({ folder: f, depth });
          walk(f.id, depth + 1);
        }
      }
    };
    walk(null, 0);
    return ordered;
  }, [folders, blockedSet]);

  const handleConfirm = async () => {
    setSaving(true);
    try {
      await onConfirm(selectedId);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 dark:bg-black/75 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-modal-title"
        className="vault-glass w-full max-w-md rounded-xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-slate-200 dark:border-white/8 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 id="move-modal-title" className="text-sm font-semibold text-slate-900 dark:text-white truncate">
              {title}
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-[#94A3B8] mt-0.5">
              Choose a destination folder below
            </p>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            aria-label="Close move dialog"
            className="p-2 rounded-lg text-slate-500 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 min-h-[40px] min-w-[40px] flex items-center justify-center shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 max-h-80 overflow-y-auto space-y-1">
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium text-left transition-colors min-h-[40px] ${
              selectedId === null
                ? 'bg-[#8B5CF6]/12 dark:bg-[#8B5CF6]/20 text-slate-900 dark:text-white border border-[#8B5CF6]/45 dark:border-[#8B5CF6]/50'
                : 'text-slate-700 dark:text-[#CBD5E1] hover:bg-slate-100 dark:hover:bg-white/5 border border-transparent'
            }`}
          >
            <FolderRoot className="w-4 h-4 text-[#7C3AED] dark:text-[#A78BFA] shrink-0" aria-hidden="true" />
            <span>Vault Root (Home Folder)</span>
          </button>

          {flatTree.map(({ folder, depth }) => (
            <button
              key={folder.id}
              type="button"
              onClick={() => setSelectedId(folder.id)}
              style={{ paddingLeft: `${12 + (depth + 1) * 16}px` }}
              className={`w-full flex items-center gap-2.5 pr-3 py-2.5 rounded-lg text-xs font-medium text-left transition-colors min-h-[40px] ${
                selectedId === folder.id
                  ? 'bg-[#8B5CF6]/12 dark:bg-[#8B5CF6]/20 text-slate-900 dark:text-white border border-[#8B5CF6]/45 dark:border-[#8B5CF6]/50'
                  : 'text-slate-700 dark:text-[#CBD5E1] hover:bg-slate-100 dark:hover:bg-white/5 border border-transparent'
              }`}
            >
              <Folder className="w-4 h-4 text-[#0891B2] dark:text-[#06B6D4] shrink-0" aria-hidden="true" />
              <span className="truncate">{folder.name}</span>
            </button>
          ))}
        </div>

        <div className="px-5 py-3.5 border-t border-slate-200 dark:border-white/8 flex items-center justify-end gap-2.5 bg-slate-50 dark:bg-[#090B12]/60">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 text-slate-700 dark:text-[#CBD5E1] hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 min-h-[40px] whitespace-nowrap"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleConfirm()}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white min-h-[40px] whitespace-nowrap disabled:opacity-60"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
            {actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

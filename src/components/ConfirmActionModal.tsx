import { useEffect } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';

interface ConfirmActionModalProps {
  title: string;
  description: string;
  items?: string[];
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}

export function ConfirmActionModal({
  title,
  description,
  items,
  confirmLabel = 'Confirm',
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmActionModalProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 dark:bg-black/80 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-action-title"
        className="vault-glass w-full max-w-md rounded-xl overflow-hidden border border-slate-200 dark:border-white/12 shadow-2xl"
      >
        <div className="px-5 py-4 border-b border-slate-200 dark:border-white/8 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                danger
                  ? 'bg-red-500/10 dark:bg-red-500/15 border border-red-500/30 dark:border-red-500/35 text-red-600 dark:text-red-400'
                  : 'bg-[#8B5CF6]/10 dark:bg-[#8B5CF6]/15 border border-[#8B5CF6]/30 dark:border-[#8B5CF6]/35 text-[#7C3AED] dark:text-[#A78BFA]'
              }`}
            >
              <AlertTriangle className="w-4 h-4" aria-hidden="true" />
            </div>
            <h2 id="confirm-action-title" className="text-sm font-semibold text-slate-900 dark:text-white truncate">
              {title}
            </h2>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            aria-label="Cancel action"
            className="p-2 rounded-lg text-slate-500 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 min-h-[40px] min-w-[40px] flex items-center justify-center disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-xs sm:text-sm text-slate-600 dark:text-[#CBD5E1] leading-relaxed">{description}</p>

          {items && items.length > 0 && (
            <ul className="max-h-36 overflow-y-auto rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/8 p-3 space-y-1 text-xs font-mono text-slate-700 dark:text-[#E2E8F0]">
              {items.slice(0, 12).map((item, idx) => (
                <li key={`${item}-${idx}`} className="truncate">
                  • {item}
                </li>
              ))}
              {items.length > 12 && (
                <li className="text-slate-500 dark:text-[#94A3B8]">...and {items.length - 12} more item(s)</li>
              )}
            </ul>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-slate-200 dark:border-white/8 flex items-center justify-end gap-2.5 bg-slate-50 dark:bg-[#090B12]/60">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/12 text-slate-700 dark:text-[#CBD5E1] hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 min-h-[40px] whitespace-nowrap disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onConfirm()}
            className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg text-white min-h-[40px] whitespace-nowrap disabled:opacity-60 ${
              danger
                ? 'bg-red-600 hover:bg-red-500'
                : 'bg-[#8B5CF6] hover:bg-[#7C3AED]'
            }`}
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

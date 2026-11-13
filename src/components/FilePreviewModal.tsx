import { useEffect, useState } from 'react';
import { X, Download, Copy, Check, Loader2, AlertCircle, File as FileIcon } from 'lucide-react';
import type { VaultFile } from '../types/vault';
import { apiBlobRequest, DriveAuthRequiredError } from '../lib/supabase';
import { copyText, formatBytes, getPreviewKind } from '../lib/format';
import { GoogleSignInButton } from './GoogleSignInButton';

interface FilePreviewModalProps {
  file: VaultFile;
  accessToken: string;
  driveConnected: boolean;
  googleDriveToken: string | null;
  onConnectDrive: () => Promise<boolean>;
  onDriveAuthInvalid?: (message?: string) => void;
  onClose: () => void;
  onDownload: (file: VaultFile) => Promise<void>;
}

const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024; // 2 MB

export function FilePreviewModal({
  file,
  accessToken,
  driveConnected,
  googleDriveToken,
  onConnectDrive,
  onDriveAuthInvalid,
  onClose,
  onDownload,
}: FilePreviewModalProps) {
  const previewKind = getPreviewKind(file.file_extension, file.mime_type);
  const [loading, setLoading] = useState(true);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [needsDriveAuth, setNeedsDriveAuth] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let active = true;
    let createdObjectUrl: string | null = null;

    const loadPreview = async () => {
      setLoading(true);
      setError(null);
      setNeedsDriveAuth(false);
      setTextContent(null);
      setObjectUrl(null);

      if (!driveConnected && !googleDriveToken) {
        setNeedsDriveAuth(true);
        setLoading(false);
        return;
      }

      if (previewKind === 'text' && file.file_size_bytes > MAX_TEXT_PREVIEW_BYTES) {
        setError('This text file is over 2 MB. Download it to view it on your device.');
        setLoading(false);
        return;
      }

      try {
        const { blob } = await apiBlobRequest(
          `/api/vault/files/${encodeURIComponent(file.id)}/download`,
          accessToken,
          googleDriveToken,
          {
            method: 'POST',
            body: JSON.stringify({ mode: 'inline' }),
          },
        );

        if (!active) return;

        if (previewKind === 'text') {
          const content = await blob.text();
          if (!active) return;
          setTextContent(content);
        } else {
          createdObjectUrl = URL.createObjectURL(blob);
          setObjectUrl(createdObjectUrl);
        }
      } catch (err) {
        if (!active) return;
        if (err instanceof DriveAuthRequiredError) {
          onDriveAuthInvalid?.(err.message);
          setNeedsDriveAuth(true);
        } else {
          setError(err instanceof Error ? err.message : 'Unable to load preview.');
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    if (previewKind) {
      void loadPreview();
    } else {
      setLoading(false);
    }

    return () => {
      active = false;
      if (createdObjectUrl) {
        URL.revokeObjectURL(createdObjectUrl);
      }
    };
  }, [
    file.id,
    file.file_size_bytes,
    accessToken,
    driveConnected,
    googleDriveToken,
    previewKind,
    onDriveAuthInvalid,
  ]);

  const handleCopyText = async () => {
    if (!textContent) return;
    const ok = await copyText(textContent);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/55 dark:bg-black/80 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="preview-modal-title"
        className="vault-glass w-full max-w-4xl max-h-[88vh] rounded-xl overflow-hidden flex flex-col"
      >
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-white/8 flex items-center justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <h2 id="preview-modal-title" className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white truncate">
              {file.name}
            </h2>
            <p className="text-xs font-mono tabular-nums text-slate-500 dark:text-[#94A3B8] truncate">
              {file.file_extension || 'file'} · {formatBytes(file.file_size_bytes)}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {textContent !== null && (
              <button
                type="button"
                onClick={handleCopyText}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#090B12] text-slate-800 dark:text-white hover:border-[#8B5CF6]/50 min-h-[40px] whitespace-nowrap"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    Copy Text
                  </>
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => void onDownload(file)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white min-h-[40px] whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              Download
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close preview"
              className="p-2 rounded-lg text-slate-500 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 min-h-[40px] min-w-[40px] flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-5 bg-slate-50 dark:bg-[#090B12]">
          {loading ? (
            <div className="h-64 flex flex-col items-center justify-center gap-2 text-xs text-slate-500 dark:text-[#94A3B8]">
              <Loader2 className="w-6 h-6 text-[#7C3AED] dark:text-[#A78BFA] animate-spin" aria-hidden="true" />
              <span>Loading preview from Google Drive...</span>
            </div>
          ) : needsDriveAuth ? (
            <div className="h-64 flex flex-col items-center justify-center gap-3 text-center max-w-md mx-auto">
              <AlertCircle className="w-7 h-7 text-[#0891B2] dark:text-[#06B6D4]" aria-hidden="true" />
              <p className="text-xs sm:text-sm text-slate-600 dark:text-[#CBD5E1]">
                Connect your Google Drive account to view a private preview of this file.
              </p>
              <GoogleSignInButton
                label="Connect Google Drive"
                onClick={() => void onConnectDrive()}
              />
            </div>
          ) : error ? (
            <div className="h-64 flex flex-col items-center justify-center gap-3 text-center max-w-md mx-auto">
              <AlertCircle className="w-7 h-7 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <p className="text-xs sm:text-sm text-slate-700 dark:text-[#CBD5E1]">{error}</p>
            </div>
          ) : previewKind === 'image' && objectUrl ? (
            <div className="flex items-center justify-center min-h-[300px]">
              <img
                src={objectUrl}
                alt={file.name}
                className="max-w-full max-h-[68vh] rounded-lg border border-slate-200 dark:border-white/10 object-contain"
              />
            </div>
          ) : previewKind === 'pdf' && objectUrl ? (
            <iframe
              src={objectUrl}
              title={file.name}
              className="w-full h-[68vh] rounded-lg border border-slate-200 dark:border-white/10 bg-white"
            />
          ) : previewKind === 'text' && textContent !== null ? (
            <pre className="text-xs font-mono text-slate-800 dark:text-[#E2E8F0] whitespace-pre-wrap break-words leading-relaxed">
              {textContent}
            </pre>
          ) : (
            <div className="h-64 flex flex-col items-center justify-center gap-3 text-center">
              <FileIcon className="w-8 h-8 text-slate-400 dark:text-[#64748B]" aria-hidden="true" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  Preview is not available for {file.file_extension || 'this file type'}
                </p>
                <p className="text-xs font-mono text-slate-500 dark:text-[#94A3B8] max-w-md break-all">
                  SHA-256: {file.sha256}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void onDownload(file)}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white min-h-[40px]"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                Download File
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

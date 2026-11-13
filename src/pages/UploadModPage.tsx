import { useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import {
  Upload,
  FolderUp,
  FileArchive,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Loader2,
  X,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import type {
  Category,
  ModLoader,
  ModRecord,
  UploadAuthorization,
  VaultConfigStatus,
  VaultFolder,
} from '../types/vault';
import { inspectJarFile } from '../lib/jar-inspector';
import {
  apiRequest,
  DriveAuthRequiredError,
  uploadToGoogleDriveResumable,
} from '../lib/supabase';
import { computeSha256Blob, formatBytes, guessMimeType } from '../lib/format';
import { collectDroppedItems, extractZipSafely } from '../lib/archive-tools';

interface UploadModPageProps {
  mods: ModRecord[];
  categories: Category[];
  folders: VaultFolder[];
  config: VaultConfigStatus | null;
  accessToken: string;
  driveConnected: boolean;
  googleDriveToken: string | null;
  onEnsureDriveConnected: () => Promise<boolean>;
  onDriveAuthInvalid: (message?: string) => void;
  initialTargetModId?: string | null;
  defaultAutoUnzip?: boolean;
  onUploadComplete: (modId: string) => Promise<void>;
  onFilesUploaded: () => Promise<void>;
  onNotify: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}

type QueueStatus = 'queued' | 'uploading' | 'done' | 'cancelled' | 'error';

interface QueueEntry {
  id: string;
  fileName: string;
  folderSegments: string[];
  blob: Blob;
  mimeType: string;
  status: QueueStatus;
  progress: number;
  loadedBytes: number;
  error?: string;
}

const LOADERS: ModLoader[] = ['Fabric', 'Forge', 'NeoForge', 'Quilt'];

export function UploadModPage({
  mods,
  categories,
  folders,
  config,
  accessToken,
  driveConnected,
  googleDriveToken,
  onEnsureDriveConnected,
  onDriveAuthInvalid,
  initialTargetModId,
  defaultAutoUnzip = false,
  onUploadComplete,
  onFilesUploaded,
  onNotify,
}: UploadModPageProps) {
  const maxUploadMb = config?.maxUploadMb || 5120;
  const maxUploadBytes = maxUploadMb * 1024 * 1024;
  const allowedExtensions = config?.allowedExtensions || ['*'];

  const [centerMode, setCenterMode] = useState<'files' | 'mod'>(
    initialTargetModId ? 'mod' : 'files',
  );

  // ---------------- Files & Folders Queue State ----------------
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [destFolderId, setDestFolderId] = useState<string>('');
  const [extractZips, setExtractZips] = useState(defaultAutoUnzip);
  const [filesDragging, setFilesDragging] = useState(false);
  const [queueRunning, setQueueRunning] = useState(false);
  const activeControllersRef = useRef<Map<string, AbortController>>(new Map());
  const filesInputRef = useRef<HTMLInputElement | null>(null);
  const foldersInputRef = useRef<HTMLInputElement | null>(null);

  const folderOptions = useMemo(() => {
    const childrenMap = new Map<string | null, VaultFolder[]>();
    for (const f of folders) {
      const k = f.parent_id || null;
      const list = childrenMap.get(k) || [];
      list.push(f);
      childrenMap.set(k, list);
    }
    for (const [, list] of childrenMap) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    const out: Array<{ id: string; label: string }> = [];
    const walk = (parentId: string | null, prefix: string) => {
      for (const f of childrenMap.get(parentId) || []) {
        const label = prefix ? `${prefix} / ${f.name}` : f.name;
        out.push({ id: f.id, label });
        walk(f.id, label);
      }
    };
    walk(null, '');
    return out;
  }, [folders]);

  const validateFile = (name: string, size: number): string | null => {
    if (size <= 0) return 'File is empty (0 bytes).';
    if (size > maxUploadBytes) return `Exceeds max upload limit (${maxUploadMb} MB).`;
    if (!allowedExtensions.includes('*')) {
      const dot = name.lastIndexOf('.');
      const ext = dot > 0 ? name.slice(dot).toLowerCase() : '';
      if (!ext || !allowedExtensions.includes(ext)) {
        return 'File type is restricted by server config.';
      }
    }
    return null;
  };

  const enqueueRawItems = async (
    raw: Array<{ fileName: string; folderSegments: string[]; blob: Blob; mimeType: string }>,
  ) => {
    const entries: QueueEntry[] = [];

    for (const item of raw) {
      if (extractZips && item.fileName.toLowerCase().endsWith('.zip')) {
        const zipStem = item.fileName.replace(/\.zip$/i, '').trim() || 'extracted';
        try {
          const { entries: zipEntries } = await extractZipSafely(item.blob, {
            maxFileBytes: maxUploadBytes,
          });
          for (const ze of zipEntries) {
            const err = validateFile(ze.fileName, ze.blob.size);
            entries.push({
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              fileName: ze.fileName,
              folderSegments: [...item.folderSegments, zipStem, ...ze.folderSegments],
              blob: ze.blob,
              mimeType: ze.mimeType,
              status: err ? 'error' : 'queued',
              progress: 0,
              loadedBytes: 0,
              error: err || undefined,
            });
          }
        } catch (err) {
          entries.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            fileName: item.fileName,
            folderSegments: item.folderSegments,
            blob: item.blob,
            mimeType: item.mimeType,
            status: 'error',
            progress: 0,
            loadedBytes: 0,
            error: err instanceof Error ? err.message : 'Unable to unzip archive.',
          });
        }
      } else {
        const err = validateFile(item.fileName, item.blob.size);
        entries.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          fileName: item.fileName,
          folderSegments: item.folderSegments,
          blob: item.blob,
          mimeType: item.mimeType,
          status: err ? 'error' : 'queued',
          progress: 0,
          loadedBytes: 0,
          error: err || undefined,
        });
      }
    }

    if (entries.length > 0) {
      setQueue((prev) => [...prev, ...entries]);
    }
  };

  const handleQueueFilesSelected = async (list: FileList | null, preservePath: boolean) => {
    if (!list || list.length === 0) return;
    const raw = Array.from(list).map((f) => {
      let folderSegments: string[] = [];
      if (preservePath && f.webkitRelativePath) {
        folderSegments = f.webkitRelativePath.split('/').filter(Boolean).slice(0, -1);
      }
      return {
        fileName: f.name,
        folderSegments,
        blob: f,
        mimeType: guessMimeType(f.name, f.type),
      };
    });
    await enqueueRawItems(raw);
  };

  const handleQueueDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setFilesDragging(false);
    try {
      const dropped = await collectDroppedItems(e.dataTransfer);
      await enqueueRawItems(
        dropped.map((d) => ({
          fileName: d.file.name,
          folderSegments: d.folderSegments,
          blob: d.file,
          mimeType: guessMimeType(d.file.name, d.file.type),
        })),
      );
    } catch (err) {
      onNotify(
        'error',
        'Drop failed',
        err instanceof Error ? err.message : 'Unable to read dropped items.',
      );
    }
  };

  const runQueue = async (targetIds?: Set<string>) => {
    const itemsToUpload = queue.filter((item) =>
      targetIds ? targetIds.has(item.id) : item.status === 'queued',
    );
    if (itemsToUpload.length === 0) return;

    const ready = driveConnected || (await onEnsureDriveConnected());
    if (!ready) return;

    setQueueRunning(true);
    const baseFolderId = destFolderId || null;
    const folderCache = new Map<string, string | null>();
    folderCache.set('', baseFolderId);
    let succeededCount = 0;

    for (const item of itemsToUpload) {
      const controller = new AbortController();
      activeControllersRef.current.set(item.id, controller);

      setQueue((prev) =>
        prev.map((q) =>
          q.id === item.id
            ? { ...q, status: 'uploading', progress: 0, loadedBytes: 0, error: undefined }
            : q,
        ),
      );

      try {
        const pathKey = item.folderSegments.join('/');
        let targetFolderId = folderCache.get(pathKey);
        if (targetFolderId === undefined) {
          const ensured = await apiRequest<{ folderId: string | null }>(
            '/api/vault/folders/ensure-path',
            accessToken,
            {
              method: 'POST',
              body: JSON.stringify({
                parentId: baseFolderId,
                segments: item.folderSegments,
              }),
            },
            googleDriveToken,
          );
          targetFolderId = ensured.folderId;
          folderCache.set(pathKey, targetFolderId);
        }

        const sha256 = await computeSha256Blob(item.blob);
        const authz = await apiRequest<UploadAuthorization>(
          '/api/uploads/authorize',
          accessToken,
          {
            method: 'POST',
            body: JSON.stringify({
              kind: 'vault_file',
              fileName: item.fileName,
              mimeType: item.mimeType || 'application/octet-stream',
              fileSizeBytes: item.blob.size,
              sha256,
              folderId: targetFolderId,
            }),
          },
          googleDriveToken,
        );

        const uploaded = await uploadToGoogleDriveResumable({
          authz,
          file: item.blob,
          contentType: item.mimeType || 'application/octet-stream',
          accessToken,
          signal: controller.signal,
          onProgress: (loaded, _total, pct) => {
            setQueue((prev) =>
              prev.map((q) =>
                q.id === item.id ? { ...q, progress: pct, loadedBytes: loaded } : q,
              ),
            );
          },
        });

        await apiRequest(
          '/api/vault/files',
          accessToken,
          {
            method: 'POST',
            body: JSON.stringify({
              folderId: targetFolderId,
              name: item.fileName,
              mimeType: item.mimeType,
              driveFileId: uploaded.driveFileId,
              driveParentId: authz.driveParentId,
              fileSizeBytes: item.blob.size,
              sha256,
            }),
          },
          googleDriveToken,
        );

        succeededCount += 1;
        setQueue((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? { ...q, status: 'done', progress: 100, loadedBytes: item.blob.size }
              : q,
          ),
        );
      } catch (err) {
        const isCancelled = err instanceof DOMException && err.name === 'AbortError';
        if (err instanceof DriveAuthRequiredError) {
          onDriveAuthInvalid(err.message);
        }
        setQueue((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? {
                  ...q,
                  status: isCancelled ? 'cancelled' : 'error',
                  error: isCancelled
                    ? 'Cancelled'
                    : err instanceof Error
                      ? err.message
                      : 'Upload failed.',
                }
              : q,
          ),
        );
      } finally {
        activeControllersRef.current.delete(item.id);
      }
    }

    setQueueRunning(false);
    if (succeededCount > 0) {
      onNotify(
        'success',
        'Upload batch complete',
        `${succeededCount} file${succeededCount === 1 ? '' : 's'} saved to Google Drive.`,
      );
      await onFilesUploaded();
    }
  };

  const handleCancelQueueItem = (entry: QueueEntry) => {
    const controller = activeControllersRef.current.get(entry.id);
    if (controller) {
      controller.abort();
    } else if (entry.status === 'queued') {
      setQueue((prev) =>
        prev.map((q) => (q.id === entry.id ? { ...q, status: 'cancelled', error: 'Cancelled' } : q)),
      );
    }
  };

  const handleRetryQueueItem = (entry: QueueEntry) => {
    const idSet = new Set([entry.id]);
    void runQueue(idSet);
  };

  const handleRemoveQueueItem = (id: string) => {
    const controller = activeControllersRef.current.get(id);
    if (controller) controller.abort();
    setQueue((prev) => prev.filter((q) => q.id !== id));
  };

  // ---------------- Minecraft Mod (.jar) State ----------------
  const [uploadMode, setUploadMode] = useState<'new' | 'version'>(
    initialTargetModId ? 'version' : 'new',
  );
  const [targetModId, setTargetModId] = useState<string>(initialTargetModId || mods[0]?.id || '');

  const [jarFile, setJarFile] = useState<File | null>(null);
  const [sha256, setSha256] = useState<string>('');
  const [manifestSource, setManifestSource] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [dragging, setDragging] = useState(false);

  const [name, setName] = useState('');
  const [versionNumber, setVersionNumber] = useState('');
  const [mcVersion, setMcVersion] = useState('1.21.1');
  const [loader, setLoader] = useState<ModLoader>('Fabric');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [changelog, setChangelog] = useState('');

  const [thumbBlob, setThumbBlob] = useState<Blob | null>(null);
  const [thumbName, setThumbName] = useState<string>('icon.png');
  const [thumbPreview, setThumbPreview] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const modAbortRef = useRef<AbortController | null>(null);
  const [stageText, setStageText] = useState<string>('');
  const [progressPct, setProgressPct] = useState<number>(0);
  const [uploadedBytes, setUploadedBytes] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const clearSelectedJar = () => {
    setJarFile(null);
    setSha256('');
    setManifestSource(null);
    setErrorMsg(null);
  };

  const handleSelectedFile = async (file: File | null) => {
    setErrorMsg(null);
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.jar')) {
      setErrorMsg('Please choose a Minecraft .jar file (or use Files & Folders Queue above).');
      return;
    }
    if (file.size <= 0 || file.size > maxUploadBytes) {
      setErrorMsg(`File size must be under ${maxUploadMb} MB.`);
      return;
    }

    setJarFile(file);
    setInspecting(true);
    try {
      const parsed = await inspectJarFile(file);
      setSha256(parsed.sha256);
      setManifestSource(parsed.sourceFile);
      if (uploadMode === 'new') {
        setName(parsed.name);
        setDescription(parsed.description);
      }
      setVersionNumber(parsed.versionNumber);
      setMcVersion(parsed.mcVersion);
      setLoader(parsed.loader);

      if (parsed.iconBlob && parsed.iconPreviewUrl && uploadMode === 'new') {
        setThumbBlob(parsed.iconBlob);
        setThumbName('mod-icon.png');
        setThumbPreview(parsed.iconPreviewUrl);
      }
    } finally {
      setInspecting(false);
    }
  };

  const handleModSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!jarFile || !sha256) {
      setErrorMsg('Please select a .jar file first.');
      return;
    }
    if (uploadMode === 'new' && !name.trim()) {
      setErrorMsg('Please enter a name for this mod.');
      return;
    }
    if (uploadMode === 'version' && !targetModId) {
      setErrorMsg('Please choose which existing mod this version belongs to.');
      return;
    }

    const ready = driveConnected || (await onEnsureDriveConnected());
    if (!ready) {
      setErrorMsg('Please connect Google Drive before uploading.');
      return;
    }

    const controller = new AbortController();
    modAbortRef.current = controller;
    setUploading(true);
    setProgressPct(0);
    setUploadedBytes(0);

    try {
      setStageText('Preparing private upload...');
      const jarAuthz = await apiRequest<UploadAuthorization>(
        '/api/uploads/authorize',
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({
            kind: 'jar',
            fileName: jarFile.name,
            mimeType: 'application/java-archive',
            fileSizeBytes: jarFile.size,
            sha256,
            ...(uploadMode === 'version' ? { modId: targetModId } : {}),
            versionNumber: versionNumber.trim(),
            mcVersion: mcVersion.trim(),
            loader,
          }),
        },
        googleDriveToken,
      );

      setStageText('Uploading .jar to your Google Drive...');
      const jarUpload = await uploadToGoogleDriveResumable({
        authz: jarAuthz,
        file: jarFile,
        contentType: 'application/java-archive',
        accessToken,
        signal: controller.signal,
        onProgress: (loaded, _total, pct) => {
          setUploadedBytes(loaded);
          setProgressPct(pct);
        },
      });

      let uploadedThumbDriveId: string | null = null;
      if (uploadMode === 'new' && thumbBlob) {
        setStageText('Saving mod icon...');
        const thumbAuthz = await apiRequest<UploadAuthorization>(
          '/api/uploads/authorize',
          accessToken,
          {
            method: 'POST',
            body: JSON.stringify({
              kind: 'thumbnail',
              fileName: thumbName,
              mimeType: thumbBlob.type || 'image/png',
              fileSizeBytes: thumbBlob.size,
            }),
          },
          googleDriveToken,
        );
        const thumbUpload = await uploadToGoogleDriveResumable({
          authz: thumbAuthz,
          file: thumbBlob,
          contentType: thumbBlob.type || 'image/png',
          accessToken,
          signal: controller.signal,
          onProgress: () => undefined,
        });
        uploadedThumbDriveId = thumbUpload.driveFileId;
      }

      setStageText('Saving mod info...');
      let resultingModId = targetModId;

      if (uploadMode === 'new') {
        const res = await apiRequest<{ mod: { id: string } }>(
          '/api/mods',
          accessToken,
          {
            method: 'POST',
            body: JSON.stringify({
              name: name.trim(),
              description: description.trim(),
              categoryId: categoryId || null,
              loader,
              mcVersion: mcVersion.trim(),
              versionNumber: versionNumber.trim(),
              fileName: jarFile.name,
              mimeType: 'application/java-archive',
              driveFileId: jarUpload.driveFileId,
              driveParentId: jarAuthz.driveParentId,
              fileSizeBytes: jarFile.size,
              sha256,
              changelog: changelog.trim(),
              thumbnailDriveId: uploadedThumbDriveId,
            }),
          },
          googleDriveToken,
        );
        resultingModId = res.mod.id;
      } else {
        await apiRequest(
          `/api/mods/${encodeURIComponent(targetModId)}/versions`,
          accessToken,
          {
            method: 'POST',
            body: JSON.stringify({
              loader,
              mcVersion: mcVersion.trim(),
              versionNumber: versionNumber.trim(),
              fileName: jarFile.name,
              mimeType: 'application/java-archive',
              driveFileId: jarUpload.driveFileId,
              driveParentId: jarAuthz.driveParentId,
              fileSizeBytes: jarFile.size,
              sha256,
              changelog: changelog.trim(),
            }),
          },
          googleDriveToken,
        );
      }

      onNotify('success', 'Mod uploaded', `${jarFile.name} is saved in your private Google Drive.`);
      await onUploadComplete(resultingModId);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setErrorMsg('Upload cancelled. Click "Save to Google Drive" to retry.');
        onNotify('info', 'Upload cancelled', jarFile.name);
      } else {
        if (err instanceof DriveAuthRequiredError) {
          onDriveAuthInvalid(err.message);
        }
        const msg = err instanceof Error ? err.message : 'Upload failed.';
        setErrorMsg(msg);
        onNotify('error', 'Upload failed', msg);
      }
    } finally {
      modAbortRef.current = null;
      setUploading(false);
      setStageText('');
    }
  };

  const queuedCount = queue.filter((q) => q.status === 'queued').length;
  const failedOrCancelledCount = queue.filter(
    (q) => q.status === 'error' || q.status === 'cancelled',
  ).length;
  const doneCount = queue.filter((q) => q.status === 'done').length;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Unified Center Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-slate-900 dark:text-white">Upload Center</h2>
          <p className="text-xs text-slate-500 dark:text-[#94A3B8] mt-1">
            Upload files, folders, archives (.zip, .jar, .rar, .7z, .mrpack), or auto-parsed Minecraft mods straight to Google Drive.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#151925] border border-slate-200 dark:border-white/10">
          <button
            type="button"
            onClick={() => setCenterMode('files')}
            className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap min-h-[38px] ${
              centerMode === 'files'
                ? 'bg-[#8B5CF6] text-white'
                : 'text-slate-500 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Files &amp; Folders Queue
          </button>
          <button
            type="button"
            onClick={() => setCenterMode('mod')}
            className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap min-h-[38px] ${
              centerMode === 'mod'
                ? 'bg-[#8B5CF6] text-white'
                : 'text-slate-500 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Minecraft Mod (.jar)
          </button>
        </div>
      </div>

      {centerMode === 'files' ? (
        <div className="space-y-5">
          <input
            ref={filesInputRef}
            type="file"
            multiple
            className="sr-only"
            onChange={(e) => {
              void handleQueueFilesSelected(e.target.files, false);
              e.target.value = '';
            }}
          />
          <input
            ref={foldersInputRef}
            type="file"
            multiple
            // @ts-expect-error webkitdirectory supported on Chromium/Firefox/Safari
            webkitdirectory=""
            directory=""
            className="sr-only"
            onChange={(e) => {
              void handleQueueFilesSelected(e.target.files, true);
              e.target.value = '';
            }}
          />

          {/* Destination & Options */}
          <div className="vault-glass rounded-xl p-5 grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
            <div>
              <label htmlFor="dest-folder" className="block text-xs font-medium text-slate-700 dark:text-[#CBD5E1] mb-1.5">
                Destination Folder in Vault
              </label>
              <select
                id="dest-folder"
                disabled={queueRunning}
                value={destFolderId}
                onChange={(e) => setDestFolderId(e.target.value)}
                className="vault-glow-ring w-full px-3.5 py-2 text-xs rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white min-h-[40px]"
              >
                <option value="">Vault Home (Root)</option>
                {folderOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <label className="inline-flex items-center gap-2.5 cursor-pointer text-xs text-slate-700 dark:text-[#CBD5E1] min-h-[40px]">
              <input
                type="checkbox"
                disabled={queueRunning}
                checked={extractZips}
                onChange={(e) => setExtractZips(e.target.checked)}
                className="rounded border-slate-300 dark:border-white/20 bg-white dark:bg-[#090B12] text-[#8B5CF6]"
              />
              <span>Automatically extract .zip archives into folders</span>
            </label>
          </div>

          {/* Drag & Drop Multi-File / Folder Dropzone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setFilesDragging(true);
            }}
            onDragLeave={() => setFilesDragging(false)}
            onDrop={(e) => void handleQueueDrop(e)}
            className={`vault-glass rounded-xl p-8 border-2 border-dashed transition-colors text-center ${
              filesDragging
                ? 'border-[#0891B2] dark:border-[#06B6D4] bg-[#06B6D4]/10'
                : 'border-slate-300 dark:border-white/12 hover:border-[#8B5CF6]/50'
            }`}
          >
            <div className="w-12 h-12 rounded-xl bg-[#8B5CF6]/10 dark:bg-[#8B5CF6]/15 border border-[#8B5CF6]/30 dark:border-[#8B5CF6]/35 mx-auto flex items-center justify-center mb-3">
              <Upload className="w-6 h-6 text-[#7C3AED] dark:text-[#A78BFA]" aria-hidden="true" />
            </div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              Drag &amp; drop multiple files or entire folders here
            </p>
            <p className="text-xs text-slate-500 dark:text-[#94A3B8] mt-1">
              Supports .jar, .zip, .rar, .7z, .mrpack, .schematic, .json, .txt, images, PDFs &amp; any file up to {maxUploadMb} MB
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={() => filesInputRef.current?.click()}
                className="vault-glow-ring inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white min-h-[40px]"
              >
                <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                Select Files
              </button>
              <button
                type="button"
                onClick={() => foldersInputRef.current?.click()}
                className="vault-glow-ring inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/12 bg-white dark:bg-[#090B12] text-slate-800 dark:text-white hover:border-[#0891B2]/60 dark:hover:border-[#06B6D4]/60 min-h-[40px]"
              >
                <FolderUp className="w-3.5 h-3.5 text-[#0891B2] dark:text-[#06B6D4]" aria-hidden="true" />
                Select Folder
              </button>
            </div>
          </div>

          {/* Upload Queue Panel */}
          {queue.length > 0 && (
            <section className="vault-glass rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 dark:border-white/8 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Upload Queue ({queue.length})
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-[#94A3B8] font-mono tabular-nums mt-0.5">
                    {queuedCount} queued · {doneCount} uploaded
                    {failedOrCancelledCount > 0 ? ` · ${failedOrCancelledCount} failed/cancelled` : ''}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {failedOrCancelledCount > 0 && !queueRunning && (
                    <button
                      type="button"
                      onClick={() =>
                        void runQueue(
                          new Set(
                            queue
                              .filter((q) => q.status === 'error' || q.status === 'cancelled')
                              .map((q) => q.id),
                          ),
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-amber-500/35 text-amber-700 dark:text-amber-200 hover:bg-amber-500/10 dark:hover:bg-amber-400/15 min-h-[38px]"
                    >
                      <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                      Retry All Failed
                    </button>
                  )}

                  {doneCount > 0 && !queueRunning && (
                    <button
                      type="button"
                      onClick={() => setQueue((prev) => prev.filter((q) => q.status !== 'done'))}
                      className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 text-slate-700 dark:text-[#CBD5E1] hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 min-h-[38px]"
                    >
                      Clear Completed
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={queueRunning || queuedCount === 0}
                    onClick={() => void runQueue()}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white min-h-[38px] disabled:opacity-50"
                  >
                    {queueRunning ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    {queueRunning
                      ? 'Uploading...'
                      : `Start Upload (${queuedCount})`}
                  </button>
                </div>
              </div>

              <div className="divide-y divide-slate-200 dark:divide-white/6 max-h-[420px] overflow-y-auto">
                {queue.map((item) => (
                  <div key={item.id} className="px-5 py-3.5 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-slate-900 dark:text-white truncate">
                          {item.folderSegments.length > 0
                            ? `${item.folderSegments.join('/')}/${item.fileName}`
                            : item.fileName}
                        </p>
                        <p className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-[#94A3B8] mt-0.5">
                          {formatBytes(item.loadedBytes)} / {formatBytes(item.blob.size)}
                          {item.status === 'done' && (
                            <span className="text-emerald-600 dark:text-emerald-400"> · Saved to Google Drive</span>
                          )}
                          {item.status === 'uploading' && (
                            <span className="text-[#0891B2] dark:text-[#06B6D4]"> · {item.progress}%</span>
                          )}
                          {item.error && (
                            <span className="text-red-600 dark:text-red-300"> · {item.error}</span>
                          )}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {(item.status === 'uploading' || item.status === 'queued') && (
                          <button
                            type="button"
                            onClick={() => handleCancelQueueItem(item)}
                            className="px-2.5 py-1.5 text-[11px] font-medium rounded-lg border border-slate-200 dark:border-white/10 text-slate-700 dark:text-[#CBD5E1] hover:text-red-600 dark:hover:text-red-300 min-h-[34px]"
                          >
                            Cancel
                          </button>
                        )}
                        {(item.status === 'error' || item.status === 'cancelled') && !queueRunning && (
                          <button
                            type="button"
                            onClick={() => handleRetryQueueItem(item)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-lg border border-[#0891B2]/40 dark:border-[#06B6D4]/40 text-[#0891B2] dark:text-[#06B6D4] hover:bg-[#06B6D4]/10 min-h-[34px]"
                          >
                            <RotateCcw className="w-3 h-3" aria-hidden="true" />
                            Retry
                          </button>
                        )}
                        {item.status !== 'uploading' && (
                          <button
                            type="button"
                            onClick={() => handleRemoveQueueItem(item.id)}
                            aria-label={`Remove ${item.fileName} from queue`}
                            className="p-1.5 rounded-lg text-slate-400 dark:text-[#64748B] hover:text-slate-900 dark:hover:text-white min-h-[34px] min-w-[34px] flex items-center justify-center"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {(item.status === 'uploading' || item.status === 'done') && (
                      <div className="h-1.5 rounded-full bg-slate-200 dark:bg-[#090B12] overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-150 ${
                            item.status === 'done'
                              ? 'bg-emerald-500 dark:bg-emerald-400'
                              : 'bg-gradient-to-r from-[#8B5CF6] to-[#06B6D4]'
                          }`}
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      ) : (
        /* Minecraft Mod (.jar) Mode */
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-xs text-slate-500 dark:text-[#94A3B8]">
              Drop a .jar file to automatically read its name, version, loader, and icon.
            </p>
            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#151925] border border-slate-200 dark:border-white/8">
              <button
                type="button"
                onClick={() => setUploadMode('new')}
                className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap min-h-[38px] ${
                  uploadMode === 'new'
                    ? 'bg-[#8B5CF6] text-white'
                    : 'text-slate-500 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                New Mod
              </button>
              <button
                type="button"
                disabled={mods.length === 0}
                onClick={() => {
                  setUploadMode('version');
                  if (!targetModId && mods[0]) setTargetModId(mods[0].id);
                }}
                className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap min-h-[38px] disabled:opacity-40 ${
                  uploadMode === 'version'
                    ? 'bg-[#8B5CF6] text-white'
                    : 'text-slate-500 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Update Existing Mod
              </button>
            </div>
          </div>

          <section className="space-y-2">
            <p className="text-xs font-semibold text-slate-700 dark:text-[#CBD5E1]">
              Step 1 · Choose your .jar file
            </p>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void handleSelectedFile(e.dataTransfer.files?.[0] || null);
              }}
              className={`vault-glass rounded-xl p-7 sm:p-8 border-2 border-dashed transition-colors text-center ${
                dragging
                  ? 'border-[#8B5CF6] bg-[#8B5CF6]/10'
                  : jarFile
                    ? 'border-emerald-500/45 dark:border-emerald-500/40 bg-emerald-500/[0.04]'
                    : 'border-slate-300 dark:border-white/12 hover:border-[#8B5CF6]/45'
              }`}
            >
              <div className="w-12 h-12 rounded-xl bg-[#8B5CF6]/10 dark:bg-[#8B5CF6]/15 border border-[#8B5CF6]/30 dark:border-[#8B5CF6]/35 mx-auto flex items-center justify-center mb-3">
                {inspecting ? (
                  <Loader2 className="w-6 h-6 text-[#7C3AED] dark:text-[#A78BFA] animate-spin" aria-hidden="true" />
                ) : (
                  <FileArchive className="w-6 h-6 text-[#7C3AED] dark:text-[#A78BFA]" aria-hidden="true" />
                )}
              </div>

              {jarFile ? (
                <div className="space-y-1.5">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">{jarFile.name}</p>
                  <p className="text-xs font-mono tabular-nums text-slate-500 dark:text-[#94A3B8]">
                    {formatBytes(jarFile.size)}
                  </p>
                  {manifestSource && (
                    <p className="inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300 mt-1">
                      <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                      Details filled automatically from {manifestSource}
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    Drag and drop a .jar file here
                  </p>
                  <p className="text-xs text-slate-500 dark:text-[#94A3B8]">
                    Works with Fabric, Forge, NeoForge, and Quilt mods
                  </p>
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
                <label className="cursor-pointer vault-glow-ring inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-white/12 bg-white dark:bg-[#090B12] text-slate-800 dark:text-white hover:border-[#8B5CF6]/60 transition-colors min-h-[40px]">
                  <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                  {jarFile ? 'Choose Another .jar' : 'Browse Computer'}
                  <input
                    type="file"
                    accept=".jar,application/java-archive"
                    className="sr-only"
                    onChange={(e) => {
                      void handleSelectedFile(e.target.files?.[0] || null);
                      e.target.value = '';
                    }}
                  />
                </label>
                {jarFile && !uploading && (
                  <button
                    type="button"
                    onClick={clearSelectedJar}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 text-slate-700 dark:text-[#CBD5E1] hover:text-slate-900 dark:hover:text-white min-h-[40px]"
                  >
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                    Remove
                  </button>
                )}
              </div>
            </div>
          </section>

          {errorMsg && (
            <div
              role="alert"
              className="rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-xs text-red-700 dark:text-red-200 flex items-start gap-2.5"
            >
              <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleModSubmit} className="space-y-2">
            <p className="text-xs font-semibold text-slate-700 dark:text-[#CBD5E1]">
              Step 2 · Check mod details &amp; save
            </p>

            <div className="vault-glass rounded-xl p-6 space-y-5">
              {uploadMode === 'version' ? (
                <div>
                  <label htmlFor="target-mod" className="block text-xs font-medium text-slate-700 dark:text-[#CBD5E1] mb-1.5">
                    Which mod are you updating?
                  </label>
                  <select
                    id="target-mod"
                    required
                    value={targetModId}
                    onChange={(e) => setTargetModId(e.target.value)}
                    className="vault-glow-ring w-full px-3.5 py-2.5 text-sm rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white"
                  >
                    {mods.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.loader} · {m.latest_mc_version})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="mod-name" className="block text-xs font-medium text-slate-700 dark:text-[#CBD5E1] mb-1.5">
                      Mod Name
                    </label>
                    <input
                      id="mod-name"
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Sodium"
                      className="vault-glow-ring w-full px-3.5 py-2.5 text-sm rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-[#64748B]"
                    />
                  </div>

                  <div>
                    <label htmlFor="mod-category" className="block text-xs font-medium text-slate-700 dark:text-[#CBD5E1] mb-1.5">
                      Category
                    </label>
                    <select
                      id="mod-category"
                      value={categoryId}
                      onChange={(e) => setCategoryId(e.target.value)}
                      className="vault-glow-ring w-full px-3.5 py-2.5 text-sm rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white"
                    >
                      <option value="">Uncategorized</option>
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="mod-loader" className="block text-xs font-medium text-slate-700 dark:text-[#CBD5E1] mb-1.5">
                    Mod Loader
                  </label>
                  <select
                    id="mod-loader"
                    value={loader}
                    onChange={(e) => setLoader(e.target.value as ModLoader)}
                    className="vault-glow-ring w-full px-3.5 py-2.5 text-sm rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white"
                  >
                    {LOADERS.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="mc-version" className="block text-xs font-medium text-slate-700 dark:text-[#CBD5E1] mb-1.5">
                    Minecraft Version
                  </label>
                  <input
                    id="mc-version"
                    type="text"
                    required
                    value={mcVersion}
                    onChange={(e) => setMcVersion(e.target.value)}
                    placeholder="1.21.1"
                    className="vault-glow-ring w-full px-3.5 py-2.5 text-sm font-mono rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-[#64748B]"
                  />
                </div>

                <div>
                  <label htmlFor="mod-version" className="block text-xs font-medium text-slate-700 dark:text-[#CBD5E1] mb-1.5">
                    Mod Version
                  </label>
                  <input
                    id="mod-version"
                    type="text"
                    required
                    value={versionNumber}
                    onChange={(e) => setVersionNumber(e.target.value)}
                    placeholder="0.6.0"
                    className="vault-glow-ring w-full px-3.5 py-2.5 text-sm font-mono rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-[#64748B]"
                  />
                </div>
              </div>

              {uploadMode === 'new' ? (
                <>
                  <div>
                    <label htmlFor="mod-desc" className="block text-xs font-medium text-slate-700 dark:text-[#CBD5E1] mb-1.5">
                      Notes (Optional)
                    </label>
                    <textarea
                      id="mod-desc"
                      rows={3}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Dependencies, server notes, or reminder..."
                      className="vault-glow-ring w-full px-3.5 py-2.5 text-sm rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-[#64748B] resize-y"
                    />
                  </div>

                  <div>
                    <span className="block text-xs font-medium text-slate-700 dark:text-[#CBD5E1] mb-1.5">
                      Mod Icon (Optional)
                    </span>
                    <div className="flex flex-wrap items-center gap-3">
                      {thumbPreview && (
                        <div className="relative w-12 h-12 rounded-lg overflow-hidden border border-slate-200 dark:border-white/15 shrink-0">
                          <img
                            src={thumbPreview}
                            alt="Thumbnail preview"
                            className="w-full h-full object-cover"
                          />
                        </div>
                      )}
                      <label className="cursor-pointer inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#090B12] text-slate-800 dark:text-white hover:border-[#8B5CF6]/50 transition-colors min-h-[40px]">
                        <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                        {thumbBlob ? `Selected: ${thumbName}` : 'Choose Custom Icon (PNG / JPG)'}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="sr-only"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            setThumbBlob(file);
                            setThumbName(file.name);
                            setThumbPreview(URL.createObjectURL(file));
                          }}
                        />
                      </label>
                      {thumbBlob && (
                        <button
                          type="button"
                          onClick={() => {
                            setThumbBlob(null);
                            setThumbPreview(null);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-2 text-xs text-slate-500 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-white min-h-[40px]"
                        >
                          <X className="w-3.5 h-3.5" />
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div>
                  <label htmlFor="ver-changelog" className="block text-xs font-medium text-slate-700 dark:text-[#CBD5E1] mb-1.5">
                    What changed in this version? (Optional)
                  </label>
                  <textarea
                    id="ver-changelog"
                    rows={2}
                    value={changelog}
                    onChange={(e) => setChangelog(e.target.value)}
                    placeholder="e.g. Updated for MC 1.21.1, fixed shader crash..."
                    className="vault-glow-ring w-full px-3.5 py-2.5 text-sm rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-[#64748B] resize-y"
                  />
                </div>
              )}

              {uploading && (
                <div className="rounded-xl border border-[#8B5CF6]/35 bg-[#8B5CF6]/10 p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-slate-900 dark:text-white">{stageText}</span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-mono tabular-nums text-[#7C3AED] dark:text-[#C4B5FD]">
                        {progressPct}%
                      </span>
                      <button
                        type="button"
                        onClick={() => modAbortRef.current?.abort()}
                        className="px-2.5 py-1 text-[11px] font-semibold rounded-md border border-red-500/40 bg-red-500/10 dark:bg-red-500/15 text-red-700 dark:text-red-200 hover:bg-red-500/20 dark:hover:bg-red-500/25"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                  <div className="h-2 rounded-full bg-slate-200 dark:bg-[#090B12] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#8B5CF6] to-[#06B6D4] transition-all duration-150"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  {jarFile && (
                    <p className="text-[11px] font-mono tabular-nums text-slate-600 dark:text-[#CBD5E1]">
                      {formatBytes(uploadedBytes)} / {formatBytes(jarFile.size)}
                    </p>
                  )}
                </div>
              )}

              <div className="pt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 dark:border-white/8">
                <span className="text-xs text-slate-500 dark:text-[#94A3B8]">
                  {!jarFile
                    ? 'Choose a .jar file above to continue'
                    : !driveConnected
                      ? 'Google Drive will prompt to connect when you save'
                      : 'Ready to save privately in your Google Drive'}
                </span>
                <button
                  type="submit"
                  disabled={uploading || inspecting || !jarFile}
                  className="vault-glow-ring inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white transition-colors min-h-[42px] whitespace-nowrap disabled:opacity-50"
                >
                  {uploading ? (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                  )}
                  {uploading ? 'Saving to Google Drive...' : 'Save to Google Drive'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

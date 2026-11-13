import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import {
  Folder,
  FolderPlus,
  Upload,
  FolderUp,
  FileArchive,
  FileText,
  Image as ImageIcon,
  File as FileIcon,
  Download,
  Eye,
  Trash2,
  Pencil,
  FolderInput,
  Copy,
  Search,
  ArrowUpDown,
  ChevronRight,
  PackageOpen,
  CheckSquare,
  Square,
  Loader2,
  X,
  ArrowLeft,
  MoreHorizontal,
  LayoutGrid,
  List,
  Star,
} from 'lucide-react';
import type {
  UploadAuthorization,
  VaultConfigStatus,
  VaultFile,
  VaultFolder,
} from '../types/vault';
import {
  apiBlobRequest,
  apiRequest,
  DriveAuthRequiredError,
  uploadToGoogleDriveResumable,
} from '../lib/supabase';
import {
  classifyFileExtension,
  computeSha256Blob,
  formatBytes,
  formatDate,
  getPreviewKind,
  guessMimeType,
  triggerBlobDownload,
} from '../lib/format';
import {
  collectDroppedItems,
  extractZipSafely,
  packageUrlsAsZip,
  type BatchZipSourceItem,
} from '../lib/archive-tools';
import { FilePreviewModal } from '../components/FilePreviewModal';
import { MoveItemsModal } from '../components/MoveItemsModal';
import { ConfirmActionModal } from '../components/ConfirmActionModal';

interface FileManagerPageProps {
  folders: VaultFolder[];
  files: VaultFile[];
  config: VaultConfigStatus | null;
  accessToken: string;
  driveConnected: boolean;
  googleDriveToken: string | null;
  onEnsureDriveConnected: () => Promise<boolean>;
  onDriveAuthInvalid: (message?: string) => void;
  searchQuery: string;
  onSearchChange: (val: string) => void;
  defaultViewMode?: 'list' | 'grid';
  confirmBeforeTrash?: boolean;
  defaultAutoUnzip?: boolean;
  favoriteFileIds: Set<string>;
  onToggleFavoriteFile: (fileId: string) => void;
  onRefresh: () => Promise<void>;
  onNotify: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}

type SortKey = 'name' | 'size' | 'date' | 'type';

interface QueuedUploadItem {
  folderSegments: string[];
  fileName: string;
  blob: Blob;
  mimeType: string;
}

interface FloatingRowMenu {
  key: string;
  top: number;
  right: number;
  kind: 'folder' | 'file';
  folder?: VaultFolder;
  file?: VaultFile;
}

export function FileManagerPage({
  folders,
  files,
  config,
  accessToken,
  driveConnected,
  googleDriveToken,
  onEnsureDriveConnected,
  onDriveAuthInvalid,
  searchQuery,
  onSearchChange,
  defaultViewMode = 'list',
  confirmBeforeTrash = true,
  defaultAutoUnzip = false,
  favoriteFileIds,
  onToggleFavoriteFile,
  onRefresh,
  onNotify,
}: FileManagerPageProps) {
  const maxUploadMb = config?.maxUploadMb || 5120;
  const maxUploadBytes = maxUploadMb * 1024 * 1024;
  const allowedExtensions = config?.allowedExtensions || ['*'];

  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [searchAllVault, setSearchAllVault] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(defaultViewMode);

  const [extractZipOnUpload, setExtractZipOnUpload] = useState(defaultAutoUnzip);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    setViewMode(defaultViewMode);
  }, [defaultViewMode]);

  useEffect(() => {
    setExtractZipOnUpload(defaultAutoUnzip);
  }, [defaultAutoUnzip]);

  // Upload queue progress state + cancel controller
  const [uploading, setUploading] = useState(false);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const [uploadStats, setUploadStats] = useState({
    completed: 0,
    total: 0,
    currentName: '',
    currentPercent: 0,
    bytesLoaded: 0,
    bytesTotal: 0,
  });

  // Batch ZIP packaging state
  const [zippingState, setZippingState] = useState<{
    active: boolean;
    completed: number;
    total: number;
    label: string;
  }>({ active: false, completed: 0, total: 0, label: '' });

  // Selection & Modals
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [rowMenu, setRowMenu] = useState<FloatingRowMenu | null>(null);

  const [renamingItem, setRenamingItem] = useState<{
    kind: 'folder' | 'file';
    id: string;
    name: string;
  } | null>(null);

  const [movingTarget, setMovingTarget] = useState<{
    mode: 'move' | 'copy';
    kind: 'file' | 'files' | 'folder';
    id?: string;
    fileIds?: string[];
    title: string;
  } | null>(null);

  const [previewFile, setPreviewFile] = useState<VaultFile | null>(null);
  const [pendingDeleteFolder, setPendingDeleteFolder] = useState<VaultFolder | null>(null);
  const [pendingDeleteFile, setPendingDeleteFile] = useState<VaultFile | null>(null);
  const [confirmBulkDeleteOpen, setConfirmBulkDeleteOpen] = useState(false);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const folderMap = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const fileMap = useMemo(() => new Map(files.map((f) => [f.id, f])), [files]);

  useEffect(() => {
    if (currentFolderId && !folderMap.has(currentFolderId)) {
      setCurrentFolderId(null);
      setSelectedFileIds(new Set());
    }
  }, [currentFolderId, folderMap]);

  useEffect(() => {
    if (!rowMenu) return;
    const closeMenu = () => setRowMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRowMenu(null);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', closeMenu);
    };
  }, [rowMenu]);

  useEffect(() => {
    if (!renamingItem) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRenamingItem(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [renamingItem]);

  const handleOpenPreview = async (file: VaultFile) => {
    const canPreview = Boolean(getPreviewKind(file.file_extension, file.mime_type));
    if (canPreview && !driveConnected && !googleDriveToken) {
      const ready = await onEnsureDriveConnected();
      if (!ready) return;
    }
    setPreviewFile(file);
  };

  const breadcrumbs = useMemo(() => {
    const chain: VaultFolder[] = [];
    let cursor = currentFolderId;
    let guard = 0;
    while (cursor && guard < 30) {
      const node = folderMap.get(cursor);
      if (!node) break;
      chain.unshift(node);
      cursor = node.parent_id;
      guard += 1;
    }
    return chain;
  }, [currentFolderId, folderMap]);

  const currentFolder = currentFolderId ? folderMap.get(currentFolderId) || null : null;

  const folderStatsMap = useMemo(() => {
    const childrenByParent = new Map<string | null, VaultFolder[]>();
    for (const f of folders) {
      const key = f.parent_id || null;
      const list = childrenByParent.get(key) || [];
      list.push(f);
      childrenByParent.set(key, list);
    }

    const filesByFolder = new Map<string | null, VaultFile[]>();
    for (const file of files) {
      const key = file.folder_id || null;
      const list = filesByFolder.get(key) || [];
      list.push(file);
      filesByFolder.set(key, list);
    }

    const stats = new Map<string, { fileCount: number; totalBytes: number }>();

    const compute = (folderId: string): { fileCount: number; totalBytes: number } => {
      const cached = stats.get(folderId);
      if (cached) return cached;

      const directFiles = filesByFolder.get(folderId) || [];
      let fileCount = directFiles.length;
      let totalBytes = directFiles.reduce((s, f) => s + (Number(f.file_size_bytes) || 0), 0);

      for (const child of childrenByParent.get(folderId) || []) {
        const sub = compute(child.id);
        fileCount += sub.fileCount;
        totalBytes += sub.totalBytes;
      }

      const result = { fileCount, totalBytes };
      stats.set(folderId, result);
      return result;
    };

    for (const f of folders) {
      compute(f.id);
    }

    return stats;
  }, [folders, files]);

  const visibleFolders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = folders.filter((f) => {
      if (q && searchAllVault) {
        return f.name.toLowerCase().includes(q);
      }
      if ((f.parent_id || null) !== currentFolderId) return false;
      if (q) return f.name.toLowerCase().includes(q);
      return true;
    });

    list.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name' || sortBy === 'type') {
        cmp = a.name.localeCompare(b.name);
      } else if (sortBy === 'date') {
        cmp = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
      } else if (sortBy === 'size') {
        const sizeA = folderStatsMap.get(a.id)?.totalBytes || 0;
        const sizeB = folderStatsMap.get(b.id)?.totalBytes || 0;
        cmp = sizeA - sizeB;
      }
      return sortAsc ? cmp : -cmp;
    });

    return list;
  }, [folders, currentFolderId, searchQuery, searchAllVault, sortBy, sortAsc, folderStatsMap]);

  const visibleFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = files.filter((file) => {
      if (q && searchAllVault) {
        return (
          file.name.toLowerCase().includes(q) ||
          file.file_extension.toLowerCase().includes(q)
        );
      }
      if ((file.folder_id || null) !== currentFolderId) return false;
      if (q) {
        return (
          file.name.toLowerCase().includes(q) ||
          file.file_extension.toLowerCase().includes(q)
        );
      }
      return true;
    });

    list.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') {
        cmp = a.name.localeCompare(b.name);
      } else if (sortBy === 'size') {
        cmp = (Number(a.file_size_bytes) || 0) - (Number(b.file_size_bytes) || 0);
      } else if (sortBy === 'date') {
        cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      } else if (sortBy === 'type') {
        cmp = a.file_extension.localeCompare(b.file_extension) || a.name.localeCompare(b.name);
      }
      return sortAsc ? cmp : -cmp;
    });

    return list;
  }, [files, currentFolderId, searchQuery, searchAllVault, sortBy, sortAsc]);

  const buildFolderRelativePath = (folderId: string | null): string => {
    if (!folderId) return 'Home';
    const parts: string[] = [];
    let cur: string | null = folderId;
    let guard = 0;
    while (cur && guard < 25) {
      const node = folderMap.get(cur);
      if (!node) break;
      parts.unshift(node.name);
      cur = node.parent_id;
      guard += 1;
    }
    return parts.join(' / ') || 'Home';
  };

  const validateFileAllowed = (fileName: string, sizeBytes: number): string | null => {
    if (sizeBytes <= 0) return `Skipped empty file "${fileName}".`;
    if (sizeBytes > maxUploadBytes) {
      return `"${fileName}" exceeds maximum upload limit of ${maxUploadMb} MB.`;
    }
    if (!allowedExtensions.includes('*')) {
      const dot = fileName.lastIndexOf('.');
      const ext = dot > 0 ? fileName.slice(dot).toLowerCase() : '';
      if (!ext || !allowedExtensions.includes(ext)) {
        return `"${fileName}" file type is restricted by server settings.`;
      }
    }
    return null;
  };

  const executeUploadQueue = async (
    rawItems: QueuedUploadItem[],
    baseFolderId: string | null,
    shouldExtractZips: boolean,
  ) => {
    if (rawItems.length === 0) return;

    const ready = driveConnected || (await onEnsureDriveConnected());
    if (!ready) return;

    const controller = new AbortController();
    uploadAbortRef.current = controller;
    setUploading(true);

    let uploadedCount = 0;

    try {
      const expandedItems: QueuedUploadItem[] = [];

      for (const item of rawItems) {
        if (controller.signal.aborted) break;
        if (shouldExtractZips && item.fileName.toLowerCase().endsWith('.zip')) {
          const zipStem = item.fileName.replace(/\.zip$/i, '').trim() || 'extracted';
          setUploadStats({
            completed: 0,
            total: rawItems.length,
            currentName: `Unzipping ${item.fileName}...`,
            currentPercent: 0,
            bytesLoaded: 0,
            bytesTotal: item.blob.size,
          });

          const { entries } = await extractZipSafely(item.blob, {
            maxFileBytes: maxUploadBytes,
          });

          for (const entry of entries) {
            expandedItems.push({
              folderSegments: [...item.folderSegments, zipStem, ...entry.folderSegments],
              fileName: entry.fileName,
              blob: entry.blob,
              mimeType: entry.mimeType,
            });
          }
        } else {
          expandedItems.push(item);
        }
      }

      if (expandedItems.length === 0) {
        onNotify('info', 'Nothing to upload', 'No non-empty files were found.');
        return;
      }

      const folderCache = new Map<string, string | null>();
      folderCache.set('', baseFolderId);

      let completed = 0;

      for (const item of expandedItems) {
        if (controller.signal.aborted) {
          throw new DOMException('Upload cancelled by user.', 'AbortError');
        }

        const validationError = validateFileAllowed(item.fileName, item.blob.size);
        if (validationError) {
          onNotify('error', 'File skipped', validationError);
          completed += 1;
          continue;
        }

        setUploadStats({
          completed,
          total: expandedItems.length,
          currentName:
            item.folderSegments.length > 0
              ? `${item.folderSegments.join('/')}/${item.fileName}`
              : item.fileName,
          currentPercent: 0,
          bytesLoaded: 0,
          bytesTotal: item.blob.size,
        });

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
          onProgress: (loaded, total, pct) => {
            setUploadStats((prev) => ({
              ...prev,
              currentPercent: pct,
              bytesLoaded: loaded,
              bytesTotal: total,
            }));
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

        completed += 1;
        uploadedCount += 1;
      }

      if (uploadedCount > 0) {
        onNotify(
          'success',
          'Upload complete',
          `${uploadedCount} file${uploadedCount === 1 ? '' : 's'} saved to Google Drive.`,
        );
      }
      await onRefresh();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        onNotify(
          'info',
          'Upload cancelled',
          uploadedCount > 0
            ? `${uploadedCount} completed before cancel.`
            : 'Remaining uploads cancelled.',
        );
        if (uploadedCount > 0) {
          await onRefresh();
        }
      } else {
        if (err instanceof DriveAuthRequiredError) {
          onDriveAuthInvalid(err.message);
        }
        onNotify(
          'error',
          'Upload error',
          err instanceof Error ? err.message : 'Unable to upload files to Google Drive.',
        );
      }
    } finally {
      uploadAbortRef.current = null;
      setUploading(false);
    }
  };

  const handleFilesSelected = async (fileList: FileList | null, preserveRelativePath: boolean) => {
    if (!fileList || fileList.length === 0) return;
    const queue: QueuedUploadItem[] = [];

    for (const file of Array.from(fileList)) {
      if (file.size === 0) continue;
      let folderSegments: string[] = [];
      if (preserveRelativePath && file.webkitRelativePath) {
        const parts = file.webkitRelativePath.split('/').filter(Boolean);
        folderSegments = parts.slice(0, -1);
      }
      queue.push({
        folderSegments,
        fileName: file.name,
        blob: file,
        mimeType: guessMimeType(file.name, file.type),
      });
    }

    await executeUploadQueue(queue, currentFolderId, extractZipOnUpload);
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    try {
      const dropped = await collectDroppedItems(e.dataTransfer);
      const queue: QueuedUploadItem[] = dropped.map((d) => ({
        folderSegments: d.folderSegments,
        fileName: d.file.name,
        blob: d.file,
        mimeType: guessMimeType(d.file.name, d.file.type),
      }));
      await executeUploadQueue(queue, currentFolderId, extractZipOnUpload);
    } catch (err) {
      onNotify(
        'error',
        'Drop upload failed',
        err instanceof Error ? err.message : 'Unable to read dropped items.',
      );
    }
  };

  const handleCreateFolder = async (e: FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    const ready = driveConnected || (await onEnsureDriveConnected());
    if (!ready) return;

    try {
      await apiRequest(
        '/api/vault/folders',
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({
            name: newFolderName.trim(),
            parentId: currentFolderId,
          }),
        },
        googleDriveToken,
      );
      setNewFolderName('');
      setCreatingFolder(false);
      onNotify('success', 'Folder created', newFolderName.trim());
      await onRefresh();
    } catch (err) {
      if (err instanceof DriveAuthRequiredError) {
        onDriveAuthInvalid(err.message);
      }
      onNotify(
        'error',
        'Folder error',
        err instanceof Error ? err.message : 'Unable to create folder.',
      );
    }
  };

  const handleRenameSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!renamingItem || !renamingItem.name.trim()) return;
    const ready = driveConnected || (await onEnsureDriveConnected());
    if (!ready) return;

    try {
      if (renamingItem.kind === 'folder') {
        await apiRequest(
          `/api/vault/folders/${encodeURIComponent(renamingItem.id)}`,
          accessToken,
          {
            method: 'PATCH',
            body: JSON.stringify({ name: renamingItem.name.trim() }),
          },
          googleDriveToken,
        );
      } else {
        await apiRequest(
          `/api/vault/files/${encodeURIComponent(renamingItem.id)}`,
          accessToken,
          {
            method: 'PATCH',
            body: JSON.stringify({ name: renamingItem.name.trim() }),
          },
          googleDriveToken,
        );
      }
      setRenamingItem(null);
      onNotify('success', 'Renamed successfully');
      await onRefresh();
    } catch (err) {
      if (err instanceof DriveAuthRequiredError) {
        onDriveAuthInvalid(err.message);
      }
      onNotify(
        'error',
        'Rename failed',
        err instanceof Error ? err.message : 'Unable to rename item.',
      );
    }
  };

  const handleTrashFolder = async (folder: VaultFolder) => {
    const ready = driveConnected || (await onEnsureDriveConnected());
    if (!ready) return;

    setDeletingBusy(true);
    try {
      await apiRequest(
        '/api/trash/move',
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({ kind: 'folder', id: folder.id }),
        },
        googleDriveToken,
      );
      setPendingDeleteFolder(null);
      onNotify('success', 'Moved to Trash', `${folder.name} can be restored anytime from Trash.`);
      await onRefresh();
    } catch (err) {
      if (err instanceof DriveAuthRequiredError) {
        onDriveAuthInvalid(err.message);
      }
      onNotify(
        'error',
        'Move to Trash failed',
        err instanceof Error ? err.message : 'Unable to move folder to Trash.',
      );
    } finally {
      setDeletingBusy(false);
    }
  };

  const handleTrashFile = async (file: VaultFile) => {
    const ready = driveConnected || (await onEnsureDriveConnected());
    if (!ready) return;

    setDeletingBusy(true);
    try {
      await apiRequest(
        '/api/trash/move',
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({ kind: 'file', id: file.id }),
        },
        googleDriveToken,
      );
      setPendingDeleteFile(null);
      setSelectedFileIds((prev) => {
        const next = new Set(prev);
        next.delete(file.id);
        return next;
      });
      onNotify('success', 'Moved to Trash', `${file.name} can be restored from Trash.`);
      await onRefresh();
    } catch (err) {
      if (err instanceof DriveAuthRequiredError) {
        onDriveAuthInvalid(err.message);
      }
      onNotify(
        'error',
        'Move to Trash failed',
        err instanceof Error ? err.message : 'Unable to move file to Trash.',
      );
    } finally {
      setDeletingBusy(false);
    }
  };

  const handleBulkTrash = async () => {
    const ids = Array.from(selectedFileIds);
    if (ids.length === 0) return;

    const ready = driveConnected || (await onEnsureDriveConnected());
    if (!ready) return;

    setDeletingBusy(true);
    try {
      await apiRequest(
        '/api/trash/move',
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({ kind: 'files', ids }),
        },
        googleDriveToken,
      );
      setSelectedFileIds(new Set());
      setConfirmBulkDeleteOpen(false);
      onNotify('success', 'Moved to Trash', `${ids.length} files moved to Trash.`);
      await onRefresh();
    } catch (err) {
      if (err instanceof DriveAuthRequiredError) {
        onDriveAuthInvalid(err.message);
      }
      onNotify(
        'error',
        'Move to Trash failed',
        err instanceof Error ? err.message : 'Unable to move selected files to Trash.',
      );
    } finally {
      setDeletingBusy(false);
    }
  };

  const requestTrashFolder = (folder: VaultFolder) => {
    if (confirmBeforeTrash) {
      setPendingDeleteFolder(folder);
    } else {
      void handleTrashFolder(folder);
    }
  };

  const requestTrashFile = (file: VaultFile) => {
    if (confirmBeforeTrash) {
      setPendingDeleteFile(file);
    } else {
      void handleTrashFile(file);
    }
  };

  const handleDownloadFile = async (file: VaultFile) => {
    const ready = driveConnected || (await onEnsureDriveConnected());
    if (!ready) return;

    try {
      onNotify('info', 'Downloading...', file.name);
      const { blob, fileName } = await apiBlobRequest(
        `/api/vault/files/${encodeURIComponent(file.id)}/download`,
        accessToken,
        googleDriveToken,
        {
          method: 'POST',
          body: JSON.stringify({ mode: 'attachment' }),
        },
      );
      triggerBlobDownload(blob, fileName || file.name);
    } catch (err) {
      if (err instanceof DriveAuthRequiredError) {
        onDriveAuthInvalid(err.message);
      }
      onNotify(
        'error',
        'Download failed',
        err instanceof Error ? err.message : 'Unable to download file from Google Drive.',
      );
    }
  };

  const handleExtractStoredZip = async (zipFile: VaultFile) => {
    const ready = driveConnected || (await onEnsureDriveConnected());
    if (!ready) return;

    try {
      onNotify('info', 'Unzipping archive...', zipFile.name);
      const { blob: zipBlob } = await apiBlobRequest(
        `/api/vault/files/${encodeURIComponent(zipFile.id)}/download`,
        accessToken,
        googleDriveToken,
        {
          method: 'POST',
          body: JSON.stringify({ mode: 'inline' }),
        },
      );

      const { entries } = await extractZipSafely(zipBlob, { maxFileBytes: maxUploadBytes });
      const rootName = zipFile.name.replace(/\.zip$/i, '').trim() || 'extracted';

      const queue: QueuedUploadItem[] = entries.map((entry) => ({
        folderSegments: [rootName, ...entry.folderSegments],
        fileName: entry.fileName,
        blob: entry.blob,
        mimeType: entry.mimeType,
      }));

      await executeUploadQueue(queue, zipFile.folder_id, false);
    } catch (err) {
      if (err instanceof DriveAuthRequiredError) {
        onDriveAuthInvalid(err.message);
      }
      onNotify(
        'error',
        'ZIP extraction failed',
        err instanceof Error ? err.message : 'Unable to extract archive safely.',
      );
    }
  };

  const handleBulkZipDownload = async (
    fileIds: string[],
    zipFileName: string,
    baseFolderId: string | null,
  ) => {
    if (fileIds.length === 0) return;

    const ready = driveConnected || (await onEnsureDriveConnected());
    if (!ready) return;

    setZippingState({
      active: true,
      completed: 0,
      total: fileIds.length,
      label: 'Preparing ZIP download...',
    });

    try {
      const signed = await apiRequest<{
        items: Array<{
          id: string;
          folderId: string | null;
          name: string;
          downloadUrl: string;
        }>;
      }>(
        '/api/vault/files/sign-batch',
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({ fileIds }),
        },
        googleDriveToken,
      );

      const getRelativeFolderPrefix = (folderId: string | null): string => {
        const parts: string[] = [];
        let cur = folderId;
        let guard = 0;
        while (cur && cur !== baseFolderId && guard < 25) {
          const node = folderMap.get(cur);
          if (!node) break;
          parts.unshift(node.name);
          cur = node.parent_id;
          guard += 1;
        }
        return parts.join('/');
      };

      const sourceItems: BatchZipSourceItem[] = signed.items.map((item) => {
        const prefix = getRelativeFolderPrefix(item.folderId);
        return {
          archivePath: prefix ? `${prefix}/${item.name}` : item.name,
          downloadUrl: item.downloadUrl,
        };
      });

      const zipHeaders: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
      };
      if (googleDriveToken) {
        zipHeaders['X-Google-Drive-Token'] = googleDriveToken;
      }

      const zipBlob = await packageUrlsAsZip(
        sourceItems,
        (completed, total, label) => {
          setZippingState({ active: true, completed, total, label });
        },
        {
          method: 'POST',
          headers: zipHeaders,
        },
      );

      triggerBlobDownload(zipBlob, zipFileName);
      onNotify('success', 'ZIP ready', `${zipFileName} (${signed.items.length} files).`);
    } catch (err) {
      if (err instanceof DriveAuthRequiredError) {
        onDriveAuthInvalid(err.message);
      }
      onNotify(
        'error',
        'ZIP download failed',
        err instanceof Error ? err.message : 'Unable to package files into ZIP.',
      );
    } finally {
      setZippingState({ active: false, completed: 0, total: 0, label: '' });
    }
  };

  const handleDownloadFolderAsZip = async (folder: VaultFolder) => {
    const subtree = new Set<string>([folder.id]);
    let added = true;
    while (added) {
      added = false;
      for (const f of folders) {
        if (f.parent_id && subtree.has(f.parent_id) && !subtree.has(f.id)) {
          subtree.add(f.id);
          added = true;
        }
      }
    }

    const folderFiles = files.filter((file) => file.folder_id && subtree.has(file.folder_id));
    if (folderFiles.length === 0) {
      onNotify('info', 'Empty folder', `"${folder.name}" has no files to download.`);
      return;
    }

    await handleBulkZipDownload(
      folderFiles.map((f) => f.id),
      `${folder.name}.zip`,
      folder.id,
    );
  };

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

  const allVisibleSelected =
    visibleFiles.length > 0 && visibleFiles.every((f) => selectedFileIds.has(f.id));

  const toggleSelectAllVisible = () => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visibleFiles.forEach((f) => next.delete(f.id));
      } else {
        visibleFiles.forEach((f) => next.add(f.id));
      }
      return next;
    });
  };

  const toggleSelectFile = (fileId: string) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  };

  const selectedFileNames = Array.from(selectedFileIds)
    .map((id) => fileMap.get(id)?.name)
    .filter((n): n is string => Boolean(n));

  const openFloatingMenu = (
    buttonEl: HTMLButtonElement,
    payload: Omit<FloatingRowMenu, 'top' | 'right'>,
  ) => {
    if (rowMenu?.key === payload.key) {
      setRowMenu(null);
      return;
    }
    const rect = buttonEl.getBoundingClientRect();
    const menuHeightEstimate = payload.kind === 'file' ? 250 : 145;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top =
      spaceBelow < menuHeightEstimate
        ? Math.max(12, rect.top - menuHeightEstimate)
        : rect.bottom + 6;
    const right = Math.max(12, window.innerWidth - rect.right);
    setRowMenu({ ...payload, top, right });
  };

  return (
    <div
      className="space-y-5 relative"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => void handleDrop(e)}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="sr-only"
        onChange={(e) => {
          void handleFilesSelected(e.target.files, false);
          e.target.value = '';
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        // @ts-expect-error webkitdirectory is supported by Chromium/Firefox/Safari for folder selection
        webkitdirectory=""
        directory=""
        className="sr-only"
        onChange={(e) => {
          void handleFilesSelected(e.target.files, true);
          e.target.value = '';
        }}
      />

      {/* Upload & Folder Action Header */}
      <div
        className={`vault-glass rounded-xl p-5 border-2 transition-colors ${
          dragging ? 'border-dashed border-[#8B5CF6] bg-[#8B5CF6]/10' : 'border-slate-200 dark:border-white/8'
        }`}
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              {currentFolder ? `Folder: ${currentFolder.name}` : 'My Private Files & Folders'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-[#94A3B8]">
              {dragging
                ? `Drop files or folders anywhere to upload into "${currentFolder?.name || 'Home'}"`
                : 'Drag and drop files or folders here, or use the controls to organize, preview, copy, and share internally.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="vault-glow-ring inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white transition-colors min-h-[40px] whitespace-nowrap disabled:opacity-50"
            >
              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
              Upload Files
            </button>

            <button
              type="button"
              disabled={uploading}
              onClick={() => folderInputRef.current?.click()}
              className="vault-glow-ring inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/12 bg-white dark:bg-[#090B12] text-slate-800 dark:text-white hover:border-[#0891B2]/60 dark:hover:border-[#06B6D4]/60 transition-colors min-h-[40px] whitespace-nowrap disabled:opacity-50"
            >
              <FolderUp className="w-3.5 h-3.5 text-[#0891B2] dark:text-[#06B6D4]" aria-hidden="true" />
              Upload Folder
            </button>

            <button
              type="button"
              onClick={() => setCreatingFolder((prev) => !prev)}
              className="vault-glow-ring inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/12 bg-white dark:bg-[#090B12] text-slate-700 dark:text-[#CBD5E1] hover:text-slate-900 dark:hover:text-white transition-colors min-h-[40px] whitespace-nowrap"
            >
              <FolderPlus className="w-3.5 h-3.5" aria-hidden="true" />
              New Folder
            </button>
          </div>
        </div>

        <div className="mt-4 pt-3.5 border-t border-slate-200 dark:border-white/8 flex flex-wrap items-center justify-between gap-3 text-xs">
          <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700 dark:text-[#CBD5E1]">
            <input
              type="checkbox"
              checked={extractZipOnUpload}
              onChange={(e) => setExtractZipOnUpload(e.target.checked)}
              className="rounded border-slate-300 dark:border-white/20 bg-white dark:bg-[#090B12] text-[#8B5CF6] focus:ring-[#8B5CF6]"
            />
            <span>Automatically unzip uploaded .zip files into folders</span>
          </label>
          <span className="text-slate-500 dark:text-[#94A3B8]">
            Click any file name to preview, or any folder to open it
          </span>
        </div>

        {creatingFolder && (
          <form
            onSubmit={handleCreateFolder}
            className="mt-4 pt-3.5 border-t border-slate-200 dark:border-white/8 flex flex-wrap items-center gap-2.5"
          >
            <input
              type="text"
              required
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Enter new folder name..."
              className="vault-glow-ring flex-1 min-w-[200px] px-3.5 py-2 text-xs rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-[#64748B] min-h-[40px]"
            />
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white min-h-[40px]"
            >
              Create Folder
            </button>
            <button
              type="button"
              onClick={() => {
                setCreatingFolder(false);
                setNewFolderName('');
              }}
              className="px-3.5 py-2 text-xs rounded-lg border border-slate-200 dark:border-white/10 text-slate-700 dark:text-[#CBD5E1] hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 min-h-[40px]"
            >
              Cancel
            </button>
          </form>
        )}
      </div>

      {/* Live Upload Progress Banner with Cancel */}
      {uploading && (
        <div className="vault-glass rounded-xl p-4 border border-[#8B5CF6]/40 bg-[#8B5CF6]/10 space-y-2">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="font-medium text-slate-900 dark:text-white truncate">
              Uploading {uploadStats.completed + 1} of {uploadStats.total}: {uploadStats.currentName}
            </span>
            <div className="flex items-center gap-3 shrink-0">
              <span className="font-mono tabular-nums text-[#7C3AED] dark:text-[#C4B5FD]">
                {uploadStats.currentPercent}%
              </span>
              <button
                type="button"
                onClick={() => uploadAbortRef.current?.abort()}
                className="px-2.5 py-1 text-[11px] font-semibold rounded-md border border-red-500/40 bg-red-500/10 dark:bg-red-500/15 text-red-700 dark:text-red-200 hover:bg-red-500/20 dark:hover:bg-red-500/25"
              >
                Cancel
              </button>
            </div>
          </div>
          <div className="h-2 rounded-full bg-slate-200 dark:bg-[#090B12] overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#8B5CF6] to-[#06B6D4] transition-all duration-150"
              style={{ width: `${uploadStats.currentPercent}%` }}
            />
          </div>
          <p className="text-[11px] font-mono tabular-nums text-slate-600 dark:text-[#CBD5E1]">
            {formatBytes(uploadStats.bytesLoaded)} / {formatBytes(uploadStats.bytesTotal)}
          </p>
        </div>
      )}

      {/* Batch ZIP Packaging Progress Banner */}
      {zippingState.active && (
        <div className="vault-glass rounded-xl p-4 border border-[#0891B2]/40 dark:border-[#06B6D4]/40 bg-[#06B6D4]/10 space-y-2">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="inline-flex items-center gap-2 font-medium text-slate-900 dark:text-white truncate">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden="true" />
              {zippingState.label}
            </span>
            <span className="font-mono tabular-nums text-[#0891B2] dark:text-[#67E8F9] shrink-0">
              {zippingState.completed} / {zippingState.total}
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-200 dark:bg-[#090B12] overflow-hidden">
            <div
              className="h-full rounded-full bg-[#06B6D4] transition-all duration-150"
              style={{
                width: `${
                  zippingState.total > 0
                    ? Math.round((zippingState.completed / zippingState.total) * 100)
                    : 0
                }%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Breadcrumbs, Back Button, View Mode, Search & Sort Controls */}
      <div className="vault-glass rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            {currentFolderId && (
              <button
                type="button"
                onClick={() => {
                  setCurrentFolderId(currentFolder?.parent_id || null);
                  setSelectedFileIds(new Set());
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/12 bg-white dark:bg-[#090B12] text-slate-800 dark:text-white hover:border-[#8B5CF6]/50 min-h-[38px] shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                Back
              </button>
            )}

            <nav aria-label="Folder breadcrumbs" className="flex flex-wrap items-center gap-1 text-xs">
              <button
                type="button"
                onClick={() => {
                  setCurrentFolderId(null);
                  setSelectedFileIds(new Set());
                }}
                className={`px-2.5 py-1.5 rounded-md transition-colors min-h-[36px] ${
                  currentFolderId === null
                    ? 'text-slate-900 dark:text-white font-semibold bg-slate-100 dark:bg-white/10'
                    : 'text-slate-500 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Home
              </button>
              {breadcrumbs.map((crumb) => (
                <div key={crumb.id} className="flex items-center gap-1">
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400 dark:text-[#64748B]" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={() => {
                      setCurrentFolderId(crumb.id);
                      setSelectedFileIds(new Set());
                    }}
                    className={`px-2.5 py-1.5 rounded-md transition-colors min-h-[36px] ${
                      currentFolderId === crumb.id
                        ? 'text-slate-900 dark:text-white font-semibold bg-slate-100 dark:bg-white/10'
                        : 'text-slate-500 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {crumb.name}
                  </button>
                </div>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <select
              aria-label="Sort files by"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className="vault-glow-ring px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white min-h-[40px]"
            >
              <option value="name">Sort: Name</option>
              <option value="size">Sort: Size</option>
              <option value="date">Sort: Date</option>
              <option value="type">Sort: File Type</option>
            </select>
            <button
              type="button"
              onClick={() => setSortAsc((prev) => !prev)}
              aria-label="Toggle sort order"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#090B12] text-slate-700 dark:text-[#CBD5E1] hover:text-slate-900 dark:hover:text-white min-h-[40px]"
            >
              <ArrowUpDown className="w-3.5 h-3.5" aria-hidden="true" />
              {sortAsc ? 'A–Z' : 'Z–A'}
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              aria-label="List view"
              title="List view"
              className={`p-2 rounded-lg border transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center ${
                viewMode === 'list'
                  ? 'border-[#8B5CF6]/55 dark:border-[#8B5CF6]/60 bg-[#8B5CF6]/12 dark:bg-[#8B5CF6]/15 text-[#7C3AED] dark:text-white'
                  : 'border-slate-200 dark:border-white/10 text-slate-500 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-white'
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
                  ? 'border-[#8B5CF6]/55 dark:border-[#8B5CF6]/60 bg-[#8B5CF6]/12 dark:bg-[#8B5CF6]/15 text-[#7C3AED] dark:text-white'
                  : 'border-slate-200 dark:border-white/10 text-slate-500 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search
              className="w-4 h-4 text-slate-400 dark:text-[#64748B] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search files and folders..."
              aria-label="Search files and folders"
              className="vault-glow-ring w-full pl-10 pr-9 py-2 text-xs rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder-[#64748B] min-h-[40px]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded text-slate-500 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-[#CBD5E1] cursor-pointer py-1">
            <input
              type="checkbox"
              checked={searchAllVault}
              onChange={(e) => setSearchAllVault(e.target.checked)}
              className="rounded border-slate-300 dark:border-white/20 bg-white dark:bg-[#090B12] text-[#8B5CF6]"
            />
            Search all folders
          </label>
        </div>
      </div>

      {/* Multi-File Bulk Selection Bar */}
      {selectedFileIds.size > 0 && (
        <div className="vault-glass rounded-xl px-4 py-3 border border-[#8B5CF6]/40 bg-[#8B5CF6]/10 dark:bg-[#8B5CF6]/12 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs font-semibold text-slate-900 dark:text-white font-mono tabular-nums">
            {selectedFileIds.size} file{selectedFileIds.size === 1 ? '' : 's'} selected
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={zippingState.active}
              onClick={() =>
                void handleBulkZipDownload(
                  Array.from(selectedFileIds),
                  `mod-vault-files-${new Date().toISOString().slice(0, 10)}.zip`,
                  currentFolderId,
                )
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white min-h-[40px] disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              Download ZIP
            </button>
            <button
              type="button"
              onClick={() =>
                setMovingTarget({
                  mode: 'move',
                  kind: 'files',
                  fileIds: Array.from(selectedFileIds),
                  title: `Move ${selectedFileIds.size} selected files`,
                })
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/15 bg-white dark:bg-[#090B12] text-slate-800 dark:text-white hover:border-[#8B5CF6]/40 min-h-[40px]"
            >
              <FolderInput className="w-3.5 h-3.5" aria-hidden="true" />
              Move
            </button>
            <button
              type="button"
              onClick={() =>
                setMovingTarget({
                  mode: 'copy',
                  kind: 'files',
                  fileIds: Array.from(selectedFileIds),
                  title: `Copy ${selectedFileIds.size} selected files`,
                })
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/15 bg-white dark:bg-[#090B12] text-slate-800 dark:text-white hover:border-[#0891B2]/50 min-h-[40px]"
            >
              <Copy className="w-3.5 h-3.5 text-[#0891B2] dark:text-[#06B6D4]" aria-hidden="true" />
              Copy
            </button>
            <button
              type="button"
              onClick={() => setConfirmBulkDeleteOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-red-500/40 bg-red-500/10 dark:bg-red-500/15 text-red-700 dark:text-red-200 hover:bg-red-500/20 dark:hover:bg-red-500/25 min-h-[40px]"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              Trash
            </button>
            <button
              type="button"
              onClick={() => setSelectedFileIds(new Set())}
              aria-label="Clear selection"
              className="p-2 rounded-lg text-slate-600 dark:text-[#CBD5E1] hover:text-slate-900 dark:hover:text-white min-h-[40px] min-w-[40px] flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Folder & File Explorer */}
      {visibleFolders.length === 0 && visibleFiles.length === 0 ? (
        <div className="vault-glass rounded-xl p-12 text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-[#8B5CF6]/10 dark:bg-[#8B5CF6]/15 border border-[#8B5CF6]/25 dark:border-[#8B5CF6]/30 mx-auto flex items-center justify-center">
            <Folder className="w-6 h-6 text-[#7C3AED] dark:text-[#A78BFA]" aria-hidden="true" />
          </div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            {searchQuery.trim() ? 'No matching files or folders' : 'This folder is empty'}
          </h3>
          <p className="text-xs text-slate-500 dark:text-[#94A3B8] max-w-md mx-auto">
            {searchQuery.trim()
              ? 'Try another search term or enable "Search all folders".'
              : 'Upload files, drag an entire folder here, or create a subfolder to organize your files.'}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
            {searchQuery.trim() ? (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-white/12 bg-white dark:bg-[#090B12] text-slate-800 dark:text-white min-h-[40px]"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
                Clear Search
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white min-h-[40px]"
                >
                  <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                  Upload Files
                </button>
                <button
                  type="button"
                  onClick={() => setCreatingFolder(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/12 bg-white dark:bg-[#090B12] text-slate-800 dark:text-white min-h-[40px]"
                >
                  <FolderPlus className="w-3.5 h-3.5" aria-hidden="true" />
                  New Folder
                </button>
              </>
            )}
          </div>
        </div>
      ) : viewMode === 'list' ? (
        <div className="vault-glass rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/8 text-slate-500 dark:text-[#94A3B8] bg-slate-50 dark:bg-[#090B12]/60">
                  <th className="py-3 pl-4 pr-2 w-10">
                    {visibleFiles.length > 0 && (
                      <button
                        type="button"
                        onClick={toggleSelectAllVisible}
                        aria-label={allVisibleSelected ? 'Deselect all files' : 'Select all files'}
                        className="p-1.5 text-slate-500 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-white"
                      >
                        {allVisibleSelected ? (
                          <CheckSquare className="w-4 h-4 text-[#7C3AED] dark:text-[#A78BFA]" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                    )}
                  </th>
                  <th className="py-3 px-3 font-semibold">Name</th>
                  <th className="py-3 px-4 font-semibold hidden sm:table-cell">Type</th>
                  <th className="py-3 px-4 text-right font-semibold">Size</th>
                  <th className="py-3 px-4 text-right font-semibold hidden md:table-cell">Modified</th>
                  <th className="py-3 pl-4 pr-5 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-white/6">
                {visibleFolders.map((folder) => {
                  const stats = folderStatsMap.get(folder.id) || { fileCount: 0, totalBytes: 0 };
                  const menuKey = `folder-${folder.id}`;
                  return (
                    <tr key={menuKey} className="hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors">
                      <td className="py-3 pl-4 pr-2" />
                      <td className="py-3 px-3">
                        <button
                          type="button"
                          onClick={() => {
                            setCurrentFolderId(folder.id);
                            setSelectedFileIds(new Set());
                          }}
                          className="flex items-center gap-3 text-left group min-w-0 min-h-[36px]"
                        >
                          <Folder className="w-4 h-4 text-[#0891B2] dark:text-[#06B6D4] shrink-0" aria-hidden="true" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900 dark:text-white group-hover:text-[#7C3AED] dark:group-hover:text-[#A78BFA] transition-colors truncate max-w-[200px] sm:max-w-[280px]">
                              {folder.name}
                            </p>
                            {searchAllVault && searchQuery.trim() && (
                              <p className="text-[11px] text-slate-400 dark:text-[#64748B] truncate">
                                {buildFolderRelativePath(folder.parent_id)}
                              </p>
                            )}
                          </div>
                        </button>
                      </td>
                      <td className="py-3 px-4 text-slate-500 dark:text-[#94A3B8] whitespace-nowrap hidden sm:table-cell">
                        Folder · <span className="font-mono tabular-nums">{stats.fileCount} files</span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700 dark:text-[#E2E8F0] whitespace-nowrap">
                        {formatBytes(stats.totalBytes)}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-500 dark:text-[#94A3B8] whitespace-nowrap hidden md:table-cell">
                        {formatDate(folder.updated_at)}
                      </td>
                      <td className="py-3 pl-4 pr-5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => void handleDownloadFolderAsZip(folder)}
                            title="Download folder as ZIP"
                            aria-label={`Download ${folder.name} as ZIP`}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-[#0891B2] dark:text-[#06B6D4] hover:border-[#0891B2]/60 dark:hover:border-[#06B6D4]/60 min-h-[40px] whitespace-nowrap"
                          >
                            <Download className="w-3.5 h-3.5" aria-hidden="true" />
                            <span className="hidden lg:inline">ZIP</span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) =>
                              openFloatingMenu(e.currentTarget, {
                                key: menuKey,
                                kind: 'folder',
                                folder,
                              })
                            }
                            aria-label={`More actions for ${folder.name}`}
                            aria-expanded={rowMenu?.key === menuKey}
                            className="p-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-[#CBD5E1] hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-white/25 min-h-[40px] min-w-[40px] flex items-center justify-center"
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {visibleFiles.map((file) => {
                  const selected = selectedFileIds.has(file.id);
                  const isStarred = favoriteFileIds.has(file.id);
                  const previewable = getPreviewKind(file.file_extension, file.mime_type) !== null;
                  const menuKey = `file-${file.id}`;

                  return (
                    <tr
                      key={menuKey}
                      className={`hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors ${
                        selected ? 'bg-[#8B5CF6]/8' : ''
                      }`}
                    >
                      <td className="py-3 pl-4 pr-2">
                        <button
                          type="button"
                          onClick={() => toggleSelectFile(file.id)}
                          aria-label={selected ? `Deselect ${file.name}` : `Select ${file.name}`}
                          className="p-1.5 text-slate-500 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-white"
                        >
                          {selected ? (
                            <CheckSquare className="w-4 h-4 text-[#7C3AED] dark:text-[#A78BFA]" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </td>
                      <td className="py-3 px-3">
                        <button
                          type="button"
                          onClick={() => void handleOpenPreview(file)}
                          className="flex items-center gap-3 text-left group min-w-0 min-h-[36px]"
                        >
                          {renderFileIcon(file)}
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900 dark:text-white group-hover:text-[#7C3AED] dark:group-hover:text-[#A78BFA] transition-colors truncate max-w-[200px] sm:max-w-[280px]">
                              {file.name}
                            </p>
                            {searchAllVault && searchQuery.trim() && (
                              <p className="text-[11px] text-slate-400 dark:text-[#64748B] truncate">
                                {buildFolderRelativePath(file.folder_id)}
                              </p>
                            )}
                          </div>
                        </button>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-500 dark:text-[#94A3B8] whitespace-nowrap hidden sm:table-cell">
                        {file.file_extension || 'file'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700 dark:text-[#E2E8F0] whitespace-nowrap">
                        {formatBytes(file.file_size_bytes)}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-500 dark:text-[#94A3B8] whitespace-nowrap hidden md:table-cell">
                        {formatDate(file.created_at)}
                      </td>
                      <td className="py-3 pl-4 pr-5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => onToggleFavoriteFile(file.id)}
                            title={isStarred ? 'Remove from favorites' : 'Add to favorites'}
                            aria-label={isStarred ? `Unstar ${file.name}` : `Star ${file.name}`}
                            className={`p-2 rounded-lg border transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center ${
                              isStarred
                                ? 'border-amber-500/40 bg-amber-400/12 text-amber-600 dark:text-amber-300'
                                : 'border-slate-200 dark:border-white/10 text-slate-400 dark:text-[#64748B] hover:text-amber-500 dark:hover:text-amber-300'
                            }`}
                          >
                            <Star className={`w-3.5 h-3.5 ${isStarred ? 'fill-amber-500 dark:fill-amber-300' : ''}`} />
                          </button>
                          {previewable && (
                            <button
                              type="button"
                              onClick={() => void handleOpenPreview(file)}
                              title="Preview file"
                              aria-label={`Preview ${file.name}`}
                              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-[#7C3AED] dark:text-[#A78BFA] hover:border-[#8B5CF6]/60 min-h-[40px] whitespace-nowrap"
                            >
                              <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                              <span className="hidden lg:inline">View</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleDownloadFile(file)}
                            title="Download file"
                            aria-label={`Download ${file.name}`}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-[#0891B2] dark:text-[#06B6D4] hover:border-[#0891B2]/60 dark:hover:border-[#06B6D4]/60 min-h-[40px] whitespace-nowrap"
                          >
                            <Download className="w-3.5 h-3.5" aria-hidden="true" />
                            <span className="hidden lg:inline">Download</span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) =>
                              openFloatingMenu(e.currentTarget, {
                                key: menuKey,
                                kind: 'file',
                                file,
                              })
                            }
                            aria-label={`More actions for ${file.name}`}
                            aria-expanded={rowMenu?.key === menuKey}
                            className="p-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-[#CBD5E1] hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-white/25 min-h-[40px] min-w-[40px] flex items-center justify-center"
                          >
                            <MoreHorizontal className="w-4 h-4" />
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
        /* Grid Explorer View */
        <div className="space-y-4">
          {visibleFiles.length > 0 && (
            <div className="flex items-center justify-end px-1">
              <button
                type="button"
                onClick={toggleSelectAllVisible}
                className="text-xs text-[#7C3AED] dark:text-[#A78BFA] hover:text-slate-900 dark:hover:text-white py-1"
              >
                {allVisibleSelected ? 'Deselect all files' : 'Select all visible files'}
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {visibleFolders.map((folder) => {
              const stats = folderStatsMap.get(folder.id) || { fileCount: 0, totalBytes: 0 };
              const menuKey = `folder-grid-${folder.id}`;
              return (
                <article
                  key={menuKey}
                  className="vault-glass vault-glass-hover rounded-xl p-4 flex flex-col justify-between gap-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setCurrentFolderId(folder.id);
                        setSelectedFileIds(new Set());
                      }}
                      className="flex items-center gap-3 min-w-0 flex-1 text-left group"
                    >
                      <div className="w-10 h-10 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#090B12] flex items-center justify-center shrink-0">
                        <Folder className="w-5 h-5 text-[#0891B2] dark:text-[#06B6D4]" aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white group-hover:text-[#7C3AED] dark:group-hover:text-[#A78BFA] truncate">
                          {folder.name}
                        </p>
                        <p className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-[#94A3B8]">
                          {stats.fileCount} files · {formatBytes(stats.totalBytes)}
                        </p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={(e) =>
                        openFloatingMenu(e.currentTarget, {
                          key: menuKey,
                          kind: 'folder',
                          folder,
                        })
                      }
                      aria-label={`More actions for ${folder.name}`}
                      className="p-2 rounded-lg text-slate-500 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 min-h-[36px] min-w-[36px] flex items-center justify-center shrink-0"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="pt-2.5 border-t border-slate-200 dark:border-white/8 flex items-center justify-between text-xs">
                    <span className="text-slate-500 dark:text-[#94A3B8]">{formatDate(folder.updated_at)}</span>
                    <button
                      type="button"
                      onClick={() => void handleDownloadFolderAsZip(folder)}
                      className="inline-flex items-center gap-1 text-[#0891B2] dark:text-[#06B6D4] hover:text-slate-900 dark:hover:text-white font-medium py-1"
                    >
                      <Download className="w-3.5 h-3.5" aria-hidden="true" />
                      ZIP
                    </button>
                  </div>
                </article>
              );
            })}

            {visibleFiles.map((file) => {
              const selected = selectedFileIds.has(file.id);
              const isStarred = favoriteFileIds.has(file.id);
              const menuKey = `file-grid-${file.id}`;
              return (
                <article
                  key={menuKey}
                  className={`vault-glass vault-glass-hover rounded-xl p-4 flex flex-col justify-between gap-3 ${
                    selected ? 'border-[#8B5CF6]/60' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => void handleOpenPreview(file)}
                      className="flex items-center gap-3 min-w-0 flex-1 text-left group"
                    >
                      <div className="w-10 h-10 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#090B12] flex items-center justify-center shrink-0">
                        {renderFileIcon(file)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 dark:text-white group-hover:text-[#7C3AED] dark:group-hover:text-[#A78BFA] truncate">
                          {file.name}
                        </p>
                        <p className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-[#94A3B8] truncate">
                          {file.file_extension || 'file'} · {formatBytes(file.file_size_bytes)}
                        </p>
                      </div>
                    </button>

                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => onToggleFavoriteFile(file.id)}
                        aria-label={isStarred ? `Unstar ${file.name}` : `Star ${file.name}`}
                        className={`p-1.5 rounded transition-colors ${
                          isStarred
                            ? 'text-amber-500 dark:text-amber-300'
                            : 'text-slate-400 dark:text-[#64748B] hover:text-amber-500 dark:hover:text-amber-300'
                        }`}
                      >
                        <Star className={`w-4 h-4 ${isStarred ? 'fill-amber-500 dark:fill-amber-300' : ''}`} />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleSelectFile(file.id)}
                        aria-label={selected ? `Deselect ${file.name}` : `Select ${file.name}`}
                        className="p-1.5 text-slate-500 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-white"
                      >
                        {selected ? (
                          <CheckSquare className="w-4 h-4 text-[#7C3AED] dark:text-[#A78BFA]" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="pt-2.5 border-t border-slate-200 dark:border-white/8 flex items-center justify-between gap-2 text-xs">
                    <span className="text-slate-500 dark:text-[#94A3B8] truncate">{formatDate(file.created_at)}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleDownloadFile(file)}
                        aria-label={`Download ${file.name}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 text-[#0891B2] dark:text-[#06B6D4] hover:border-[#0891B2]/60 dark:hover:border-[#06B6D4]/60"
                      >
                        <Download className="w-3.5 h-3.5" aria-hidden="true" />
                        Get
                      </button>
                      <button
                        type="button"
                        onClick={(e) =>
                          openFloatingMenu(e.currentTarget, {
                            key: menuKey,
                            kind: 'file',
                            file,
                          })
                        }
                        aria-label={`More actions for ${file.name}`}
                        className="p-1.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-[#CBD5E1] hover:text-slate-900 dark:hover:text-white"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {/* Floating Labeled Action Menu */}
      {rowMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setRowMenu(null)}
            aria-hidden="true"
          />
          <div
            role="menu"
            style={{ top: rowMenu.top, right: rowMenu.right }}
            className="fixed z-50 w-48 rounded-xl bg-white dark:bg-[#151925] border border-slate-200 dark:border-white/15 shadow-2xl p-1.5 space-y-0.5 text-xs"
          >
            {rowMenu.kind === 'folder' && rowMenu.folder && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    const f = rowMenu.folder!;
                    setRowMenu(null);
                    setRenamingItem({ kind: 'folder', id: f.id, name: f.name });
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-slate-700 dark:text-[#E2E8F0] hover:bg-slate-100 dark:hover:bg-white/8 hover:text-slate-900 dark:hover:text-white min-h-[38px]"
                >
                  <Pencil className="w-3.5 h-3.5 text-slate-400 dark:text-[#94A3B8]" aria-hidden="true" />
                  Rename Folder
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    const f = rowMenu.folder!;
                    setRowMenu(null);
                    setMovingTarget({
                      mode: 'move',
                      kind: 'folder',
                      id: f.id,
                      title: `Move folder "${f.name}"`,
                    });
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-slate-700 dark:text-[#E2E8F0] hover:bg-slate-100 dark:hover:bg-white/8 hover:text-slate-900 dark:hover:text-white min-h-[38px]"
                >
                  <FolderInput className="w-3.5 h-3.5 text-slate-400 dark:text-[#94A3B8]" aria-hidden="true" />
                  Move to...
                </button>
                <div className="my-1 border-t border-slate-200 dark:border-white/8" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    const f = rowMenu.folder!;
                    setRowMenu(null);
                    requestTrashFolder(f);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-red-600 dark:text-red-300 hover:bg-red-500/10 dark:hover:bg-red-500/15 min-h-[38px]"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  Move to Trash
                </button>
              </>
            )}

            {rowMenu.kind === 'file' && rowMenu.file && (
              <>
                {getPreviewKind(rowMenu.file.file_extension, rowMenu.file.mime_type) && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      const f = rowMenu.file!;
                      setRowMenu(null);
                      void handleOpenPreview(f);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-slate-700 dark:text-[#E2E8F0] hover:bg-slate-100 dark:hover:bg-white/8 hover:text-slate-900 dark:hover:text-white min-h-[38px]"
                  >
                    <Eye className="w-3.5 h-3.5 text-[#7C3AED] dark:text-[#A78BFA]" aria-hidden="true" />
                    Preview File
                  </button>
                )}
                {rowMenu.file.file_extension.toLowerCase() === '.zip' && (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={uploading}
                    onClick={() => {
                      const f = rowMenu.file!;
                      setRowMenu(null);
                      void handleExtractStoredZip(f);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 min-h-[38px] disabled:opacity-50"
                  >
                    <PackageOpen className="w-3.5 h-3.5" aria-hidden="true" />
                    Extract ZIP Here
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    const f = rowMenu.file!;
                    setRowMenu(null);
                    setRenamingItem({ kind: 'file', id: f.id, name: f.name });
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-slate-700 dark:text-[#E2E8F0] hover:bg-slate-100 dark:hover:bg-white/8 hover:text-slate-900 dark:hover:text-white min-h-[38px]"
                >
                  <Pencil className="w-3.5 h-3.5 text-slate-400 dark:text-[#94A3B8]" aria-hidden="true" />
                  Rename
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    const f = rowMenu.file!;
                    setRowMenu(null);
                    setMovingTarget({
                      mode: 'move',
                      kind: 'file',
                      id: f.id,
                      title: `Move "${f.name}"`,
                    });
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-slate-700 dark:text-[#E2E8F0] hover:bg-slate-100 dark:hover:bg-white/8 hover:text-slate-900 dark:hover:text-white min-h-[38px]"
                >
                  <FolderInput className="w-3.5 h-3.5 text-slate-400 dark:text-[#94A3B8]" aria-hidden="true" />
                  Move to...
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    const f = rowMenu.file!;
                    setRowMenu(null);
                    setMovingTarget({
                      mode: 'copy',
                      kind: 'file',
                      id: f.id,
                      title: `Copy "${f.name}"`,
                    });
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-slate-700 dark:text-[#E2E8F0] hover:bg-slate-100 dark:hover:bg-white/8 hover:text-slate-900 dark:hover:text-white min-h-[38px]"
                >
                  <Copy className="w-3.5 h-3.5 text-[#0891B2] dark:text-[#06B6D4]" aria-hidden="true" />
                  Copy to...
                </button>
                <div className="my-1 border-t border-slate-200 dark:border-white/8" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    const f = rowMenu.file!;
                    setRowMenu(null);
                    requestTrashFile(f);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-red-600 dark:text-red-300 hover:bg-red-500/10 dark:hover:bg-red-500/15 min-h-[38px]"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  Move to Trash
                </button>
              </>
            )}
          </div>
        </>
      )}

      {/* Rename Modal */}
      {renamingItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 dark:bg-black/75 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setRenamingItem(null);
          }}
        >
          <form
            onSubmit={handleRenameSubmit}
            className="vault-glass w-full max-w-md rounded-xl p-5 space-y-4"
          >
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Rename {renamingItem.kind === 'folder' ? 'Folder' : 'File'}
            </h3>
            <input
              type="text"
              required
              autoFocus
              value={renamingItem.name}
              onChange={(e) =>
                setRenamingItem((prev) => (prev ? { ...prev, name: e.target.value } : null))
              }
              className="vault-glow-ring w-full px-3.5 py-2.5 text-sm rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenamingItem(null)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 text-slate-700 dark:text-[#CBD5E1] hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 min-h-[40px]"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white min-h-[40px]"
              >
                Save Name
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Move / Copy Modal */}
      {movingTarget && (
        <MoveItemsModal
          title={movingTarget.title}
          folders={folders}
          currentFolderId={currentFolderId}
          blockedFolderId={movingTarget.kind === 'folder' ? movingTarget.id : null}
          actionLabel={movingTarget.mode === 'copy' ? 'Copy Here' : 'Move Here'}
          onClose={() => setMovingTarget(null)}
          onConfirm={async (destinationFolderId) => {
            const ready = driveConnected || (await onEnsureDriveConnected());
            if (!ready) {
              throw new Error(
                `Connect Google Drive before ${movingTarget.mode === 'copy' ? 'copying' : 'moving'} items.`,
              );
            }

            try {
              if (movingTarget.mode === 'copy') {
                if (movingTarget.kind === 'file' && movingTarget.id) {
                  await apiRequest(
                    `/api/vault/files/${encodeURIComponent(movingTarget.id)}/copy`,
                    accessToken,
                    {
                      method: 'POST',
                      body: JSON.stringify({ folderId: destinationFolderId }),
                    },
                    googleDriveToken,
                  );
                } else if (movingTarget.kind === 'files' && movingTarget.fileIds) {
                  await Promise.all(
                    movingTarget.fileIds.map((fid) =>
                      apiRequest(
                        `/api/vault/files/${encodeURIComponent(fid)}/copy`,
                        accessToken,
                        {
                          method: 'POST',
                          body: JSON.stringify({ folderId: destinationFolderId }),
                        },
                        googleDriveToken,
                      ),
                    ),
                  );
                  setSelectedFileIds(new Set());
                }
                onNotify('success', 'Copied successfully');
              } else {
                if (movingTarget.kind === 'folder' && movingTarget.id) {
                  await apiRequest(
                    `/api/vault/folders/${encodeURIComponent(movingTarget.id)}`,
                    accessToken,
                    {
                      method: 'PATCH',
                      body: JSON.stringify({ parentId: destinationFolderId }),
                    },
                    googleDriveToken,
                  );
                } else if (movingTarget.kind === 'file' && movingTarget.id) {
                  await apiRequest(
                    `/api/vault/files/${encodeURIComponent(movingTarget.id)}`,
                    accessToken,
                    {
                      method: 'PATCH',
                      body: JSON.stringify({ folderId: destinationFolderId }),
                    },
                    googleDriveToken,
                  );
                } else if (movingTarget.kind === 'files' && movingTarget.fileIds) {
                  await Promise.all(
                    movingTarget.fileIds.map((fid) =>
                      apiRequest(
                        `/api/vault/files/${encodeURIComponent(fid)}`,
                        accessToken,
                        {
                          method: 'PATCH',
                          body: JSON.stringify({ folderId: destinationFolderId }),
                        },
                        googleDriveToken,
                      ),
                    ),
                  );
                  setSelectedFileIds(new Set());
                }
                onNotify('success', 'Moved successfully');
              }
              await onRefresh();
            } catch (err) {
              if (err instanceof DriveAuthRequiredError) {
                onDriveAuthInvalid(err.message);
              }
              onNotify(
                'error',
                movingTarget.mode === 'copy' ? 'Copy failed' : 'Move failed',
                err instanceof Error ? err.message : 'Unable to complete operation.',
              );
              throw err;
            }
          }}
        />
      )}

      {/* Trash Confirmations */}
      {pendingDeleteFolder && (
        <ConfirmActionModal
          title={`Move folder "${pendingDeleteFolder.name}" to Trash?`}
          description="This moves the folder and everything inside it to Trash in Google Drive. You can restore it later from the Trash tab."
          items={[
            `${pendingDeleteFolder.name} (${
              folderStatsMap.get(pendingDeleteFolder.id)?.fileCount || 0
            } files · ${formatBytes(
              folderStatsMap.get(pendingDeleteFolder.id)?.totalBytes || 0,
            )})`,
          ]}
          confirmLabel="Move to Trash"
          busy={deletingBusy}
          onCancel={() => setPendingDeleteFolder(null)}
          onConfirm={() => handleTrashFolder(pendingDeleteFolder)}
        />
      )}

      {pendingDeleteFile && (
        <ConfirmActionModal
          title={`Move "${pendingDeleteFile.name}" to Trash?`}
          description="This moves the file to Trash in Google Drive. You can restore or permanently delete it from the Trash tab."
          items={[`${pendingDeleteFile.name} (${formatBytes(pendingDeleteFile.file_size_bytes)})`]}
          confirmLabel="Move to Trash"
          busy={deletingBusy}
          onCancel={() => setPendingDeleteFile(null)}
          onConfirm={() => handleTrashFile(pendingDeleteFile)}
        />
      )}

      {confirmBulkDeleteOpen && (
        <ConfirmActionModal
          title={`Move ${selectedFileIds.size} selected file${selectedFileIds.size === 1 ? '' : 's'} to Trash?`}
          description="Selected files will be moved to Trash in Google Drive so you can restore or permanently delete them later."
          items={selectedFileNames}
          confirmLabel={`Move ${selectedFileIds.size} to Trash`}
          busy={deletingBusy}
          onCancel={() => setConfirmBulkDeleteOpen(false)}
          onConfirm={handleBulkTrash}
        />
      )}

      {/* File Preview Modal */}
      {previewFile && (
        <FilePreviewModal
          file={previewFile}
          accessToken={accessToken}
          driveConnected={driveConnected}
          googleDriveToken={googleDriveToken}
          onConnectDrive={onEnsureDriveConnected}
          onDriveAuthInvalid={onDriveAuthInvalid}
          onClose={() => setPreviewFile(null)}
          onDownload={handleDownloadFile}
        />
      )}
    </div>
  );
}

import JSZip from 'jszip';
import { guessMimeType } from './format';

export interface ExtractedZipEntry {
  folderSegments: string[];
  fileName: string;
  blob: Blob;
  mimeType: string;
}

export interface DroppedFileEntry {
  folderSegments: string[];
  file: File;
}

const MAX_ZIP_ENTRIES = 2000;
const MAX_ZIP_UNCOMPRESSED_BYTES = 1.5 * 1024 * 1024 * 1024; // 1.5 GB safety cap

function validateSafeArchivePath(rawPath: string): string[] | null {
  if (!rawPath || rawPath.includes('\0') || rawPath.includes('\\')) {
    return null;
  }
  if (rawPath.startsWith('/') || /^[a-zA-Z]:/.test(rawPath)) {
    return null;
  }
  const parts = rawPath.split('/').filter((seg) => seg.length > 0);
  if (parts.length === 0) return null;

  for (const seg of parts) {
    if (seg === '.' || seg === '..') return null;
    for (let i = 0; i < seg.length; i++) {
      if (seg.charCodeAt(i) < 32) return null;
    }
  }
  return parts;
}

export async function extractZipSafely(
  zipBlob: Blob,
  options?: { maxFileBytes?: number },
): Promise<{ entries: ExtractedZipEntry[]; skippedEmptyOrMeta: number }> {
  const zip = await JSZip.loadAsync(zipBlob);
  const rawNames = Object.keys(zip.files);

  if (rawNames.length > MAX_ZIP_ENTRIES) {
    throw new Error(
      `ZIP archive contains ${rawNames.length} entries, exceeding the safety limit of ${MAX_ZIP_ENTRIES}.`,
    );
  }

  const entries: ExtractedZipEntry[] = [];
  let skippedEmptyOrMeta = 0;
  let totalUncompressed = 0;

  for (const rawName of rawNames) {
    const zipObj = zip.files[rawName];
    if (zipObj.dir) continue;

    const originalName =
      (zipObj as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName ||
      rawName;

    // Skip macOS metadata forks safely
    if (
      originalName.startsWith('__MACOSX/') ||
      originalName.endsWith('/.DS_Store') ||
      originalName === '.DS_Store'
    ) {
      skippedEmptyOrMeta += 1;
      continue;
    }

    const parts = validateSafeArchivePath(originalName);
    if (!parts) {
      throw new Error(
        `Unsafe path traversal or invalid path detected in ZIP entry: "${originalName}". Extraction aborted.`,
      );
    }

    const fileName = parts[parts.length - 1];
    const folderSegments = parts.slice(0, -1);

    const fileBlob = await zipObj.async('blob');
    if (fileBlob.size === 0) {
      skippedEmptyOrMeta += 1;
      continue;
    }

    totalUncompressed += fileBlob.size;
    if (totalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) {
      throw new Error(
        'Extracted archive size exceeds 1.5 GB safety limit (zip bomb protection).',
      );
    }

    if (options?.maxFileBytes && fileBlob.size > options.maxFileBytes) {
      throw new Error(
        `Extracted file "${fileName}" exceeds the maximum single-file upload size limit.`,
      );
    }

    const mimeType = guessMimeType(fileName);
    entries.push({
      folderSegments,
      fileName,
      blob: new Blob([fileBlob], { type: mimeType }),
      mimeType,
    });
  }

  return { entries, skippedEmptyOrMeta };
}

export interface BatchZipSourceItem {
  archivePath: string;
  downloadUrl: string;
}

export async function packageUrlsAsZip(
  items: BatchZipSourceItem[],
  onProgress?: (completed: number, total: number, currentLabel: string) => void,
  fetchOptions?: {
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
  },
): Promise<Blob> {
  const zip = new JSZip();
  const usedPaths = new Set<string>();
  let completed = 0;

  for (const item of items) {
    onProgress?.(completed, items.length, item.archivePath);

    const res = await fetch(item.downloadUrl, {
      method: fetchOptions?.method || 'GET',
      headers: fetchOptions?.headers,
    });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(
        errBody?.error ||
          `Failed to fetch "${item.archivePath}" from Google Drive (${res.status}).`,
      );
    }

    const blob = await res.blob();

    // Ensure unique archive path if two versions share a filename
    let safePath = item.archivePath.replace(/^\/+/, '');
    if (usedPaths.has(safePath.toLowerCase())) {
      const dot = safePath.lastIndexOf('.');
      const stem = dot > 0 ? safePath.slice(0, dot) : safePath;
      const ext = dot > 0 ? safePath.slice(dot) : '';
      let counter = 2;
      while (usedPaths.has(`${stem}_${counter}${ext}`.toLowerCase())) {
        counter += 1;
      }
      safePath = `${stem}_${counter}${ext}`;
    }
    usedPaths.add(safePath.toLowerCase());

    zip.file(safePath, blob);
    completed += 1;
    onProgress?.(completed, items.length, item.archivePath);
  }

  onProgress?.(items.length, items.length, 'Compressing .zip archive...');
  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 3 },
  });
}

// Recursive DataTransferItem directory scanner for drag-and-drop folder uploads
interface FileSystemEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (cb: (f: File) => void, err?: (e: unknown) => void) => void;
  createReader?: () => {
    readEntries: (
      cb: (entries: FileSystemEntryLike[]) => void,
      err?: (e: unknown) => void,
    ) => void;
  };
}

function readAllDirectoryEntries(entry: FileSystemEntryLike): Promise<FileSystemEntryLike[]> {
  return new Promise((resolve, reject) => {
    const reader = entry.createReader?.();
    if (!reader) {
      resolve([]);
      return;
    }
    const all: FileSystemEntryLike[] = [];
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(all);
        } else {
          all.push(...batch);
          readBatch();
        }
      }, reject);
    };
    readBatch();
  });
}

function entryToFile(entry: FileSystemEntryLike): Promise<File> {
  return new Promise((resolve, reject) => {
    if (!entry.file) {
      reject(new Error('File entry unreadable.'));
      return;
    }
    entry.file(resolve, reject);
  });
}

export async function collectDroppedItems(
  dataTransfer: DataTransfer,
): Promise<DroppedFileEntry[]> {
  const results: DroppedFileEntry[] = [];
  const items = Array.from(dataTransfer.items || []);

  const walk = async (entry: FileSystemEntryLike, parentSegments: string[]) => {
    if (entry.isFile) {
      const file = await entryToFile(entry);
      if (file.size > 0) {
        results.push({ folderSegments: parentSegments, file });
      }
      return;
    }
    if (entry.isDirectory) {
      const children = await readAllDirectoryEntries(entry);
      const nextSegments = [...parentSegments, entry.name];
      for (const child of children) {
        await walk(child, nextSegments);
      }
    }
  };

  let usedEntriesApi = false;
  for (const item of items) {
    const getEntry = (item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntryLike | null })
      .webkitGetAsEntry;
    if (typeof getEntry === 'function') {
      const entry = getEntry.call(item);
      if (entry) {
        usedEntriesApi = true;
        await walk(entry, []);
      }
    }
  }

  if (!usedEntriesApi) {
    const files = Array.from(dataTransfer.files || []);
    for (const file of files) {
      if (file.size > 0) {
        results.push({ folderSegments: [], file });
      }
    }
  }

  return results;
}

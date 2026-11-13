import type { ModLoader } from '../types/vault';

export const GOOGLE_DRIVE_DEFAULT_QUOTA_BYTES = 5 * 1024 * 1024 * 1024 * 1024; // 5 TB Google Drive

export function formatBytes(bytes: number, decimals = 2): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  const value = bytes / Math.pow(k, i);
  return `${value.toFixed(i === 0 ? 0 : decimals)} ${sizes[i]}`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function getLoaderDotColor(loader: ModLoader): string {
  switch (loader) {
    case 'Fabric':
      return '#A78BFA';
    case 'Forge':
      return '#3B82F6';
    case 'NeoForge':
      return '#F59E0B';
    case 'Quilt':
      return '#10B981';
  }
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'category'
  );
}

export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export async function computeSha256Blob(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(hash);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export type FileTypeBucket = 'Mods (.jar)' | 'Archives' | 'Images' | 'Docs & Configs' | 'Other';

const ARCHIVE_EXTS = new Set(['.zip', '.rar', '.7z', '.mrpack', '.tar', '.gz', '.bz2', '.xz']);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp', '.ico']);
const DOC_EXTS = new Set([
  '.pdf',
  '.txt',
  '.json',
  '.md',
  '.toml',
  '.yml',
  '.yaml',
  '.cfg',
  '.conf',
  '.ini',
  '.properties',
  '.mcmeta',
  '.log',
  '.csv',
  '.xml',
]);

export function classifyFileExtension(ext: string): FileTypeBucket {
  const normalized = ext.toLowerCase();
  if (normalized === '.jar') return 'Mods (.jar)';
  if (ARCHIVE_EXTS.has(normalized)) return 'Archives';
  if (IMAGE_EXTS.has(normalized)) return 'Images';
  if (DOC_EXTS.has(normalized)) return 'Docs & Configs';
  return 'Other';
}

export type PreviewKind = 'image' | 'pdf' | 'text' | null;

const TEXT_PREVIEW_EXTS = new Set([
  '.txt',
  '.json',
  '.md',
  '.toml',
  '.yml',
  '.yaml',
  '.cfg',
  '.conf',
  '.ini',
  '.properties',
  '.mcmeta',
  '.log',
  '.csv',
  '.xml',
  '.js',
  '.ts',
  '.css',
  '.html',
]);

export function getPreviewKind(ext: string, mimeType: string): PreviewKind {
  const lowerExt = ext.toLowerCase();
  const lowerMime = mimeType.toLowerCase();
  if (IMAGE_EXTS.has(lowerExt) || lowerMime.startsWith('image/')) return 'image';
  if (lowerExt === '.pdf' || lowerMime === 'application/pdf') return 'pdf';
  if (TEXT_PREVIEW_EXTS.has(lowerExt) || lowerMime.startsWith('text/')) return 'text';
  return null;
}

export function guessMimeType(fileName: string, fallback = 'application/octet-stream'): string {
  if (fallback && fallback !== 'application/octet-stream') return fallback;
  const idx = fileName.lastIndexOf('.');
  const ext = idx >= 0 ? fileName.slice(idx).toLowerCase() : '';
  const map: Record<string, string> = {
    '.jar': 'application/java-archive',
    '.mrpack': 'application/x-modrinth-modpack+zip',
    '.schematic': 'application/octet-stream',
    '.litematic': 'application/octet-stream',
    '.zip': 'application/zip',
    '.rar': 'application/vnd.rar',
    '.7z': 'application/x-7z-compressed',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.log': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.mcmeta': 'application/json',
    '.toml': 'application/toml',
    '.yml': 'text/yaml',
    '.yaml': 'text/yaml',
    '.cfg': 'text/plain',
    '.properties': 'text/plain',
    '.csv': 'text/csv',
    '.xml': 'application/xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
  };
  return map[ext] || 'application/octet-stream';
}

export function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { UploadAuthorization, VaultConfigStatus } from '../types/vault';
import { invalidateGoogleDriveToken } from './google-drive-auth';

let cachedClient: SupabaseClient | null = null;
let cachedKey = '';

const DRIVE_RESUMABLE_CHUNK_BYTES = 8 * 1024 * 1024; // 8 MB chunks (multiple of 256 KB per Google Drive API spec)

export class DriveAuthRequiredError extends Error {
  constructor(message = 'Google Drive connection required or expired.') {
    super(message);
    this.name = 'DriveAuthRequiredError';
  }
}

export async function fetchVaultConfig(): Promise<VaultConfigStatus> {
  const res = await fetch('/api/config', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Unable to reach MOD VAULT backend configuration endpoint.');
  }
  return (await res.json()) as VaultConfigStatus;
}

export function getSupabaseClient(config: VaultConfigStatus | null): SupabaseClient | null {
  const url =
    config?.supabaseUrl || (import.meta.env.VITE_SUPABASE_URL as string | undefined) || '';
  const anonKey =
    config?.supabaseAnonKey ||
    (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
    '';

  if (!url || !anonKey) return null;

  const key = `${url}::${anonKey}`;
  if (cachedClient && cachedKey === key) {
    return cachedClient;
  }

  cachedClient = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  cachedKey = key;
  return cachedClient;
}

export async function apiRequest<T>(
  path: string,
  accessToken: string,
  init: RequestInit = {},
  googleDriveToken?: string | null,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  if (googleDriveToken) {
    headers.set('X-Google-Drive-Token', googleDriveToken);
  }
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, {
    ...init,
    headers,
  });

  const payload = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
  } & T;

  if (!res.ok) {
    if (res.status === 401 && payload.code === 'DRIVE_AUTH_REQUIRED') {
      invalidateGoogleDriveToken();
      throw new DriveAuthRequiredError(payload.error || 'Google Drive session expired.');
    }
    throw new Error(payload.error || `Request failed (${res.status})`);
  }
  return payload;
}

export async function apiBlobRequest(
  path: string,
  accessToken: string,
  googleDriveToken: string | null,
  init: RequestInit = {},
): Promise<{ blob: Blob; contentType: string; fileName: string | null }> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  if (googleDriveToken) {
    headers.set('X-Google-Drive-Token', googleDriveToken);
  }
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, {
    ...init,
    headers,
  });

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as {
      error?: string;
      code?: string;
    };
    if (res.status === 401 && payload.code === 'DRIVE_AUTH_REQUIRED') {
      invalidateGoogleDriveToken();
      throw new DriveAuthRequiredError(payload.error || 'Google Drive session expired.');
    }
    throw new Error(payload.error || `Download failed (${res.status})`);
  }

  const blob = await res.blob();
  const contentType = res.headers.get('Content-Type') || 'application/octet-stream';
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const fileName = match ? decodeURIComponent(match[1]) : null;
  return { blob, contentType, fileName };
}

function sendChunkXhr(options: {
  url: string;
  chunk: Blob;
  contentType: string;
  contentRange?: string;
  extraHeaders?: Record<string, string>;
  signal?: AbortSignal;
  onProgress: (loadedInChunk: number) => void;
}): Promise<{ status: number; responseText: string }> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new DOMException('Upload cancelled by user.', 'AbortError'));
      return;
    }

    const xhr = new XMLHttpRequest();
    const onAbort = () => {
      xhr.abort();
      reject(new DOMException('Upload cancelled by user.', 'AbortError'));
    };

    if (options.signal) {
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    const cleanup = () => {
      if (options.signal) {
        options.signal.removeEventListener('abort', onAbort);
      }
    };

    xhr.open('PUT', options.url, true);
    xhr.setRequestHeader('Content-Type', options.contentType || 'application/octet-stream');
    if (options.contentRange) {
      xhr.setRequestHeader('Content-Range', options.contentRange);
    }
    if (options.extraHeaders) {
      for (const [k, v] of Object.entries(options.extraHeaders)) {
        xhr.setRequestHeader(k, v);
      }
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        options.onProgress(event.loaded);
      }
    };

    xhr.onload = () => {
      cleanup();
      resolve({ status: xhr.status, responseText: xhr.responseText || '' });
    };

    xhr.onerror = () => {
      cleanup();
      reject(new Error('XHR_NETWORK_ERROR'));
    };

    xhr.onabort = () => {
      cleanup();
      reject(new DOMException('Upload cancelled by user.', 'AbortError'));
    };

    xhr.send(options.chunk);
  });
}

function parseDriveUploadResult(
  status: number,
  responseText: string,
): { driveFileId: string; mimeType: string; fileSizeBytes: number } {
  if (status < 200 || status >= 300) {
    let message = `Google Drive upload failed (${status}).`;
    try {
      const parsed = JSON.parse(responseText) as {
        error?: { message?: string; errors?: Array<{ reason?: string }> } | string;
      };
      if (typeof parsed.error === 'string') {
        message = parsed.error;
      } else if (parsed.error?.message) {
        message = parsed.error.message;
      }
    } catch {
      // Ignore non-JSON body
    }
    throw new Error(message);
  }

  const data = JSON.parse(responseText) as {
    id?: string;
    mimeType?: string;
    size?: string | number;
  };
  if (!data.id) {
    throw new Error('Google Drive upload completed without returning a file ID.');
  }

  return {
    driveFileId: data.id,
    mimeType: data.mimeType || 'application/octet-stream',
    fileSizeBytes: Number(data.size || 0) || 0,
  };
}

/**
 * Resumable chunked upload to Google Drive API v3 (`uploadType=resumable`).
 * Attempts direct browser PUT to Google Drive's pre-authenticated session URI first,
 * and falls back seamlessly to the authenticated Express chunk relay `/api/uploads/chunk`
 * if CORS or proxy constraints block direct PUTs.
 */
export async function uploadToGoogleDriveResumable(options: {
  authz: UploadAuthorization;
  file: Blob;
  contentType: string;
  accessToken: string;
  signal?: AbortSignal;
  onProgress: (loadedBytes: number, totalBytes: number, percent: number) => void;
}): Promise<{ driveFileId: string; mimeType: string; fileSizeBytes: number }> {
  const { authz, file, contentType, accessToken, signal, onProgress } = options;
  const totalBytes = file.size;
  const effectiveMime = contentType || authz.mimeType || 'application/octet-stream';

  if (signal?.aborted) {
    throw new DOMException('Upload cancelled by user.', 'AbortError');
  }

  let useProxy = false;

  // Single-request resumable PUT for files <= 8 MB
  if (totalBytes <= DRIVE_RESUMABLE_CHUNK_BYTES) {
    try {
      const directRes = await sendChunkXhr({
        url: authz.uploadSessionUri,
        chunk: file,
        contentType: effectiveMime,
        contentRange: `bytes 0-${totalBytes - 1}/${totalBytes}`,
        signal,
        onProgress: (loaded) => {
          const pct = Math.min(100, Math.round((loaded / totalBytes) * 100));
          onProgress(Math.min(loaded, totalBytes), totalBytes, pct);
        },
      });
      onProgress(totalBytes, totalBytes, 100);
      return parseDriveUploadResult(directRes.status, directRes.responseText);
    } catch (err) {
      if (!(err instanceof Error) || err.message !== 'XHR_NETWORK_ERROR') {
        throw err;
      }
      useProxy = true;
    }
  }

  // Multi-chunk resumable upload (8 MB chunks) for large .jar / .zip / archive files
  let offset = 0;
  while (offset < totalBytes) {
    if (signal?.aborted) {
      throw new DOMException('Upload cancelled by user.', 'AbortError');
    }

    const end = Math.min(offset + DRIVE_RESUMABLE_CHUNK_BYTES, totalBytes);
    const chunk = file.slice(offset, end);
    const contentRange = `bytes ${offset}-${end - 1}/${totalBytes}`;

    let result: { status: number; responseText: string };

    if (!useProxy) {
      try {
        result = await sendChunkXhr({
          url: authz.uploadSessionUri,
          chunk,
          contentType: effectiveMime,
          contentRange,
          signal,
          onProgress: (loadedInChunk) => {
            const loaded = Math.min(totalBytes, offset + loadedInChunk);
            const pct = Math.min(100, Math.round((loaded / totalBytes) * 100));
            onProgress(loaded, totalBytes, pct);
          },
        });
      } catch (err) {
        if (!(err instanceof Error) || err.message !== 'XHR_NETWORK_ERROR') {
          throw err;
        }
        useProxy = true;
        result = await sendChunkXhr({
          url: '/api/uploads/chunk',
          chunk,
          contentType: effectiveMime,
          contentRange,
          signal,
          extraHeaders: {
            Authorization: `Bearer ${accessToken}`,
            'X-Upload-Session-Uri': authz.uploadSessionUri,
          },
          onProgress: (loadedInChunk) => {
            const loaded = Math.min(totalBytes, offset + loadedInChunk);
            const pct = Math.min(100, Math.round((loaded / totalBytes) * 100));
            onProgress(loaded, totalBytes, pct);
          },
        });
      }
    } else {
      result = await sendChunkXhr({
        url: '/api/uploads/chunk',
        chunk,
        contentType: effectiveMime,
        contentRange,
        signal,
        extraHeaders: {
          Authorization: `Bearer ${accessToken}`,
          'X-Upload-Session-Uri': authz.uploadSessionUri,
        },
        onProgress: (loadedInChunk) => {
          const loaded = Math.min(totalBytes, offset + loadedInChunk);
          const pct = Math.min(100, Math.round((loaded / totalBytes) * 100));
          onProgress(loaded, totalBytes, pct);
        },
      });
    }

    if (result.status === 308) {
      offset = end;
      const pct = Math.min(99, Math.round((offset / totalBytes) * 100));
      onProgress(offset, totalBytes, pct);
      continue;
    }

    onProgress(totalBytes, totalBytes, 100);
    return parseDriveUploadResult(result.status, result.responseText);
  }

  throw new Error('Google Drive resumable upload terminated before confirmation.');
}

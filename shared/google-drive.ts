// Google Drive API v3 helper for MOD VAULT (Backend-mediated private storage)

export const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
export const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
export const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
export const DRIVE_ROOT_FOLDER_NAME = 'MOD VAULT';

export const DRIVE_SUBFOLDERS = {
  mods: 'Mods',
  vault: 'Vault',
  thumbnails: 'Thumbnails',
} as const;

export class DriveApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code = 'DRIVE_API_ERROR') {
    super(message);
    this.name = 'DriveApiError';
    this.status = status;
    this.code = code;
  }
}

export interface DriveQuotaInfo {
  limitBytes: number | null;
  usageBytes: number;
  usageInDriveBytes: number;
  usageInTrashBytes: number;
  userEmail: string | null;
  userDisplayName: string | null;
}

export interface DriveFileResource {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  parents?: string[];
  createdTime?: string;
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export async function parseDriveError(res: Response, fallbackMessage: string): Promise<DriveApiError> {
  const rawText = await res.text().catch(() => '');
  let reason = '';
  let message = fallbackMessage;

  try {
    const parsed = JSON.parse(rawText) as {
      error?: {
        message?: string;
        errors?: Array<{ reason?: string; message?: string }>;
      };
    };
    if (parsed.error?.message) {
      message = parsed.error.message;
    }
    if (parsed.error?.errors?.[0]?.reason) {
      reason = parsed.error.errors[0].reason;
    }
  } catch {
    if (rawText) message = rawText.slice(0, 240);
  }

  if (res.status === 401) {
    return new DriveApiError(
      'Google Drive authorization expired or missing. Reconnect your Google Drive account.',
      401,
      'DRIVE_AUTH_REQUIRED',
    );
  }

  if (res.status === 403 && reason === 'accessNotConfigured') {
    return new DriveApiError(
      'Google Drive API (drive.googleapis.com) is disabled on the Google Cloud project. Enable it in Google Cloud Console and retry.',
      403,
      'DRIVE_API_DISABLED',
    );
  }

  if (
    res.status === 403 &&
    (reason === 'storageQuotaExceeded' || message.toLowerCase().includes('storage quota'))
  ) {
    return new DriveApiError(
      'Google Drive storage quota exceeded. Free space in Drive before uploading.',
      507,
      'DRIVE_QUOTA_EXCEEDED',
    );
  }

  if (
    res.status === 429 ||
    (res.status === 403 &&
      (reason === 'userRateLimitExceeded' ||
        reason === 'rateLimitExceeded' ||
        reason === 'dailyLimitExceeded'))
  ) {
    return new DriveApiError(
      'Google Drive API rate limit reached. Wait a moment and retry.',
      429,
      'DRIVE_RATE_LIMITED',
    );
  }

  if (
    res.status === 403 &&
    (reason === 'insufficientFilePermissions' || reason === 'insufficientPermissions')
  ) {
    return new DriveApiError(
      'Insufficient Google Drive permissions. Reconnect Google Drive and grant Drive file access.',
      403,
      'DRIVE_FORBIDDEN',
    );
  }

  if (res.status === 404) {
    return new DriveApiError('File or folder no longer exists in Google Drive.', 404, 'DRIVE_NOT_FOUND');
  }

  return new DriveApiError(message, res.status || 502, reason || 'DRIVE_API_ERROR');
}

export async function getDriveQuotaAndUser(accessToken: string): Promise<DriveQuotaInfo> {
  const res = await fetch(
    `${DRIVE_API_BASE}/about?fields=${encodeURIComponent(
      'storageQuota(limit,usage,usageInDrive,usageInDriveTrash),user(emailAddress,displayName)',
    )}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(8000),
    },
  );

  if (!res.ok) {
    const driveErr = await parseDriveError(res, 'Failed to fetch Google Drive quota and user details.');
    if (driveErr.code === 'DRIVE_FORBIDDEN') {
      return {
        limitBytes: 5 * 1024 * 1024 * 1024 * 1024,
        usageBytes: 0,
        usageInDriveBytes: 0,
        usageInTrashBytes: 0,
        userEmail: null,
        userDisplayName: null,
      };
    }
    throw driveErr;
  }

  const data = (await res.json()) as {
    storageQuota?: {
      limit?: string;
      usage?: string;
      usageInDrive?: string;
      usageInTrash?: string;
      usageInDriveTrash?: string;
    };
    user?: {
      emailAddress?: string;
      displayName?: string;
    };
  };

  const limitNum = data.storageQuota?.limit ? Number(data.storageQuota.limit) : null;
  return {
    limitBytes: limitNum && Number.isFinite(limitNum) && limitNum > 0 ? limitNum : null,
    usageBytes: Number(data.storageQuota?.usage || 0) || 0,
    usageInDriveBytes: Number(data.storageQuota?.usageInDrive || 0) || 0,
    usageInTrashBytes: Number(data.storageQuota?.usageInDriveTrash || 0) || 0,
    userEmail: data.user?.emailAddress || null,
    userDisplayName: data.user?.displayName || null,
  };
}

export interface VerifiedDriveTokenInfo {
  email: string | null;
  emailVerified: boolean;
  scopes: string[];
  expiresInSeconds: number;
  expiresAtMs: number;
}

export async function verifyGoogleDriveToken(
  accessToken: string,
): Promise<VerifiedDriveTokenInfo> {
  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
    { signal: AbortSignal.timeout(8000) },
  );

  if (!res.ok) {
    throw new DriveApiError(
      'Google Drive authorization is invalid or expired. Reconnect Google Drive.',
      401,
      'DRIVE_AUTH_REQUIRED',
    );
  }

  const data = (await res.json()) as {
    email?: string;
    email_verified?: string | boolean;
    scope?: string;
    expires_in?: string | number;
  };

  const scopes = String(data.scope || '')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const hasDriveScope = scopes.some(
    (s) =>
      s === 'https://www.googleapis.com/auth/drive.file' ||
      s === 'https://www.googleapis.com/auth/drive',
  );

  if (!hasDriveScope) {
    throw new DriveApiError(
      'Google Drive file permission (drive.file) was not granted. Reconnect and approve Google Drive access.',
      403,
      'DRIVE_FORBIDDEN',
    );
  }

  const expiresInNum = Number(data.expires_in || 0);
  const expiresInSeconds = Number.isFinite(expiresInNum) && expiresInNum > 0 ? expiresInNum : 3300;
  const email = typeof data.email === 'string' && data.email.trim() ? data.email.trim() : null;
  const emailVerified =
    data.email_verified === true || String(data.email_verified || '').toLowerCase() === 'true';

  return {
    email,
    emailVerified,
    scopes,
    expiresInSeconds,
    expiresAtMs: Date.now() + expiresInSeconds * 1000,
  };
}

export async function findDriveFolder(
  accessToken: string,
  name: string,
  parentId: string | null,
): Promise<string | null> {
  const parentClause = parentId
    ? `'${escapeDriveQueryValue(parentId)}' in parents`
    : `'root' in parents`;
  const q = `mimeType='${DRIVE_FOLDER_MIME}' and name='${escapeDriveQueryValue(
    name,
  )}' and trashed=false and ${parentClause}`;

  const url = `${DRIVE_API_BASE}/files?q=${encodeURIComponent(
    q,
  )}&fields=files(id,name)&pageSize=1&spaces=drive`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    throw await parseDriveError(res, `Failed to look up Google Drive folder "${name}".`);
  }

  const data = (await res.json()) as { files?: Array<{ id: string; name: string }> };
  return data.files?.[0]?.id || null;
}

export async function createDriveFolder(
  accessToken: string,
  name: string,
  parentId: string | null,
): Promise<string> {
  const metadata: Record<string, unknown> = {
    name,
    mimeType: DRIVE_FOLDER_MIME,
  };
  if (parentId) {
    metadata.parents = [parentId];
  }

  const res = await fetch(`${DRIVE_API_BASE}/files?fields=id,name,parents`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(metadata),
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    throw await parseDriveError(res, `Failed to create Google Drive folder "${name}".`);
  }

  const created = (await res.json()) as { id: string };
  return created.id;
}

export async function ensureDriveFolder(
  accessToken: string,
  name: string,
  parentId: string | null,
): Promise<string> {
  const existingId = await findDriveFolder(accessToken, name, parentId);
  if (existingId) return existingId;
  return createDriveFolder(accessToken, name, parentId);
}

export async function ensureDriveVaultStructure(
  accessToken: string,
): Promise<{
  rootId: string;
  modsFolderId: string;
  vaultFolderId: string;
  thumbnailsFolderId: string;
}> {
  const rootId = await ensureDriveFolder(accessToken, DRIVE_ROOT_FOLDER_NAME, null);
  const [modsFolderId, vaultFolderId, thumbnailsFolderId] = await Promise.all([
    ensureDriveFolder(accessToken, DRIVE_SUBFOLDERS.mods, rootId),
    ensureDriveFolder(accessToken, DRIVE_SUBFOLDERS.vault, rootId),
    ensureDriveFolder(accessToken, DRIVE_SUBFOLDERS.thumbnails, rootId),
  ]);

  return {
    rootId,
    modsFolderId,
    vaultFolderId,
    thumbnailsFolderId,
  };
}

export async function initiateDriveResumableUpload(
  accessToken: string,
  options: {
    name: string;
    mimeType: string;
    parentId: string;
    originHeader?: string | null;
  },
): Promise<string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Upload-Content-Type': options.mimeType || 'application/octet-stream',
  };

  if (options.originHeader) {
    headers.Origin = options.originHeader;
  }

  const res = await fetch(
    `${DRIVE_UPLOAD_BASE}/files?uploadType=resumable&fields=id,name,mimeType,size,parents`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: options.name,
        mimeType: options.mimeType || 'application/octet-stream',
        parents: [options.parentId],
      }),
      signal: AbortSignal.timeout(10000),
    },
  );

  if (!res.ok) {
    throw await parseDriveError(
      res,
      `Failed to initialize resumable upload for "${options.name}" in Google Drive.`,
    );
  }

  const location = res.headers.get('location') || res.headers.get('Location');
  if (!location) {
    throw new DriveApiError(
      'Google Drive did not return a resumable upload session URI.',
      502,
      'DRIVE_MISSING_LOCATION',
    );
  }

  return location;
}

export async function uploadBytesToDriveResumable(
  accessToken: string,
  options: {
    name: string;
    mimeType: string;
    parentId: string;
    bytes: Uint8Array;
  },
): Promise<DriveFileResource> {
  const sessionUri = await initiateDriveResumableUpload(accessToken, {
    name: options.name,
    mimeType: options.mimeType,
    parentId: options.parentId,
  });

  const totalBytes = options.bytes.byteLength;
  const chunkSize = 8 * 1024 * 1024; // 8 MB multiple of 256 KB
  let offset = 0;
  let lastResource: DriveFileResource | null = null;

  while (offset < totalBytes || (totalBytes === 0 && offset === 0)) {
    const end = Math.min(offset + chunkSize, totalBytes);
    const slice = options.bytes.slice(offset, end);
    const headers: Record<string, string> = {
      'Content-Type': options.mimeType || 'application/octet-stream',
    };
    if (totalBytes > 0) {
      headers['Content-Range'] = `bytes ${offset}-${end - 1}/${totalBytes}`;
    }

    const res = await fetch(sessionUri, {
      method: 'PUT',
      headers,
      body: slice,
      signal: AbortSignal.timeout(120_000),
    });

    if (res.status === 308) {
      const rangeHeader = res.headers.get('Range');
      if (rangeHeader) {
        const match = rangeHeader.match(/bytes=0-(\d+)/);
        if (match) {
          offset = Number(match[1]) + 1;
          continue;
        }
      }
      offset = end;
      continue;
    }

    if (!res.ok) {
      throw await parseDriveError(res, `Failed uploading "${options.name}" to Google Drive.`);
    }

    lastResource = (await res.json()) as DriveFileResource;
    break;
  }

  if (!lastResource?.id) {
    throw new DriveApiError(
      'Google Drive upload completed without returning a file ID.',
      502,
      'DRIVE_UPLOAD_INCOMPLETE',
    );
  }

  return lastResource;
}

export async function getDriveFileMetadata(
  accessToken: string,
  driveFileId: string,
): Promise<DriveFileResource> {
  const res = await fetch(
    `${DRIVE_API_BASE}/files/${encodeURIComponent(driveFileId)}?fields=id,name,mimeType,size,parents,createdTime`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(8000),
    },
  );

  if (!res.ok) {
    throw await parseDriveError(res, 'Unable to verify file metadata in Google Drive.');
  }

  return (await res.json()) as DriveFileResource;
}

export async function updateDriveItem(
  accessToken: string,
  driveId: string,
  options: {
    name?: string;
    addParents?: string[];
    removeParents?: string[];
    trashed?: boolean;
  },
): Promise<DriveFileResource> {
  const params = new URLSearchParams({
    fields: 'id,name,mimeType,size,parents,trashed',
  });
  if (options.addParents && options.addParents.length > 0) {
    params.set('addParents', options.addParents.join(','));
  }
  if (options.removeParents && options.removeParents.length > 0) {
    params.set('removeParents', options.removeParents.join(','));
  }

  const body: Record<string, unknown> = {};
  if (typeof options.name === 'string' && options.name.trim()) {
    body.name = options.name.trim();
  }
  if (typeof options.trashed === 'boolean') {
    body.trashed = options.trashed;
  }

  const res = await fetch(
    `${DRIVE_API_BASE}/files/${encodeURIComponent(driveId)}?${params.toString()}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    },
  );

  if (!res.ok) {
    throw await parseDriveError(res, 'Failed to update item in Google Drive.');
  }

  return (await res.json()) as DriveFileResource;
}

export async function copyDriveFile(
  accessToken: string,
  sourceDriveFileId: string,
  options: {
    name?: string;
    parentId?: string;
  },
): Promise<DriveFileResource> {
  const metadata: Record<string, unknown> = {};
  if (options.name && options.name.trim()) {
    metadata.name = options.name.trim();
  }
  if (options.parentId) {
    metadata.parents = [options.parentId];
  }

  const res = await fetch(
    `${DRIVE_API_BASE}/files/${encodeURIComponent(sourceDriveFileId)}/copy?fields=id,name,mimeType,size,parents,createdTime`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(metadata),
      signal: AbortSignal.timeout(15000),
    },
  );

  if (!res.ok) {
    throw await parseDriveError(res, 'Failed to copy file in Google Drive.');
  }

  return (await res.json()) as DriveFileResource;
}

export async function setDriveItemsTrashedBatch(
  accessToken: string,
  driveIds: Array<string | null | undefined>,
  trashed: boolean,
): Promise<void> {
  const uniqueIds = Array.from(
    new Set(driveIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)),
  );
  if (uniqueIds.length === 0) return;

  for (let i = 0; i < uniqueIds.length; i += 5) {
    const chunk = uniqueIds.slice(i, i + 5);
    await Promise.all(
      chunk.map(async (id) => {
        try {
          await updateDriveItem(accessToken, id, { trashed });
        } catch (err) {
          if (err instanceof DriveApiError && err.status === 404) {
            return;
          }
          throw err;
        }
      }),
    );
  }
}

export async function findDriveFileByName(
  accessToken: string,
  name: string,
  parentId: string,
): Promise<string | null> {
  const q = `name='${escapeDriveQueryValue(name)}' and '${escapeDriveQueryValue(
    parentId,
  )}' in parents and trashed=false`;
  const url = `${DRIVE_API_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1&spaces=drive`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    throw await parseDriveError(res, `Failed to locate "${name}" in Google Drive.`);
  }

  const data = (await res.json()) as { files?: Array<{ id: string }> };
  return data.files?.[0]?.id || null;
}

export async function readDriveJsonFile<T>(
  accessToken: string,
  name: string,
  parentId: string,
): Promise<{ fileId: string | null; data: T | null }> {
  const fileId = await findDriveFileByName(accessToken, name, parentId);
  if (!fileId) return { fileId: null, data: null };

  const res = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    if (res.status === 404) return { fileId: null, data: null };
    throw await parseDriveError(res, `Failed to read "${name}" from Google Drive.`);
  }

  try {
    const parsed = (await res.json()) as T;
    return { fileId, data: parsed };
  } catch {
    return { fileId, data: null };
  }
}

export async function writeDriveJsonFile(
  accessToken: string,
  options: {
    fileId: string | null;
    name: string;
    parentId: string;
    data: unknown;
  },
): Promise<string> {
  const jsonText = JSON.stringify(options.data);
  if (options.fileId) {
    const res = await fetch(
      `${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(options.fileId)}?uploadType=media&fields=id`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: jsonText,
        signal: AbortSignal.timeout(12000),
      },
    );
    if (!res.ok) {
      throw await parseDriveError(res, `Failed to update "${options.name}" in Google Drive.`);
    }
    const parsed = (await res.json()) as { id: string };
    return parsed.id;
  }

  const boundary = `modvault_${Date.now().toString(36)}`;
  const metadataPart = JSON.stringify({
    name: options.name,
    mimeType: 'application/json',
    parents: [options.parentId],
  });
  const multipartBody = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadataPart,
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    jsonText,
    `--${boundary}--`,
    '',
  ].join('\r\n');

  const res = await fetch(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) {
    throw await parseDriveError(res, `Failed to create "${options.name}" in Google Drive.`);
  }

  const parsed = (await res.json()) as { id: string };
  return parsed.id;
}

export async function deleteDriveItem(
  accessToken: string,
  driveId: string,
): Promise<void> {
  if (!driveId) return;
  const res = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(driveId)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout(10000),
  });

  // Ignore 404 so stale DB metadata can still be cleaned up safely
  if (res.status === 404) return;
  if (!res.ok) {
    throw await parseDriveError(res, 'Failed to delete item from Google Drive.');
  }
}

export async function deleteDriveItemsBatch(
  accessToken: string,
  driveIds: Array<string | null | undefined>,
): Promise<void> {
  const uniqueIds = Array.from(
    new Set(driveIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)),
  );
  if (uniqueIds.length === 0) return;

  // Execute in small parallel batches to stay well below Drive per-second quotas
  for (let i = 0; i < uniqueIds.length; i += 5) {
    const chunk = uniqueIds.slice(i, i + 5);
    await Promise.all(chunk.map((id) => deleteDriveItem(accessToken, id)));
  }
}

export async function fetchDriveMediaResponse(
  accessToken: string,
  driveFileId: string,
): Promise<Response> {
  const res = await fetch(
    `${DRIVE_API_BASE}/files/${encodeURIComponent(driveFileId)}?alt=media`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!res.ok) {
    throw await parseDriveError(res, 'Failed to download file content from Google Drive.');
  }

  return res;
}

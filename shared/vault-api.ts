import {
  DriveApiError,
  copyDriveFile,
  createDriveFolder,
  deleteDriveItem,
  deleteDriveItemsBatch,
  ensureDriveVaultStructure,
  fetchDriveMediaResponse,
  getDriveFileMetadata,
  getDriveQuotaAndUser,
  initiateDriveResumableUpload,
  parseDriveError,
  readDriveJsonFile,
  setDriveItemsTrashedBatch,
  updateDriveItem,
  uploadBytesToDriveResumable,
  verifyGoogleDriveToken,
  writeDriveJsonFile,
} from './google-drive.ts';
import {
  clearServerDriveSession,
  getServerDriveSession,
  saveServerDriveSession,
} from './drive-sessions.ts';

export interface VaultEnv {
  OWNER_EMAIL?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  MAX_UPLOAD_MB?: string;
  ALLOWED_FILE_EXTENSIONS?: string;
}

interface SupabaseUser {
  id: string;
  email?: string;
}

interface ModVersionRow {
  id: string;
  mod_id: string;
  owner_id: string;
  file_name: string;
  mime_type?: string;
  drive_file_id: string | null;
  drive_parent_id: string | null;
  storage_path?: string | null;
  version_number: string;
  mc_version: string;
  loader: string;
  file_size_bytes: number;
  sha256: string;
}

interface ModRow {
  id: string;
  owner_id: string;
  category_id?: string | null;
  name?: string;
  slug?: string;
  description?: string;
  loader?: string;
  latest_mc_version?: string;
  thumbnail_key: string | null;
  thumbnail_drive_id?: string | null;
}

interface VaultFolderRow {
  id: string;
  owner_id: string;
  parent_id: string | null;
  drive_folder_id: string | null;
  drive_parent_id: string | null;
  name: string;
  created_at: string;
  updated_at: string;
}

interface VaultFileRow {
  id: string;
  owner_id: string;
  folder_id: string | null;
  name: string;
  file_extension: string;
  mime_type: string;
  drive_file_id: string | null;
  drive_parent_id: string | null;
  storage_path?: string | null;
  file_size_bytes: number;
  sha256: string;
  created_at: string;
  updated_at: string;
}

interface TrashManifestItem {
  trashId: string;
  kind: 'file' | 'folder' | 'mod' | 'version';
  title: string;
  subtitle: string;
  sizeBytes: number;
  deletedAt: string;
  driveIds: string[];
  payload: Record<string, unknown>;
}

const TRASH_MANIFEST_FILENAME = '.mod-vault-trash.json';

const VALID_LOADERS = new Set(['Forge', 'Fabric', 'NeoForge', 'Quilt']);

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function parseAllowedExtensions(raw: string | undefined): string[] {
  const trimmed = (raw || '*').trim();
  if (!trimmed || trimmed === '*') return ['*'];
  const parsed = trimmed
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .map((ext) => (ext.startsWith('.') ? ext : `.${ext}`));
  return parsed.length > 0 ? parsed : ['*'];
}

function resolveConfig(env: VaultEnv) {
  const supabaseUrl = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/(rest|auth)\/v1$/i, '');
  const supabaseAnonKey = (env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '').trim();
  const serviceRoleKey = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const ownerEmail = (env.OWNER_EMAIL || '').trim();

  // Default 5120 MB (5 GB per-file cap) suited for 5 TB Google Drive resumable uploads
  const maxUploadMbRaw = Number.parseInt(env.MAX_UPLOAD_MB || '5120', 10);
  const maxUploadMb = Number.isFinite(maxUploadMbRaw) && maxUploadMbRaw > 0 ? maxUploadMbRaw : 5120;
  const allowedExtensions = parseAllowedExtensions(env.ALLOWED_FILE_EXTENSIONS);

  const missingKeys: string[] = [];
  if (!ownerEmail) missingKeys.push('OWNER_EMAIL');
  if (!supabaseUrl) missingKeys.push('SUPABASE_URL');
  if (!supabaseAnonKey) missingKeys.push('SUPABASE_ANON_KEY');

  const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
  const serviceRoleConfigured = Boolean(serviceRoleKey);
  const ownerEmailConfigured = Boolean(ownerEmail);

  return {
    supabaseUrl,
    supabaseAnonKey,
    serviceRoleKey,
    ownerEmail,
    storageProvider: 'google-drive' as const,
    maxUploadMb,
    maxUploadBytes: maxUploadMb * 1024 * 1024,
    allowedExtensions,
    supabaseConfigured,
    serviceRoleConfigured,
    ownerEmailConfigured,
    configured: supabaseConfigured && ownerEmailConfigured,
    missingKeys,
  };
}

function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return '';
  const [local, domain] = email.split('@');
  if (local.length <= 2) return `${local[0] || '*'}***@${domain}`;
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

function extractBearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

function extractDriveToken(request: Request): string | null {
  const token = (request.headers.get('X-Google-Drive-Token') || '').trim();
  return token.length > 0 ? token : null;
}

function logDriveDiag(event: string, details: Record<string, unknown>) {
  console.info(`[MOD VAULT][Drive] ${event}`, details);
}

async function resolveDriveTokenOptional(
  request: Request,
  cfg: ReturnType<typeof resolveConfig>,
  ownerId: string,
): Promise<string | null> {
  const headerToken = extractDriveToken(request);
  if (headerToken) return headerToken;
  const stored = await getServerDriveSession(cfg, ownerId);
  return stored.session?.accessToken || null;
}

async function resolveDriveTokenRequired(
  request: Request,
  cfg: ReturnType<typeof resolveConfig>,
  ownerId: string,
): Promise<string | Response> {
  const headerToken = extractDriveToken(request);
  if (headerToken) return headerToken;

  const stored = await getServerDriveSession(cfg, ownerId);
  if (stored.session?.accessToken) {
    return stored.session.accessToken;
  }

  logDriveDiag('resolve_token_missing', {
    ownerId,
    hasHeaderToken: false,
    source: stored.source,
    expired: stored.expired,
    urlPath: new URL(request.url).pathname,
  });

  return jsonResponse(
    {
      code: 'DRIVE_AUTH_REQUIRED',
      error: stored.expired
        ? 'Google Drive session expired. Click Reconnect Google Drive to refresh access.'
        : 'Google Drive session not connected. Connect Google Drive to access private files.',
    },
    401,
  );
}

async function authenticateOwner(
  request: Request,
  cfg: ReturnType<typeof resolveConfig>,
): Promise<{ user: SupabaseUser; accessToken: string } | Response> {
  if (!cfg.supabaseConfigured || !cfg.ownerEmailConfigured) {
    return jsonResponse(
      {
        error:
          'Server environment is incomplete. Configure SUPABASE_URL, SUPABASE_ANON_KEY, and OWNER_EMAIL first.',
        missingKeys: cfg.missingKeys,
      },
      503,
    );
  }

  const accessToken = extractBearerToken(request);
  if (!accessToken) {
    return jsonResponse({ error: 'Missing Authorization Bearer token.' }, 401);
  }

  const userRes = await fetch(`${cfg.supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: cfg.supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!userRes.ok) {
    return jsonResponse({ error: 'Invalid or expired Supabase session.' }, 401);
  }

  const user = (await userRes.json()) as SupabaseUser;
  const userEmail = (user.email || '').trim().toLowerCase();
  if (!userEmail || userEmail !== cfg.ownerEmail.toLowerCase()) {
    return jsonResponse(
      { error: 'Access denied. Account is not in OWNER_EMAIL allowlist.' },
      403,
    );
  }

  return { user, accessToken };
}

async function supabaseRest<T>(
  cfg: ReturnType<typeof resolveConfig>,
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; data: T | null; errorText?: string }> {
  const headers = new Headers(init.headers);
  headers.set('apikey', cfg.supabaseAnonKey);
  headers.set('Authorization', `Bearer ${accessToken}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers,
  });

  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, data: null, errorText: text };
  }

  if (!text) {
    return { ok: true, status: res.status, data: null };
  }

  return { ok: true, status: res.status, data: JSON.parse(text) as T };
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._ -]/g, '_')
    .replace(/_{2,}/g, '_')
    .trim()
    .slice(0, 140);
}

function isUnsafeSegment(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..') return true;
  if (/[/\\\0]/.test(trimmed)) return true;
  if (/^[a-zA-Z]:/.test(trimmed)) return true;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed.charCodeAt(i) < 32) return true;
  }
  return false;
}

function sanitizeDisplayFilename(name: string): string {
  const base = name.trim().replace(/[\0/\\]/g, '_');
  return base.slice(0, 200);
}

function extractExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  if (idx <= 0 || idx === fileName.length - 1) return '';
  return fileName.slice(idx).toLowerCase();
}

function slugify(value: string): string {
  const base = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'mod';
}

function buildInFilter(ids: string[]): string {
  return `(${ids.map((id) => `"${id.replace(/"/g, '')}"`).join(',')})`;
}

function encodeContentDisposition(fileName: string, mode: 'attachment' | 'inline'): string {
  const asciiFallback = sanitizeFilename(fileName) || 'download';
  const encoded = encodeURIComponent(fileName);
  return `${mode}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * Resolves the Google Drive parent folder ID for a given `vault_folders.id` (or null for Vault root),
 * lazily materializing any legacy folders that don't yet have `drive_folder_id`.
 */
async function resolveDriveFolderId(options: {
  driveToken: string;
  cfg: ReturnType<typeof resolveConfig>;
  supabaseToken: string;
  userId: string;
  targetFolderId: string | null;
  vaultRootDriveId: string;
  allFolders?: VaultFolderRow[];
}): Promise<string> {
  const { driveToken, cfg, supabaseToken, userId, targetFolderId, vaultRootDriveId } = options;
  if (!targetFolderId) return vaultRootDriveId;

  let folders = options.allFolders;
  if (!folders) {
    const res = await supabaseRest<VaultFolderRow[]>(
      cfg,
      supabaseToken,
      `vault_folders?select=*&owner_id=eq.${encodeURIComponent(userId)}`,
    );
    if (!res.ok || !res.data) {
      throw new Error('Unable to load vault folders from Supabase.');
    }
    folders = res.data;
  }

  const byId = new Map(folders.map((f) => [f.id, f]));
  const chain: VaultFolderRow[] = [];
  let cursor: string | null = targetFolderId;
  let guard = 0;

  while (cursor && guard < 30) {
    const node = byId.get(cursor);
    if (!node) {
      throw new DriveApiError('Target vault folder not found.', 404, 'FOLDER_NOT_FOUND');
    }
    chain.unshift(node);
    cursor = node.parent_id || null;
    guard += 1;
  }

  let currentDriveParent = vaultRootDriveId;
  for (const node of chain) {
    if (node.drive_folder_id) {
      currentDriveParent = node.drive_folder_id;
      continue;
    }

    const createdDriveFolderId = await createDriveFolder(
      driveToken,
      node.name,
      currentDriveParent,
    );

    await supabaseRest(
      cfg,
      supabaseToken,
      `vault_folders?id=eq.${encodeURIComponent(node.id)}&owner_id=eq.${encodeURIComponent(userId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          drive_folder_id: createdDriveFolderId,
          drive_parent_id: currentDriveParent,
        }),
      },
    );

    node.drive_folder_id = createdDriveFolderId;
    node.drive_parent_id = currentDriveParent;
    currentDriveParent = createdDriveFolderId;
  }

  return currentDriveParent;
}

export async function handleApiRequest(
  request: Request,
  env: VaultEnv,
  runtimeLabel = 'express-server',
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const cfg = resolveConfig(env);
  let activeOwnerId: string | null = null;

  try {
    // 1. Public configuration & health check (exposes ZERO secret keys)
    if (method === 'GET' && (path === '/api/health' || path === '/api/config')) {
      let schemaReady: boolean | null = null;
      let ownerAccountReady: boolean | null = null;

      if (cfg.supabaseConfigured && cfg.serviceRoleConfigured) {
        const srHeaders = {
          apikey: cfg.serviceRoleKey,
          Authorization: `Bearer ${cfg.serviceRoleKey}`,
        };

        const [schemaRes, usersRes] = await Promise.all([
          fetch(`${cfg.supabaseUrl}/rest/v1/vault_files?select=drive_file_id&limit=1`, {
            headers: srHeaders,
            signal: AbortSignal.timeout(4000),
          }).catch(() => null),
          cfg.ownerEmailConfigured
            ? fetch(`${cfg.supabaseUrl}/auth/v1/admin/users?page=1&per_page=100`, {
                headers: srHeaders,
                signal: AbortSignal.timeout(4000),
              }).catch(() => null)
            : Promise.resolve(null),
        ]);

        if (schemaRes) schemaReady = schemaRes.ok;
        if (usersRes && usersRes.ok) {
          const usersBody = (await usersRes.json().catch(() => null)) as {
            users?: Array<{ email?: string }>;
          } | null;
          if (Array.isArray(usersBody?.users)) {
            const target = cfg.ownerEmail.toLowerCase();
            ownerAccountReady = usersBody.users.some(
              (u) => (u.email || '').trim().toLowerCase() === target,
            );
          }
        }
      }

      return jsonResponse({
        status: cfg.configured ? 'ready' : 'setup_required',
        runtime: runtimeLabel,
        configured: cfg.configured,
        supabaseConfigured: cfg.supabaseConfigured,
        serviceRoleConfigured: cfg.serviceRoleConfigured,
        storageProvider: cfg.storageProvider,
        storageConfigured: true,
        driveConfigured: true,
        ownerEmailConfigured: cfg.ownerEmailConfigured,
        ownerEmailHint: maskEmail(cfg.ownerEmail),
        storageBucket: null,
        maxUploadMb: cfg.maxUploadMb,
        allowedExtensions: cfg.allowedExtensions,
        missingKeys: cfg.missingKeys,
        supabaseUrl: cfg.supabaseUrl || null,
        supabaseAnonKey: cfg.supabaseAnonKey || null,
        schemaReady,
        storageBucketReady: true,
        ownerAccountReady,
      });
    }

    // 2. Verify owner session
    if (method === 'GET' && path === '/api/auth/verify') {
      const auth = await authenticateOwner(request, cfg);
      if (auth instanceof Response) return auth;
      return jsonResponse({
        authorized: true,
        ownerEmail: cfg.ownerEmail,
        userId: auth.user.id,
        email: auth.user.email,
      });
    }

    // 3a. Connect & persist Google Drive session on backend: POST /api/drive/connect
    if (method === 'POST' && path === '/api/drive/connect') {
      const auth = await authenticateOwner(request, cfg);
      if (auth instanceof Response) return auth;
      activeOwnerId = auth.user.id;

      const body = (await request.json().catch(() => null)) as {
        driveAccessToken?: string;
        accessToken?: string;
      } | null;
      const bodyToken =
        typeof body?.driveAccessToken === 'string'
          ? body.driveAccessToken.trim()
          : typeof body?.accessToken === 'string'
            ? body.accessToken.trim()
            : '';
      const headerToken = extractDriveToken(request);
      const driveToken = bodyToken || headerToken;

      logDriveDiag('connect_attempt', {
        ownerId: auth.user.id,
        hasBodyToken: Boolean(bodyToken),
        hasHeaderToken: Boolean(headerToken),
        tokenLength: driveToken ? driveToken.length : 0,
      });

      if (!driveToken) {
        return jsonResponse(
          {
            code: 'DRIVE_AUTH_REQUIRED',
            error:
              'Missing Google Drive access token. Sign in with Google Drive and approve file access on the consent screen.',
          },
          400,
        );
      }

      const tokenInfo = await verifyGoogleDriveToken(driveToken);
      if (
        cfg.ownerEmail &&
        tokenInfo.email &&
        tokenInfo.email.toLowerCase() !== cfg.ownerEmail.toLowerCase()
      ) {
        logDriveDiag('connect_account_mismatch', {
          ownerId: auth.user.id,
          verifiedEmail: maskEmail(tokenInfo.email),
        });
        return jsonResponse(
          {
            code: 'DRIVE_ACCOUNT_MISMATCH',
            error: `Connected Google account (${tokenInfo.email}) does not match OWNER_EMAIL (${maskEmail(
              cfg.ownerEmail,
            )}). Sign in with your owner Google account.`,
          },
          403,
        );
      }

      const [quota, folders] = await Promise.all([
        getDriveQuotaAndUser(driveToken),
        ensureDriveVaultStructure(driveToken),
      ]);

      const verifiedEmail = (tokenInfo.email || quota.userEmail || '').trim();
      if (
        cfg.ownerEmail &&
        verifiedEmail &&
        verifiedEmail.toLowerCase() !== cfg.ownerEmail.toLowerCase()
      ) {
        return jsonResponse(
          {
            code: 'DRIVE_ACCOUNT_MISMATCH',
            error: `Connected Google account (${verifiedEmail}) does not match OWNER_EMAIL (${maskEmail(
              cfg.ownerEmail,
            )}). Sign in with your owner Google account.`,
          },
          403,
        );
      }

      const { persistedInDb } = await saveServerDriveSession(cfg, {
        ownerId: auth.user.id,
        accessToken: driveToken,
        googleEmail: verifiedEmail || quota.userEmail || cfg.ownerEmail || null,
        googleName: quota.userDisplayName || null,
        expiresAtMs: tokenInfo.expiresAtMs,
        folders,
      });

      logDriveDiag('connect_success', {
        ownerId: auth.user.id,
        email: maskEmail(verifiedEmail || cfg.ownerEmail),
        expiresInSeconds: tokenInfo.expiresInSeconds,
        persistedInDb,
      });

      return jsonResponse({
        connected: true,
        email: verifiedEmail || quota.userEmail || cfg.ownerEmail || null,
        displayName: quota.userDisplayName || null,
        expiresAt: new Date(tokenInfo.expiresAtMs).toISOString(),
        expiresInSeconds: tokenInfo.expiresInSeconds,
        persisted: persistedInDb,
        quota: {
          ...quota,
          userEmail: quota.userEmail || verifiedEmail || cfg.ownerEmail || null,
        },
        folders,
      });
    }

    // 3b. Disconnect & clear backend Google Drive session: POST /api/drive/disconnect
    if (method === 'POST' && path === '/api/drive/disconnect') {
      const auth = await authenticateOwner(request, cfg);
      if (auth instanceof Response) return auth;
      await clearServerDriveSession(cfg, auth.user.id);
      logDriveDiag('disconnect', { ownerId: auth.user.id });
      return jsonResponse({ connected: false });
    }

    // 3c. Google Drive status, quota & folder verification: GET /api/drive/status
    if (method === 'GET' && path === '/api/drive/status') {
      const auth = await authenticateOwner(request, cfg);
      if (auth instanceof Response) return auth;
      activeOwnerId = auth.user.id;

      const headerToken = extractDriveToken(request);
      const storedLookup = headerToken ? null : await getServerDriveSession(cfg, auth.user.id);
      const effectiveToken = headerToken || storedLookup?.session?.accessToken || null;

      if (!effectiveToken) {
        logDriveDiag('status_disconnected', {
          ownerId: auth.user.id,
          expired: Boolean(storedLookup?.expired),
        });
        return jsonResponse({
          connected: false,
          email: null,
          displayName: null,
          expiresAt: null,
          expiresInSeconds: 0,
          persisted: false,
          quota: null,
          reason: storedLookup?.expired ? 'expired' : 'not_connected',
          error: storedLookup?.expired
            ? 'Google Drive session expired. Click Reconnect Google Drive.'
            : null,
        });
      }

      try {
        const [quota, folders] = await Promise.all([
          getDriveQuotaAndUser(effectiveToken),
          ensureDriveVaultStructure(effectiveToken),
        ]);

        const storedSession = storedLookup?.session || null;
        const expiresAtMs = storedSession?.expiresAtMs || Date.now() + 3000 * 1000;
        const expiresInSeconds = Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000));
        const connectedEmail =
          quota.userEmail || storedSession?.googleEmail || cfg.ownerEmail || null;

        let persistedInDb = Boolean(storedSession?.persistedInDb);
        if (headerToken) {
          const tokenInfo = await verifyGoogleDriveToken(headerToken).catch(() => null);
          const saved = await saveServerDriveSession(cfg, {
            ownerId: auth.user.id,
            accessToken: headerToken,
            googleEmail: tokenInfo?.email || connectedEmail,
            googleName: quota.userDisplayName || null,
            expiresAtMs: tokenInfo?.expiresAtMs || expiresAtMs,
            folders,
          });
          persistedInDb = saved.persistedInDb;
        }

        return jsonResponse({
          connected: true,
          email: connectedEmail,
          displayName: quota.userDisplayName || storedSession?.googleName || null,
          expiresAt: new Date(expiresAtMs).toISOString(),
          expiresInSeconds,
          persisted: persistedInDb,
          quota: {
            ...quota,
            userEmail: connectedEmail,
          },
          folders,
        });
      } catch (err) {
        if (err instanceof DriveApiError && err.status === 401) {
          await clearServerDriveSession(cfg, auth.user.id);
          logDriveDiag('status_token_expired', { ownerId: auth.user.id });
          return jsonResponse({
            connected: false,
            email: null,
            displayName: null,
            expiresAt: null,
            expiresInSeconds: 0,
            persisted: false,
            quota: null,
            reason: 'expired',
            error: 'Google Drive session expired. Click Reconnect Google Drive.',
          });
        }
        throw err;
      }
    }

    // 4. Server-side upload authorization & Google Drive resumable upload session
    if (method === 'POST' && path === '/api/uploads/authorize') {
      const auth = await authenticateOwner(request, cfg);
      if (auth instanceof Response) return auth;
      activeOwnerId = auth.user.id;
      const driveToken = await resolveDriveTokenRequired(request, cfg, auth.user.id);
      if (driveToken instanceof Response) return driveToken;

      const body = (await request.json().catch(() => null)) as {
        kind?: 'jar' | 'thumbnail' | 'vault_file';
        fileName?: string;
        mimeType?: string;
        fileSizeBytes?: number;
        sha256?: string;
        modId?: string;
        versionNumber?: string;
        mcVersion?: string;
        loader?: string;
        folderId?: string | null;
      } | null;

      if (!body || !body.fileName || typeof body.fileSizeBytes !== 'number') {
        return jsonResponse({ error: 'Invalid upload request payload.' }, 400);
      }

      const kind =
        body.kind === 'thumbnail'
          ? 'thumbnail'
          : body.kind === 'vault_file'
            ? 'vault_file'
            : 'jar';

      if (isUnsafeSegment(body.fileName)) {
        return jsonResponse({ error: 'Unsafe or invalid filename rejected.' }, 400);
      }

      const cleanFileName = sanitizeDisplayFilename(body.fileName);
      const structure = await ensureDriveVaultStructure(driveToken);
      const originHeader = request.headers.get('origin');

      if (kind === 'jar') {
        if (!cleanFileName.toLowerCase().endsWith('.jar')) {
          return jsonResponse(
            { error: 'Only .jar Minecraft mod files are permitted in Mod Upload.' },
            400,
          );
        }
        if (body.fileSizeBytes <= 0 || body.fileSizeBytes > cfg.maxUploadBytes) {
          return jsonResponse(
            { error: `File size must be between 1 byte and ${cfg.maxUploadMb} MB.` },
            400,
          );
        }
        if (!body.sha256 || !/^[a-f0-9]{64}$/.test(body.sha256)) {
          return jsonResponse({ error: 'Valid lowercase SHA-256 checksum is required.' }, 400);
        }

        const dupShaRes = await supabaseRest<ModVersionRow[]>(
          cfg,
          auth.accessToken,
          `mod_versions?select=id,file_name,version_number,mod_id&owner_id=eq.${encodeURIComponent(
            auth.user.id,
          )}&sha256=eq.${encodeURIComponent(body.sha256)}&limit=1`,
        );

        if (!dupShaRes.ok) {
          return jsonResponse(
            { error: 'Database duplicate check failed. Ensure updated schema.sql is applied.' },
            500,
          );
        }

        if (dupShaRes.data && dupShaRes.data.length > 0) {
          return jsonResponse(
            {
              error: `Duplicate .jar detected (identical SHA-256 already stored as ${dupShaRes.data[0].file_name} v${dupShaRes.data[0].version_number}).`,
            },
            409,
          );
        }

        if (body.modId && body.versionNumber && body.mcVersion && body.loader) {
          const dupVerRes = await supabaseRest<ModVersionRow[]>(
            cfg,
            auth.accessToken,
            `mod_versions?select=id&mod_id=eq.${encodeURIComponent(
              body.modId,
            )}&version_number=eq.${encodeURIComponent(
              body.versionNumber.trim(),
            )}&mc_version=eq.${encodeURIComponent(
              body.mcVersion.trim(),
            )}&loader=eq.${encodeURIComponent(body.loader.trim())}&limit=1`,
          );
          if (dupVerRes.ok && dupVerRes.data && dupVerRes.data.length > 0) {
            return jsonResponse(
              {
                error: `Version ${body.versionNumber} for ${body.loader} ${body.mcVersion} already exists for this mod.`,
              },
              409,
            );
          }
        }

        const mimeType = body.mimeType || 'application/java-archive';
        const uploadSessionUri = await initiateDriveResumableUpload(driveToken, {
          name: cleanFileName,
          mimeType,
          parentId: structure.modsFolderId,
          originHeader,
        });

        return jsonResponse({
          provider: 'google-drive',
          uploadSessionUri,
          driveParentId: structure.modsFolderId,
          fileName: cleanFileName,
          mimeType,
        });
      }

      if (kind === 'vault_file') {
        if (body.fileSizeBytes <= 0 || body.fileSizeBytes > cfg.maxUploadBytes) {
          return jsonResponse(
            { error: `File size must be between 1 byte and ${cfg.maxUploadMb} MB.` },
            400,
          );
        }
        if (!body.sha256 || !/^[a-f0-9]{64}$/.test(body.sha256)) {
          return jsonResponse({ error: 'Valid lowercase SHA-256 checksum is required.' }, 400);
        }

        const ext = extractExtension(body.fileName);
        if (!cfg.allowedExtensions.includes('*')) {
          if (!ext || !cfg.allowedExtensions.includes(ext)) {
            return jsonResponse(
              {
                error: `File extension "${ext || '(none)'}" is not in ALLOWED_FILE_EXTENSIONS (${cfg.allowedExtensions.join(', ')}).`,
              },
              400,
            );
          }
        }

        const driveParentId = await resolveDriveFolderId({
          driveToken,
          cfg,
          supabaseToken: auth.accessToken,
          userId: auth.user.id,
          targetFolderId: body.folderId || null,
          vaultRootDriveId: structure.vaultFolderId,
        });

        const mimeType = body.mimeType || 'application/octet-stream';
        const uploadSessionUri = await initiateDriveResumableUpload(driveToken, {
          name: cleanFileName,
          mimeType,
          parentId: driveParentId,
          originHeader,
        });

        return jsonResponse({
          provider: 'google-drive',
          uploadSessionUri,
          driveParentId,
          fileName: cleanFileName,
          mimeType,
        });
      }

      // Thumbnail upload validation (max 5 MB, png/jpg/webp)
      const lowerName = cleanFileName.toLowerCase();
      if (
        !lowerName.endsWith('.png') &&
        !lowerName.endsWith('.jpg') &&
        !lowerName.endsWith('.jpeg') &&
        !lowerName.endsWith('.webp')
      ) {
        return jsonResponse(
          { error: 'Thumbnails must be .png, .jpg, or .webp images.' },
          400,
        );
      }
      if (body.fileSizeBytes <= 0 || body.fileSizeBytes > 5 * 1024 * 1024) {
        return jsonResponse({ error: 'Thumbnail must be under 5 MB.' }, 400);
      }

      const mimeType =
        lowerName.endsWith('.webp')
          ? 'image/webp'
          : lowerName.endsWith('.png')
            ? 'image/png'
            : 'image/jpeg';

      const uploadSessionUri = await initiateDriveResumableUpload(driveToken, {
        name: cleanFileName,
        mimeType,
        parentId: structure.thumbnailsFolderId,
        originHeader,
      });

      return jsonResponse({
        provider: 'google-drive',
        uploadSessionUri,
        driveParentId: structure.thumbnailsFolderId,
        fileName: cleanFileName,
        mimeType,
      });
    }

    // 5. Fallback chunk upload relay to Google Drive resumable session URI: PUT /api/uploads/chunk
    if (method === 'PUT' && path === '/api/uploads/chunk') {
      const auth = await authenticateOwner(request, cfg);
      if (auth instanceof Response) return auth;

      const sessionUri = request.headers.get('X-Upload-Session-Uri') || '';
      if (!sessionUri.startsWith('https://www.googleapis.com/upload/drive/v3/files')) {
        return jsonResponse({ error: 'Invalid Google Drive upload session URI.' }, 400);
      }

      const forwardHeaders = new Headers();
      const contentType = request.headers.get('Content-Type');
      const contentRange = request.headers.get('Content-Range');
      if (contentType) forwardHeaders.set('Content-Type', contentType);
      if (contentRange) forwardHeaders.set('Content-Range', contentRange);

      const chunkBody = await request.arrayBuffer();
      const driveRes = await fetch(sessionUri, {
        method: 'PUT',
        headers: forwardHeaders,
        body: chunkBody,
      });

      // Google Drive returns 308 Resume Incomplete for intermediate chunks
      if (driveRes.status === 308) {
        const headers = new Headers({ 'Cache-Control': 'no-store' });
        const range = driveRes.headers.get('range');
        if (range) headers.set('X-Drive-Range', range);
        return new Response(null, { status: 308, headers });
      }

      if (!driveRes.ok) {
        throw await parseDriveError(driveRes, 'Resumable chunk upload to Google Drive failed.');
      }

      const text = await driveRes.text();
      return new Response(text || '{}', {
        status: driveRes.status,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }

    // 6. Create new mod + initial version record: POST /api/mods
    if (method === 'POST' && path === '/api/mods') {
      const auth = await authenticateOwner(request, cfg);
      if (auth instanceof Response) return auth;
      activeOwnerId = auth.user.id;
      const driveToken = await resolveDriveTokenOptional(request, cfg, auth.user.id);

      const body = (await request.json().catch(() => null)) as {
        name?: string;
        description?: string;
        categoryId?: string | null;
        loader?: string;
        mcVersion?: string;
        versionNumber?: string;
        fileName?: string;
        mimeType?: string;
        driveFileId?: string;
        driveParentId?: string | null;
        fileSizeBytes?: number;
        sha256?: string;
        changelog?: string;
        thumbnailDriveId?: string | null;
      } | null;

      if (
        !body ||
        !body.name?.trim() ||
        !body.loader ||
        !VALID_LOADERS.has(body.loader) ||
        !body.mcVersion?.trim() ||
        !body.versionNumber?.trim() ||
        !body.fileName?.toLowerCase().endsWith('.jar') ||
        !body.driveFileId?.trim() ||
        typeof body.fileSizeBytes !== 'number' ||
        body.fileSizeBytes <= 0 ||
        !body.sha256 ||
        !/^[a-f0-9]{64}$/.test(body.sha256)
      ) {
        return jsonResponse({ error: 'Invalid mod metadata payload.' }, 400);
      }

      let verifiedSize = body.fileSizeBytes;
      let verifiedParent = body.driveParentId || null;
      if (driveToken) {
        const meta = await getDriveFileMetadata(driveToken, body.driveFileId.trim());
        if (meta.size && Number(meta.size) > 0) verifiedSize = Number(meta.size);
        if (!verifiedParent && meta.parents?.[0]) verifiedParent = meta.parents[0];
      }

      const uniqueSlug = `${slugify(body.name)}-${crypto.randomUUID().slice(0, 6)}`;

      const modRes = await supabaseRest<ModRow[]>(
        cfg,
        auth.accessToken,
        'mods',
        {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            owner_id: auth.user.id,
            category_id: body.categoryId || null,
            name: body.name.trim(),
            slug: uniqueSlug,
            description: (body.description || '').trim(),
            loader: body.loader,
            latest_mc_version: body.mcVersion.trim(),
            thumbnail_key: body.thumbnailDriveId || null,
            thumbnail_drive_id: body.thumbnailDriveId || null,
          }),
        },
      );

      if (!modRes.ok || !modRes.data || modRes.data.length === 0) {
        if (driveToken) {
          await deleteDriveItemsBatch(driveToken, [
            body.driveFileId,
            body.thumbnailDriveId,
          ]).catch(() => undefined);
        }
        return jsonResponse(
          { error: `Failed to save mod record: ${modRes.errorText || 'Unknown error'}` },
          modRes.status || 500,
        );
      }

      const createdMod = modRes.data[0];

      const verRes = await supabaseRest<ModVersionRow[]>(
        cfg,
        auth.accessToken,
        'mod_versions',
        {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            mod_id: createdMod.id,
            owner_id: auth.user.id,
            version_number: body.versionNumber.trim(),
            mc_version: body.mcVersion.trim(),
            loader: body.loader,
            file_name: sanitizeDisplayFilename(body.fileName),
            mime_type: body.mimeType || 'application/java-archive',
            drive_file_id: body.driveFileId.trim(),
            drive_parent_id: verifiedParent,
            file_size_bytes: verifiedSize,
            sha256: body.sha256,
            changelog: (body.changelog || '').trim(),
          }),
        },
      );

      if (!verRes.ok || !verRes.data || verRes.data.length === 0) {
        await supabaseRest(
          cfg,
          auth.accessToken,
          `mods?id=eq.${encodeURIComponent(createdMod.id)}`,
          { method: 'DELETE' },
        );
        if (driveToken) {
          await deleteDriveItemsBatch(driveToken, [
            body.driveFileId,
            body.thumbnailDriveId,
          ]).catch(() => undefined);
        }
        return jsonResponse(
          { error: `Failed to save mod version: ${verRes.errorText || 'Duplicate or invalid data'}` },
          verRes.status === 409 ? 409 : 500,
        );
      }

      return jsonResponse({ mod: createdMod, version: verRes.data[0] }, 201);
    }

    // 7. Add a new version to an existing mod: POST /api/mods/:id/versions
    const addVersionMatch = path.match(/^\/api\/mods\/([^/]+)\/versions$/);
    if (method === 'POST' && addVersionMatch) {
      const auth = await authenticateOwner(request, cfg);
      if (auth instanceof Response) return auth;
      activeOwnerId = auth.user.id;
      const driveToken = await resolveDriveTokenOptional(request, cfg, auth.user.id);
      const modId = decodeURIComponent(addVersionMatch[1]);

      const body = (await request.json().catch(() => null)) as {
        loader?: string;
        mcVersion?: string;
        versionNumber?: string;
        fileName?: string;
        mimeType?: string;
        driveFileId?: string;
        driveParentId?: string | null;
        fileSizeBytes?: number;
        sha256?: string;
        changelog?: string;
      } | null;

      if (
        !body ||
        !body.loader ||
        !VALID_LOADERS.has(body.loader) ||
        !body.mcVersion?.trim() ||
        !body.versionNumber?.trim() ||
        !body.fileName?.toLowerCase().endsWith('.jar') ||
        !body.driveFileId?.trim() ||
        typeof body.fileSizeBytes !== 'number' ||
        body.fileSizeBytes <= 0 ||
        !body.sha256 ||
        !/^[a-f0-9]{64}$/.test(body.sha256)
      ) {
        return jsonResponse({ error: 'Invalid mod version payload.' }, 400);
      }

      let verifiedSize = body.fileSizeBytes;
      let verifiedParent = body.driveParentId || null;
      if (driveToken) {
        const meta = await getDriveFileMetadata(driveToken, body.driveFileId.trim());
        if (meta.size && Number(meta.size) > 0) verifiedSize = Number(meta.size);
        if (!verifiedParent && meta.parents?.[0]) verifiedParent = meta.parents[0];
      }

      const verRes = await supabaseRest<ModVersionRow[]>(
        cfg,
        auth.accessToken,
        'mod_versions',
        {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            mod_id: modId,
            owner_id: auth.user.id,
            version_number: body.versionNumber.trim(),
            mc_version: body.mcVersion.trim(),
            loader: body.loader,
            file_name: sanitizeDisplayFilename(body.fileName),
            mime_type: body.mimeType || 'application/java-archive',
            drive_file_id: body.driveFileId.trim(),
            drive_parent_id: verifiedParent,
            file_size_bytes: verifiedSize,
            sha256: body.sha256,
            changelog: (body.changelog || '').trim(),
          }),
        },
      );

      if (!verRes.ok || !verRes.data || verRes.data.length === 0) {
        if (driveToken) {
          await deleteDriveItem(driveToken, body.driveFileId.trim()).catch(() => undefined);
        }
        return jsonResponse(
          { error: `Failed to add version: ${verRes.errorText || 'Duplicate or forbidden'}` },
          verRes.status === 409 ? 409 : 500,
        );
      }

      await supabaseRest(
        cfg,
        auth.accessToken,
        `mods?id=eq.${encodeURIComponent(modId)}&owner_id=eq.${encodeURIComponent(auth.user.id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            latest_mc_version: body.mcVersion.trim(),
            loader: body.loader,
          }),
        },
      );

      return jsonResponse({ version: verRes.data[0] }, 201);
    }

    // 8. Update or delete a mod: PATCH/DELETE /api/mods/:id
    const modMatch = path.match(/^\/api\/mods\/([^/]+)$/);
    if (modMatch && (method === 'PATCH' || method === 'DELETE')) {
      const auth = await authenticateOwner(request, cfg);
      if (auth instanceof Response) return auth;
      activeOwnerId = auth.user.id;
      const modId = decodeURIComponent(modMatch[1]);
      const driveToken = await resolveDriveTokenOptional(request, cfg, auth.user.id);

      if (method === 'PATCH') {
        const body = (await request.json().catch(() => null)) as {
          name?: string;
          description?: string;
          categoryId?: string | null;
          loader?: string;
          latestMcVersion?: string;
          thumbnailDriveId?: string | null;
        } | null;

        if (!body) {
          return jsonResponse({ error: 'Invalid update payload.' }, 400);
        }

        const existingRes = await supabaseRest<ModRow[]>(
          cfg,
          auth.accessToken,
          `mods?select=id,owner_id,thumbnail_key,thumbnail_drive_id&id=eq.${encodeURIComponent(
            modId,
          )}&owner_id=eq.${encodeURIComponent(auth.user.id)}&limit=1`,
        );

        if (!existingRes.ok || !existingRes.data || existingRes.data.length === 0) {
          return jsonResponse({ error: 'Mod not found.' }, 404);
        }

        const updates: Record<string, unknown> = {};
        if (typeof body.name === 'string' && body.name.trim()) {
          updates.name = body.name.trim();
        }
        if (typeof body.description === 'string') {
          updates.description = body.description.trim();
        }
        if (body.categoryId !== undefined) {
          updates.category_id = body.categoryId || null;
        }
        if (body.loader && VALID_LOADERS.has(body.loader)) {
          updates.loader = body.loader;
        }
        if (typeof body.latestMcVersion === 'string' && body.latestMcVersion.trim()) {
          updates.latest_mc_version = body.latestMcVersion.trim();
        }
        if (body.thumbnailDriveId !== undefined) {
          updates.thumbnail_drive_id = body.thumbnailDriveId;
          updates.thumbnail_key = body.thumbnailDriveId;
        }

        const patchRes = await supabaseRest<ModRow[]>(
          cfg,
          auth.accessToken,
          `mods?id=eq.${encodeURIComponent(modId)}&owner_id=eq.${encodeURIComponent(auth.user.id)}`,
          {
            method: 'PATCH',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify(updates),
          },
        );

        if (!patchRes.ok || !patchRes.data) {
          return jsonResponse({ error: 'Failed to update mod.' }, 500);
        }

        const oldThumbId = existingRes.data[0].thumbnail_drive_id;
        if (
          driveToken &&
          body.thumbnailDriveId !== undefined &&
          oldThumbId &&
          oldThumbId !== body.thumbnailDriveId
        ) {
          await deleteDriveItem(driveToken, oldThumbId).catch(() => undefined);
        }

        return jsonResponse({ mod: patchRes.data[0] });
      }

      // DELETE /api/mods/:id
      const modLookup = await supabaseRest<ModRow[]>(
        cfg,
        auth.accessToken,
        `mods?select=id,owner_id,thumbnail_key,thumbnail_drive_id&id=eq.${encodeURIComponent(
          modId,
        )}&owner_id=eq.${encodeURIComponent(auth.user.id)}&limit=1`,
      );

      if (!modLookup.ok || !modLookup.data || modLookup.data.length === 0) {
        return jsonResponse({ error: 'Mod not found.' }, 404);
      }

      const versLookup = await supabaseRest<ModVersionRow[]>(
        cfg,
        auth.accessToken,
        `mod_versions?select=id,drive_file_id&mod_id=eq.${encodeURIComponent(
          modId,
        )}&owner_id=eq.${encodeURIComponent(auth.user.id)}`,
      );

      const driveIdsToDelete = (versLookup.data || [])
        .map((v) => v.drive_file_id)
        .filter((id): id is string => Boolean(id));
      if (modLookup.data[0].thumbnail_drive_id) {
        driveIdsToDelete.push(modLookup.data[0].thumbnail_drive_id);
      }

      if (driveIdsToDelete.length > 0) {
        const verifiedDriveToken = await resolveDriveTokenRequired(request, cfg, auth.user.id);
        if (verifiedDriveToken instanceof Response) return verifiedDriveToken;
        await deleteDriveItemsBatch(verifiedDriveToken, driveIdsToDelete);
      }

      const delRes = await supabaseRest(
        cfg,
        auth.accessToken,
        `mods?id=eq.${encodeURIComponent(modId)}&owner_id=eq.${encodeURIComponent(auth.user.id)}`,
        { method: 'DELETE' },
      );

      if (!delRes.ok) {
        return jsonResponse({ error: 'Failed to delete mod record.' }, 500);
      }

      return jsonResponse({ deleted: true, modId });
    }

    // 9. Batch lookup mod versions for authenticated ZIP packaging: POST /api/versions/sign-batch
    if (method === 'POST' && path === '/api/versions/sign-batch') {
      const auth = await authenticateOwner(request, cfg);
      if (auth instanceof Response) return auth;
      activeOwnerId = auth.user.id;
      const driveToken = await resolveDriveTokenRequired(request, cfg, auth.user.id);
      if (driveToken instanceof Response) return driveToken;

      const body = (await request.json().catch(() => null)) as {
        versionIds?: string[];
      } | null;

      const ids = Array.isArray(body?.versionIds)
        ? Array.from(new Set(body!.versionIds.filter((id) => typeof id === 'string' && id.trim())))
        : [];

      if (ids.length === 0 || ids.length > 250) {
        return jsonResponse(
          { error: 'Provide between 1 and 250 version IDs for batch download.' },
          400,
        );
      }

      const versRes = await supabaseRest<ModVersionRow[]>(
        cfg,
        auth.accessToken,
        `mod_versions?select=id,mod_id,file_name,drive_file_id,version_number,mc_version,loader,file_size_bytes&owner_id=eq.${encodeURIComponent(
          auth.user.id,
        )}&id=in.${encodeURIComponent(buildInFilter(ids))}`,
      );

      if (!versRes.ok || !versRes.data) {
        return jsonResponse({ error: 'Failed to look up requested mod versions.' }, 500);
      }

      const items = versRes.data
        .filter((ver) => Boolean(ver.drive_file_id))
        .map((ver) => ({
          id: ver.id,
          modId: ver.mod_id,
          fileName: ver.file_name,
          versionNumber: ver.version_number,
          mcVersion: ver.mc_version,
          loader: ver.loader,
          fileSizeBytes: ver.file_size_bytes,
          downloadUrl: `/api/versions/${encodeURIComponent(ver.id)}/download`,
        }));

      if (items.length === 0) {
        return jsonResponse(
          { error: 'Selected versions have no Google Drive file IDs.' },
          404,
        );
      }

      return jsonResponse({ items });
    }

    // 10. Delete a single version: DELETE /api/versions/:id
    const versionDelMatch = path.match(/^\/api\/versions\/([^/]+)$/);
    if (method === 'DELETE' && versionDelMatch) {
      const auth = await authenticateOwner(request, cfg);
      if (auth instanceof Response) return auth;
      const versionId = decodeURIComponent(versionDelMatch[1]);

      const verLookup = await supabaseRest<ModVersionRow[]>(
        cfg,
        auth.accessToken,
        `mod_versions?select=id,drive_file_id,mod_id&id=eq.${encodeURIComponent(
          versionId,
        )}&owner_id=eq.${encodeURIComponent(auth.user.id)}&limit=1`,
      );

      if (!verLookup.ok || !verLookup.data || verLookup.data.length === 0) {
        return jsonResponse({ error: 'Mod version not found.' }, 404);
      }

      if (verLookup.data[0].drive_file_id) {
        activeOwnerId = auth.user.id;
        const driveToken = await resolveDriveTokenRequired(request, cfg, auth.user.id);
        if (driveToken instanceof Response) return driveToken;
        await deleteDriveItem(driveToken, verLookup.data[0].drive_file_id);
      }

      const delRes = await supabaseRest(
        cfg,
        auth.accessToken,
        `mod_versions?id=eq.${encodeURIComponent(versionId)}&owner_id=eq.${encodeURIComponent(
          auth.user.id,
        )}`,
        { method: 'DELETE' },
      );

      if (!delRes.ok) {
        return jsonResponse({ error: 'Failed to delete version metadata.' }, 500);
      }

      return jsonResponse({ deleted: true, versionId });
    }

    // 11. Authenticated Google Drive stream download for mod version: POST /api/versions/:id/download
    const downloadMatch = path.match(/^\/api\/versions\/([^/]+)\/download$/);
    if (method === 'POST' && downloadMatch) {
      const auth = await authenticateOwner(request, cfg);
      if (auth instanceof Response) return auth;
      activeOwnerId = auth.user.id;
      const driveToken = await resolveDriveTokenRequired(request, cfg, auth.user.id);
      if (driveToken instanceof Response) return driveToken;

      const versionId = decodeURIComponent(downloadMatch[1]);
      const verLookup = await supabaseRest<ModVersionRow[]>(
        cfg,
        auth.accessToken,
        `mod_versions?select=id,file_name,mime_type,drive_file_id,file_size_bytes&id=eq.${encodeURIComponent(
          versionId,
        )}&owner_id=eq.${encodeURIComponent(auth.user.id)}&limit=1`,
      );

      if (!verLookup.ok || !verLookup.data || verLookup.data.length === 0) {
        return jsonResponse({ error: 'Mod version not found.' }, 404);
      }

      const ver = verLookup.data[0];
      if (!ver.drive_file_id) {
        return jsonResponse(
          {
            error:
              'This version has no Google Drive file ID. Re-upload the .jar file to store it in Google Drive.',
          },
          404,
        );
      }

      const driveRes = await fetchDriveMediaResponse(driveToken, ver.drive_file_id);
      const headers = new Headers();
      headers.set('Content-Type', ver.mime_type || 'application/java-archive');
      headers.set('Content-Disposition', encodeContentDisposition(ver.file_name, 'attachment'));
      headers.set('Cache-Control', 'no-store');
      if (ver.file_size_bytes) {
        headers.set('Content-Length', String(ver.file_size_bytes));
      }

      return new Response(driveRes.body, {
        status: 200,
        headers,
      });
    }

    // 12. Private thumbnail content proxy: GET /api/thumbnails/:driveId
    const thumbMatch = path.match(/^\/api\/thumbnails\/([^/]+)$/);
    if (method === 'GET' && thumbMatch) {
      const auth = await authenticateOwner(request, cfg);
      if (auth instanceof Response) return auth;
      activeOwnerId = auth.user.id;
      const driveToken = await resolveDriveTokenRequired(request, cfg, auth.user.id);
      if (driveToken instanceof Response) return driveToken;

      const driveId = decodeURIComponent(thumbMatch[1]);
      const modLookup = await supabaseRest<ModRow[]>(
        cfg,
        auth.accessToken,
        `mods?select=id&owner_id=eq.${encodeURIComponent(
          auth.user.id,
        )}&thumbnail_drive_id=eq.${encodeURIComponent(driveId)}&limit=1`,
      );

      if (!modLookup.ok || !modLookup.data || modLookup.data.length === 0) {
        return jsonResponse({ error: 'Thumbnail not found.' }, 404);
      }

      const driveRes = await fetchDriveMediaResponse(driveToken, driveId);
      const headers = new Headers();
      headers.set('Content-Type', driveRes.headers.get('Content-Type') || 'image/png');
      headers.set('Cache-Control', 'private, max-age=300');
      return new Response(driveRes.body, { status: 200, headers });
    }

    // =========================================================================
    // VAULT FILE MANAGER & FOLDER HIERARCHY ENDPOINTS (GOOGLE DRIVE MIRRORED)
    // =========================================================================

    // 13. Create folder: POST /api/vault/folders
    if (method === 'POST' && path === '/api/vault/folders') {
      const auth = await authenticateOwner(request, cfg);
      if (auth instanceof Response) return auth;
      activeOwnerId = auth.user.id;
      const driveToken = await resolveDriveTokenRequired(request, cfg, auth.user.id);
      if (driveToken instanceof Response) return driveToken;

      const body = (await request.json().catch(() => null)) as {
        name?: string;
        parentId?: string | null;
      } | null;

      if (!body?.name || isUnsafeSegment(body.name) || body.name.trim().length > 120) {
        return jsonResponse({ error: 'Invalid folder name.' }, 400);
      }

      const folderName = body.name.trim();
      const structure = await ensureDriveVaultStructure(driveToken);
      const driveParentId = await resolveDriveFolderId({
        driveToken,
        cfg,
        supabaseToken: auth.accessToken,
        userId: auth.user.id,
        targetFolderId: body.parentId || null,
        vaultRootDriveId: structure.vaultFolderId,
      });

      const driveFolderId = await createDriveFolder(driveToken, folderName, driveParentId);

      const res = await supabaseRest<VaultFolderRow[]>(
        cfg,
        auth.accessToken,
        'vault_folders',
        {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            owner_id: auth.user.id,
            parent_id: body.parentId || null,
            drive_folder_id: driveFolderId,
            drive_parent_id: driveParentId,
            name: folderName,
          }),
        },
      );

      if (!res.ok || !res.data || res.data.length === 0) {
        await deleteDriveItem(driveToken, driveFolderId).catch(() => undefined);
        return jsonResponse(
          { error: `Failed to create folder: ${res.errorText || 'Folder already exists'}` },
          res.status === 409 ? 409 : 400,
        );
      }

      return jsonResponse({ folder: res.data[0] }, 201);
    }

    // 14. Ensure nested folder path exists: POST /api/vault/folders/ensure-path
    if (method === 'POST' && path === '/api/vault/folders/ensure-path') {
      const auth = await authenticateOwner(request, cfg);
      if (auth instanceof Response) return auth;
      activeOwnerId = auth.user.id;
      const driveToken = await resolveDriveTokenRequired(request, cfg, auth.user.id);
      if (driveToken instanceof Response) return driveToken;

      const body = (await request.json().catch(() => null)) as {
        parentId?: string | null;
        segments?: string[];
      } | null;

      const segments = Array.isArray(body?.segments) ? body!.segments : [];
      if (segments.length > 20) {
        return jsonResponse({ error: 'Folder depth limit exceeded (max 20 levels).' }, 400);
      }

      for (const seg of segments) {
        if (typeof seg !== 'string' || isUnsafeSegment(seg) || seg.trim().length > 120) {
          return jsonResponse(
            { error: `Unsafe folder path segment rejected: ${String(seg)}` },
            400,
          );
        }
      }

      const existingRes = await supabaseRest<VaultFolderRow[]>(
        cfg,
        auth.accessToken,
        `vault_folders?select=*&owner_id=eq.${encodeURIComponent(auth.user.id)}`,
      );

      if (!existingRes.ok || !existingRes.data) {
        return jsonResponse({ error: 'Unable to query vault folders.' }, 500);
      }

      const folders = existingRes.data;
      const structure = await ensureDriveVaultStructure(driveToken);
      let currentParentId: string | null = body?.parentId || null;
      let currentDriveParentId = await resolveDriveFolderId({
        driveToken,
        cfg,
        supabaseToken: auth.accessToken,
        userId: auth.user.id,
        targetFolderId: currentParentId,
        vaultRootDriveId: structure.vaultFolderId,
        allFolders: folders,
      });

      let createdCount = 0;

      for (const rawSeg of segments) {
        const segName = rawSeg.trim();
        const found = folders.find(
          (f) =>
            (f.parent_id || null) === currentParentId &&
            f.name.toLowerCase() === segName.toLowerCase(),
        );

        if (found) {
          if (!found.drive_folder_id) {
            const createdId = await createDriveFolder(
              driveToken,
              found.name,
              currentDriveParentId,
            );
            await supabaseRest(
              cfg,
              auth.accessToken,
              `vault_folders?id=eq.${encodeURIComponent(found.id)}&owner_id=eq.${encodeURIComponent(
                auth.user.id,
              )}`,
              {
                method: 'PATCH',
                body: JSON.stringify({
                  drive_folder_id: createdId,
                  drive_parent_id: currentDriveParentId,
                }),
              },
            );
            found.drive_folder_id = createdId;
            found.drive_parent_id = currentDriveParentId;
          }
          currentParentId = found.id;
          currentDriveParentId = found.drive_folder_id;
          continue;
        }

        const newDriveFolderId = await createDriveFolder(
          driveToken,
          segName,
          currentDriveParentId,
        );

        const insertRes = await supabaseRest<VaultFolderRow[]>(
          cfg,
          auth.accessToken,
          'vault_folders',
          {
            method: 'POST',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({
              owner_id: auth.user.id,
              parent_id: currentParentId,
              drive_folder_id: newDriveFolderId,
              drive_parent_id: currentDriveParentId,
              name: segName,
            }),
          },
        );

        if (insertRes.ok && insertRes.data && insertRes.data.length > 0) {
          folders.push(insertRes.data[0]);
          currentParentId = insertRes.data[0].id;
          currentDriveParentId = newDriveFolderId;
          createdCount += 1;
        } else {
          await deleteDriveItem(driveToken, newDriveFolderId).catch(() => undefined);
          const parentFilter = currentParentId
            ? `parent_id=eq.${encodeURIComponent(currentParentId)}`
            : 'parent_id=is.null';
          const retryRes = await supabaseRest<VaultFolderRow[]>(
            cfg,
            auth.accessToken,
            `vault_folders?select=*&owner_id=eq.${encodeURIComponent(
              auth.user.id,
            )}&${parentFilter}&name=ilike.${encodeURIComponent(segName)}&limit=1`,
          );
          if (retryRes.ok && retryRes.data && retryRes.data.length > 0) {
            folders.push(retryRes.data[0]);
            currentParentId = retryRes.data[0].id;
            currentDriveParentId =
              retryRes.data[0].drive_folder_id || currentDriveParentId;
          } else {
            return jsonResponse(
              {
                error: `Failed to ensure folder "${segName}": ${insertRes.errorText || 'Error'}`,
              },
              500,
            );
          }
        }
      }

      return jsonResponse({
        folderId: currentParentId,
        driveFolderId: currentDriveParentId,
        createdCount,
      });
    }

    // 15. Rename / move / delete folder: PATCH/DELETE /api/vault/folders/:id
    const folderMatch = path.match(/^\/api\/vault\/folders\/([^/]+)$/);
    if (folderMatch && (method === 'PATCH' || method === 'DELETE')) {
      const auth = await authenticateOwner(request, cfg);
      if (auth instanceof Response) return auth;
      const folderId = decodeURIComponent(folderMatch[1]);

      const allFoldersRes = await supabaseRest<VaultFolderRow[]>(
        cfg,
        auth.accessToken,
        `vault_folders?select=*&owner_id=eq.${encodeURIComponent(auth.user.id)}`,
      );

      if (!allFoldersRes.ok || !allFoldersRes.data) {
        return jsonResponse({ error: 'Unable to load vault folders.' }, 500);
      }

      const allFolders = allFoldersRes.data;
      const target = allFolders.find((f) => f.id === folderId);
      if (!target) {
        return jsonResponse({ error: 'Folder not found.' }, 404);
      }

      if (method === 'PATCH') {
        activeOwnerId = auth.user.id;
        const driveToken = await resolveDriveTokenRequired(request, cfg, auth.user.id);
        if (driveToken instanceof Response) return driveToken;

        const body = (await request.json().catch(() => null)) as {
          name?: string;
          parentId?: string | null;
        } | null;

        if (!body) return jsonResponse({ error: 'Invalid folder update payload.' }, 400);

        const updates: Record<string, unknown> = {};
        let nextName: string | undefined;
        let nextDriveParentId: string | undefined;

        if (typeof body.name === 'string') {
          if (isUnsafeSegment(body.name) || body.name.trim().length > 120) {
            return jsonResponse({ error: 'Invalid folder name.' }, 400);
          }
          nextName = body.name.trim();
          updates.name = nextName;
        }

        if (body.parentId !== undefined) {
          const nextParentId = body.parentId || null;
          if (nextParentId === folderId) {
            return jsonResponse({ error: 'Cannot move a folder into itself.' }, 400);
          }
          let cursor = nextParentId;
          const folderMap = new Map(allFolders.map((f) => [f.id, f]));
          let hops = 0;
          while (cursor && hops < 100) {
            if (cursor === folderId) {
              return jsonResponse(
                { error: 'Cannot move a folder inside one of its own subfolders.' },
                400,
              );
            }
            const node = folderMap.get(cursor);
            cursor = node?.parent_id || null;
            hops += 1;
          }
          if (nextParentId && !folderMap.has(nextParentId)) {
            return jsonResponse({ error: 'Destination parent folder not found.' }, 404);
          }

          const structure = await ensureDriveVaultStructure(driveToken);
          nextDriveParentId = await resolveDriveFolderId({
            driveToken,
            cfg,
            supabaseToken: auth.accessToken,
            userId: auth.user.id,
            targetFolderId: nextParentId,
            vaultRootDriveId: structure.vaultFolderId,
            allFolders,
          });
          updates.parent_id = nextParentId;
          updates.drive_parent_id = nextDriveParentId;
        }

        if (Object.keys(updates).length === 0) {
          return jsonResponse({ error: 'No folder changes provided.' }, 400);
        }

        if (target.drive_folder_id) {
          let previousParents: string[] | undefined;
          if (nextDriveParentId) {
            if (target.drive_parent_id && target.drive_parent_id !== nextDriveParentId) {
              previousParents = [target.drive_parent_id];
            } else if (!target.drive_parent_id) {
              const meta = await getDriveFileMetadata(driveToken, target.drive_folder_id);
              const filtered = (meta.parents || []).filter((p) => p !== nextDriveParentId);
              if (filtered.length > 0) previousParents = filtered;
            }
          }
          const addParents =
            nextDriveParentId && nextDriveParentId !== target.drive_parent_id
              ? [nextDriveParentId]
              : undefined;

          await updateDriveItem(driveToken, target.drive_folder_id, {
            name: nextName,
            addParents,
            removeParents: previousParents,
          });
        }

        const patchRes = await supabaseRest<VaultFolderRow[]>(
          cfg,
          auth.accessToken,
          `vault_folders?id=eq.${encodeURIComponent(folderId)}&owner_id=eq.${encodeURIComponent(
            auth.user.id,
          )}`,
          {
            method: 'PATCH',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify(updates),
          },
        );

        if (!patchRes.ok || !patchRes.data) {
          return jsonResponse(
            { error: `Failed to update folder: ${patchRes.errorText || 'Duplicate name'}` },
            patchRes.status === 409 ? 409 : 400,
          );
        }

        return jsonResponse({ folder: patchRes.data[0] });
      }

      // DELETE /api/vault/folders/:id
      const subtreeIds = new Set<string>([folderId]);
      let added = true;
      while (added) {
        added = false;
        for (const f of allFolders) {
          if (f.parent_id && subtreeIds.has(f.parent_id) && !subtreeIds.has(f.id)) {
            subtreeIds.add(f.id);
            added = true;
          }
        }
      }

      const filesRes = await supabaseRest<VaultFileRow[]>(
        cfg,
        auth.accessToken,
        `vault_files?select=id,drive_file_id,folder_id&owner_id=eq.${encodeURIComponent(
          auth.user.id,
        )}`,
      );

      const filesToDelete = (filesRes.data || []).filter(
        (file) => file.folder_id && subtreeIds.has(file.folder_id),
      );

      const hasDriveResources =
        Boolean(target.drive_folder_id) ||
        filesToDelete.some((file) => Boolean(file.drive_file_id));

      if (hasDriveResources) {
        activeOwnerId = auth.user.id;
        const driveToken = await resolveDriveTokenRequired(request, cfg, auth.user.id);
        if (driveToken instanceof Response) return driveToken;

        if (target.drive_folder_id) {
          await deleteDriveItem(driveToken, target.drive_folder_id);
        } else {
          await deleteDriveItemsBatch(
            driveToken,
            filesToDelete.map((f) => f.drive_file_id),
          );
        }
      }

      const delRes = await supabaseRest(
        cfg,
        auth.accessToken,
        `vault_folders?id=eq.${encodeURIComponent(folderId)}&owner_id=eq.${encodeURIComponent(
          auth.user.id,
        )}`,
        { method: 'DELETE' },
      );

      if (!delRes.ok) {
        return jsonResponse({ error: 'Failed to delete folder.' }, 500);
      }

      return jsonResponse({
        deleted: true,
        folderId,
        deletedFilesCount: filesToDelete.length,
      });
    }

    // 16. Save uploaded vault file metadata: POST /api/vault/files
    if (method === 'POST' && path === '/api/vault/files') {
      const auth = await authenticateOwner(request, cfg);
      if (auth instanceof Response) return auth;
      activeOwnerId = auth.user.id;
      const driveToken = await resolveDriveTokenOptional(request, cfg, auth.user.id);

      const body = (await request.json().catch(() => null)) as {
        folderId?: string | null;
        name?: string;
        mimeType?: string;
        driveFileId?: string;
        driveParentId?: string | null;
        fileSizeBytes?: number;
        sha256?: string;
      } | null;

      if (
        !body ||
        !body.name ||
        isUnsafeSegment(body.name) ||
        !body.driveFileId?.trim() ||
        typeof body.fileSizeBytes !== 'number' ||
        body.fileSizeBytes <= 0 ||
        !body.sha256 ||
        !/^[a-f0-9]{64}$/.test(body.sha256)
      ) {
        return jsonResponse({ error: 'Invalid vault file metadata payload.' }, 400);
      }

      let verifiedSize = body.fileSizeBytes;
      let verifiedParent = body.driveParentId || null;
      if (driveToken) {
        const meta = await getDriveFileMetadata(driveToken, body.driveFileId.trim());
        if (meta.size && Number(meta.size) > 0) verifiedSize = Number(meta.size);
        if (!verifiedParent && meta.parents?.[0]) verifiedParent = meta.parents[0];
      }

      const cleanName = sanitizeDisplayFilename(body.name);
      const ext = extractExtension(cleanName);

      const insertRes = await supabaseRest<VaultFileRow[]>(
        cfg,
        auth.accessToken,
        'vault_files',
        {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            owner_id: auth.user.id,
            folder_id: body.folderId || null,
            name: cleanName,
            file_extension: ext,
            mime_type: (body.mimeType || 'application/octet-stream').slice(0, 120),
            drive_file_id: body.driveFileId.trim(),
            drive_parent_id: verifiedParent,
            file_size_bytes: verifiedSize,
            sha256: body.sha256,
          }),
        },
      );

      if (!insertRes.ok || !insertRes.data || insertRes.data.length === 0) {
        if (driveToken) {
          await deleteDriveItem(driveToken, body.driveFileId.trim()).catch(() => undefined);
        }
        return jsonResponse(
          { error: `Failed to save file metadata: ${insertRes.errorText || 'DB error'}` },
          500,
        );
      }

      return jsonResponse({ file: insertRes.data[0] }, 201);
    }

    // 17. Bulk delete vault files: POST /api/vault/files/bulk-delete
    if (method === 'POST' && path === '/api/vault/files/bulk-delete') {
      const auth = await authenticateOwner(request, cfg);
      if (auth instanceof Response) return auth;

      const body = (await request.json().catch(() => null)) as {
        fileIds?: string[];
      } | null;

      const fileIds = Array.isArray(body?.fileIds)
        ? Array.from(new Set(body!.fileIds.filter((id) => typeof id === 'string' && id.trim())))
        : [];

      if (fileIds.length === 0 || fileIds.length > 250) {
        return jsonResponse({ error: 'Provide between 1 and 250 file IDs.' }, 400);
      }

      const filesRes = await supabaseRest<VaultFileRow[]>(
        cfg,
        auth.accessToken,
        `vault_files?select=id,drive_file_id&owner_id=eq.${encodeURIComponent(
          auth.user.id,
        )}&id=in.${encodeURIComponent(buildInFilter(fileIds))}`,
      );

      if (!filesRes.ok || !filesRes.data) {
        return jsonResponse({ error: 'Failed to look up files for deletion.' }, 500);
      }

      const driveIds = filesRes.data
        .map((f) => f.drive_file_id)
        .filter((id): id is string => Boolean(id));

      if (driveIds.length > 0) {
        activeOwnerId = auth.user.id;
        const driveToken = await resolveDriveTokenRequired(request, cfg, auth.user.id);
        if (driveToken instanceof Response) return driveToken;
        await deleteDriveItemsBatch(driveToken, driveIds);
      }

      const delRes = await supabaseRest(
        cfg,
        auth.accessToken,
        `vault_files?owner_id=eq.${encodeURIComponent(auth.user.id)}&id=in.${encodeURIComponent(
          buildInFilter(fileIds),
        )}`,
        { method: 'DELETE' },
      );

      if (!delRes.ok) {
        return jsonResponse({ error: 'Failed to delete file records.' }, 500);
      }

      return jsonResponse({ deleted: true, count: filesRes.data.length });
    }

    // 18. Batch lookup vault files for authenticated ZIP archive downloads: POST /api/vault/files/sign-batch
    if (method === 'POST' && path === '/api/vault/files/sign-batch') {
      const auth = await authenticateOwner(request, cfg);
      if (auth instanceof Response) return auth;
      activeOwnerId = auth.user.id;
      const driveToken = await resolveDriveTokenRequired(request, cfg, auth.user.id);
      if (driveToken instanceof Response) return driveToken;

      const body = (await request.json().catch(() => null)) as {
        fileIds?: string[];
      } | null;

      const fileIds = Array.isArray(body?.fileIds)
        ? Array.from(new Set(body!.fileIds.filter((id) => typeof id === 'string' && id.trim())))
        : [];

      if (fileIds.length === 0 || fileIds.length > 500) {
        return jsonResponse(
          { error: 'Provide between 1 and 500 file IDs for batch ZIP packaging.' },
          400,
        );
      }

      const filesRes = await supabaseRest<VaultFileRow[]>(
        cfg,
        auth.accessToken,
        `vault_files?select=id,folder_id,name,file_size_bytes,drive_file_id&owner_id=eq.${encodeURIComponent(
          auth.user.id,
        )}&id=in.${encodeURIComponent(buildInFilter(fileIds))}`,
      );

      if (!filesRes.ok || !filesRes.data) {
        return jsonResponse({ error: 'Failed to look up requested files.' }, 500);
      }

      const items = filesRes.data
        .filter((f) => Boolean(f.drive_file_id))
        .map((f) => ({
          id: f.id,
          folderId: f.folder_id,
          name: f.name,
          fileSizeBytes: f.file_size_bytes,
          downloadUrl: `/api/vault/files/${encodeURIComponent(f.id)}/download`,
        }));

      if (items.length === 0) {
        return jsonResponse(
          { error: 'Selected files have no Google Drive file IDs.' },
          404,
        );
      }

      return jsonResponse({ items });
    }

    // 19. Rename / move / delete vault file: PATCH/DELETE /api/vault/files/:id
    const fileMatch = path.match(/^\/api\/vault\/files\/([^/]+)$/);
    if (fileMatch && (method === 'PATCH' || method === 'DELETE')) {
      const auth = await authenticateOwner(request, cfg);
      if (auth instanceof Response) return auth;
      const fileId = decodeURIComponent(fileMatch[1]);

      const fileLookup = await supabaseRest<VaultFileRow[]>(
        cfg,
        auth.accessToken,
        `vault_files?select=*&id=eq.${encodeURIComponent(
          fileId,
        )}&owner_id=eq.${encodeURIComponent(auth.user.id)}&limit=1`,
      );

      if (!fileLookup.ok || !fileLookup.data || fileLookup.data.length === 0) {
        return jsonResponse({ error: 'File not found.' }, 404);
      }

      const existing = fileLookup.data[0];

      if (method === 'PATCH') {
        activeOwnerId = auth.user.id;
        const driveToken = await resolveDriveTokenRequired(request, cfg, auth.user.id);
        if (driveToken instanceof Response) return driveToken;

        const body = (await request.json().catch(() => null)) as {
          name?: string;
          folderId?: string | null;
        } | null;

        if (!body) return jsonResponse({ error: 'Invalid file update payload.' }, 400);

        const updates: Record<string, unknown> = {};
        let nextName: string | undefined;
        let nextDriveParentId: string | undefined;

        if (typeof body.name === 'string') {
          if (isUnsafeSegment(body.name)) {
            return jsonResponse({ error: 'Invalid file name.' }, 400);
          }
          const clean = sanitizeDisplayFilename(body.name);
          nextName = clean;
          updates.name = clean;
          updates.file_extension = extractExtension(clean);
        }

        if (body.folderId !== undefined) {
          const nextFolderId = body.folderId || null;
          const structure = await ensureDriveVaultStructure(driveToken);
          nextDriveParentId = await resolveDriveFolderId({
            driveToken,
            cfg,
            supabaseToken: auth.accessToken,
            userId: auth.user.id,
            targetFolderId: nextFolderId,
            vaultRootDriveId: structure.vaultFolderId,
          });
          updates.folder_id = nextFolderId;
          updates.drive_parent_id = nextDriveParentId;
        }

        if (Object.keys(updates).length === 0) {
          return jsonResponse({ error: 'No file changes provided.' }, 400);
        }

        if (existing.drive_file_id) {
          let previousParents: string[] | undefined;
          if (nextDriveParentId) {
            if (existing.drive_parent_id && existing.drive_parent_id !== nextDriveParentId) {
              previousParents = [existing.drive_parent_id];
            } else if (!existing.drive_parent_id) {
              const meta = await getDriveFileMetadata(driveToken, existing.drive_file_id);
              const filtered = (meta.parents || []).filter((p) => p !== nextDriveParentId);
              if (filtered.length > 0) previousParents = filtered;
            }
          }
          const addParents =
            nextDriveParentId && nextDriveParentId !== existing.drive_parent_id
              ? [nextDriveParentId]
              : undefined;

          await updateDriveItem(driveToken, existing.drive_file_id, {
            name: nextName,
            addParents,
            removeParents: previousParents,
          });
        }

        const patchRes = await supabaseRest<VaultFileRow[]>(
          cfg,
          auth.accessToken,
          `vault_files?id=eq.${encodeURIComponent(fileId)}&owner_id=eq.${encodeURIComponent(
            auth.user.id,
          )}`,
          {
            method: 'PATCH',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify(updates),
          },
        );

        if (!patchRes.ok || !patchRes.data || patchRes.data.length === 0) {
          return jsonResponse({ error: 'File not found or update failed.' }, 404);
        }

        return jsonResponse({ file: patchRes.data[0] });
      }

      // DELETE /api/vault/files/:id
      if (existing.drive_file_id) {
        activeOwnerId = auth.user.id;
        const driveToken = await resolveDriveTokenRequired(request, cfg, auth.user.id);
        if (driveToken instanceof Response) return driveToken;
        await deleteDriveItem(driveToken, existing.drive_file_id);
      }

      const delRes = await supabaseRest(
        cfg,
        auth.accessToken,
        `vault_files?id=eq.${encodeURIComponent(fileId)}&owner_id=eq.${encodeURIComponent(
          auth.user.id,
        )}`,
        { method: 'DELETE' },
      );

      if (!delRes.ok) {
        return jsonResponse({ error: 'Failed to delete file record.' }, 500);
      }

      return jsonResponse({ deleted: true, fileId });
    }

    // 20. Authenticated Google Drive stream download or preview for vault file: POST /api/vault/files/:id/download
    const vaultFileDownloadMatch = path.match(/^\/api\/vault\/files\/([^/]+)\/download$/);
    if (method === 'POST' && vaultFileDownloadMatch) {
      const auth = await authenticateOwner(request, cfg);
      if (auth instanceof Response) return auth;
      activeOwnerId = auth.user.id;
      const driveToken = await resolveDriveTokenRequired(request, cfg, auth.user.id);
      if (driveToken instanceof Response) return driveToken;

      const fileId = decodeURIComponent(vaultFileDownloadMatch[1]);
      const body = (await request.json().catch(() => null)) as {
        mode?: 'attachment' | 'inline';
      } | null;
      const mode = body?.mode === 'inline' ? 'inline' : 'attachment';

      const fileLookup = await supabaseRest<VaultFileRow[]>(
        cfg,
        auth.accessToken,
        `vault_files?select=id,name,mime_type,file_size_bytes,drive_file_id&id=eq.${encodeURIComponent(
          fileId,
        )}&owner_id=eq.${encodeURIComponent(auth.user.id)}&limit=1`,
      );

      if (!fileLookup.ok || !fileLookup.data || fileLookup.data.length === 0) {
        return jsonResponse({ error: 'File not found.' }, 404);
      }

      const file = fileLookup.data[0];
      if (!file.drive_file_id) {
        return jsonResponse(
          {
            error:
              'This file has no Google Drive file ID. Re-upload it to store privately in Google Drive.',
          },
          404,
        );
      }

      const driveRes = await fetchDriveMediaResponse(driveToken, file.drive_file_id);
      const headers = new Headers();
      headers.set('Content-Type', file.mime_type || 'application/octet-stream');
      headers.set('Content-Disposition', encodeContentDisposition(file.name, mode));
      headers.set('Cache-Control', 'no-store');
      if (file.file_size_bytes) {
        headers.set('Content-Length', String(file.file_size_bytes));
      }

      return new Response(driveRes.body, {
        status: 200,
        headers,
      });
    }

    // 21. Copy vault file in Google Drive + Supabase: POST /api/vault/files/:id/copy
    const vaultFileCopyMatch = path.match(/^\/api\/vault\/files\/([^/]+)\/copy$/);
    if (method === 'POST' && vaultFileCopyMatch) {
      const auth = await authenticateOwner(request, cfg);
      if (auth instanceof Response) return auth;
      activeOwnerId = auth.user.id;
      const driveToken = await resolveDriveTokenRequired(request, cfg, auth.user.id);
      if (driveToken instanceof Response) return driveToken;

      const fileId = decodeURIComponent(vaultFileCopyMatch[1]);
      const body = (await request.json().catch(() => null)) as {
        folderId?: string | null;
        name?: string;
      } | null;

      const lookup = await supabaseRest<VaultFileRow[]>(
        cfg,
        auth.accessToken,
        `vault_files?select=*&id=eq.${encodeURIComponent(fileId)}&owner_id=eq.${encodeURIComponent(
          auth.user.id,
        )}&limit=1`,
      );
      if (!lookup.ok || !lookup.data || lookup.data.length === 0) {
        return jsonResponse({ error: 'File not found.' }, 404);
      }

      const source = lookup.data[0];
      if (!source.drive_file_id) {
        return jsonResponse(
          { error: 'File has no Google Drive ID to copy.' },
          400,
        );
      }

      const targetFolderId =
        body?.folderId !== undefined ? body.folderId || null : source.folder_id || null;
      const sameFolder = (targetFolderId || null) === (source.folder_id || null);

      let copyName = typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : '';
      if (!copyName) {
        if (sameFolder) {
          const dotIdx = source.name.lastIndexOf('.');
          copyName =
            dotIdx > 0
              ? `${source.name.slice(0, dotIdx)} (Copy)${source.name.slice(dotIdx)}`
              : `${source.name} (Copy)`;
        } else {
          copyName = source.name;
        }
      }
      if (isUnsafeSegment(copyName)) {
        return jsonResponse({ error: 'Invalid copy file name.' }, 400);
      }
      const cleanName = sanitizeDisplayFilename(copyName);

      const structure = await ensureDriveVaultStructure(driveToken);
      const targetDriveParentId = await resolveDriveFolderId({
        driveToken,
        cfg,
        supabaseToken: auth.accessToken,
        userId: auth.user.id,
        targetFolderId,
        vaultRootDriveId: structure.vaultFolderId,
      });

      const copiedDrive = await copyDriveFile(driveToken, source.drive_file_id, {
        name: cleanName,
        parentId: targetDriveParentId,
      });

      const insertRes = await supabaseRest<VaultFileRow[]>(
        cfg,
        auth.accessToken,
        'vault_files',
        {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            owner_id: auth.user.id,
            folder_id: targetFolderId,
            name: cleanName,
            file_extension: extractExtension(cleanName) || source.file_extension,
            mime_type: source.mime_type || copiedDrive.mimeType || 'application/octet-stream',
            drive_file_id: copiedDrive.id,
            drive_parent_id: targetDriveParentId,
            file_size_bytes:
              copiedDrive.size && Number(copiedDrive.size) > 0
                ? Number(copiedDrive.size)
                : source.file_size_bytes,
            sha256: source.sha256,
          }),
        },
      );

      if (!insertRes.ok || !insertRes.data || insertRes.data.length === 0) {
        await deleteDriveItem(driveToken, copiedDrive.id).catch(() => undefined);
        return jsonResponse(
          { error: `Failed to save copied file metadata: ${insertRes.errorText || 'DB error'}` },
          500,
        );
      }

      return jsonResponse({ file: insertRes.data[0] }, 201);
    }

    // 22. List Trash items: GET /api/trash
    if (method === 'GET' && path === '/api/trash') {
      const auth = await authenticateOwner(request, cfg);
      if (auth instanceof Response) return auth;
      activeOwnerId = auth.user.id;
      const driveToken = await resolveDriveTokenOptional(request, cfg, auth.user.id);
      if (!driveToken) {
        return jsonResponse({ items: [], driveConnected: false });
      }

      const structure = await ensureDriveVaultStructure(driveToken);
      const manifestRes = await readDriveJsonFile<TrashManifestItem[]>(
        driveToken,
        TRASH_MANIFEST_FILENAME,
        structure.rootId,
      );
      const items = Array.isArray(manifestRes.data) ? manifestRes.data : [];
      items.sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime());
      return jsonResponse({ items, driveConnected: true });
    }

    // 23. Move file(s) / folder / mod / version to Google Drive Trash (reversible): POST /api/trash/move
    if (method === 'POST' && path === '/api/trash/move') {
      const auth = await authenticateOwner(request, cfg);
      if (auth instanceof Response) return auth;
      activeOwnerId = auth.user.id;
      const driveToken = await resolveDriveTokenRequired(request, cfg, auth.user.id);
      if (driveToken instanceof Response) return driveToken;

      const body = (await request.json().catch(() => null)) as {
        kind?: 'file' | 'files' | 'folder' | 'mod' | 'version';
        id?: string;
        ids?: string[];
      } | null;

      if (!body?.kind) {
        return jsonResponse({ error: 'Trash move kind is required.' }, 400);
      }

      const structure = await ensureDriveVaultStructure(driveToken);
      const manifestRes = await readDriveJsonFile<TrashManifestItem[]>(
        driveToken,
        TRASH_MANIFEST_FILENAME,
        structure.rootId,
      );
      const manifest: TrashManifestItem[] = Array.isArray(manifestRes.data)
        ? [...manifestRes.data]
        : [];
      const driveIdsToTrash: string[] = [];
      const newEntries: TrashManifestItem[] = [];
      const nowIso = new Date().toISOString();

      if (body.kind === 'file' || body.kind === 'files') {
        const fileIds =
          body.kind === 'files'
            ? Array.from(new Set((body.ids || []).filter((id) => typeof id === 'string' && id.trim())))
            : body.id
              ? [body.id]
              : [];

        if (fileIds.length === 0 || fileIds.length > 250) {
          return jsonResponse({ error: 'Provide valid file ID(s) to move to Trash.' }, 400);
        }

        const filesRes = await supabaseRest<VaultFileRow[]>(
          cfg,
          auth.accessToken,
          `vault_files?select=*&owner_id=eq.${encodeURIComponent(
            auth.user.id,
          )}&id=in.${encodeURIComponent(buildInFilter(fileIds))}`,
        );
        if (!filesRes.ok || !filesRes.data || filesRes.data.length === 0) {
          return jsonResponse({ error: 'Requested file(s) not found.' }, 404);
        }

        for (const f of filesRes.data) {
          if (f.drive_file_id) driveIdsToTrash.push(f.drive_file_id);
          newEntries.push({
            trashId: crypto.randomUUID(),
            kind: 'file',
            title: f.name,
            subtitle: f.file_extension || 'Vault file',
            sizeBytes: Number(f.file_size_bytes) || 0,
            deletedAt: nowIso,
            driveIds: f.drive_file_id ? [f.drive_file_id] : [],
            payload: { file: f },
          });
        }

        await setDriveItemsTrashedBatch(driveToken, driveIdsToTrash, true);
        await writeDriveJsonFile(driveToken, {
          fileId: manifestRes.fileId,
          name: TRASH_MANIFEST_FILENAME,
          parentId: structure.rootId,
          data: [...newEntries, ...manifest].slice(0, 500),
        });

        const delRes = await supabaseRest(
          cfg,
          auth.accessToken,
          `vault_files?owner_id=eq.${encodeURIComponent(
            auth.user.id,
          )}&id=in.${encodeURIComponent(buildInFilter(fileIds))}`,
          { method: 'DELETE' },
        );
        if (!delRes.ok) {
          return jsonResponse({ error: 'Moved on Drive but failed to clean active file list.' }, 500);
        }
        return jsonResponse({ trashed: true, count: newEntries.length });
      }

      if (body.kind === 'folder' && body.id) {
        const allFoldersRes = await supabaseRest<VaultFolderRow[]>(
          cfg,
          auth.accessToken,
          `vault_folders?select=*&owner_id=eq.${encodeURIComponent(auth.user.id)}`,
        );
        if (!allFoldersRes.ok || !allFoldersRes.data) {
          return jsonResponse({ error: 'Unable to load folders.' }, 500);
        }
        const rootFolder = allFoldersRes.data.find((f) => f.id === body.id);
        if (!rootFolder) {
          return jsonResponse({ error: 'Folder not found.' }, 404);
        }

        const subtreeIds = new Set<string>([rootFolder.id]);
        let added = true;
        while (added) {
          added = false;
          for (const f of allFoldersRes.data) {
            if (f.parent_id && subtreeIds.has(f.parent_id) && !subtreeIds.has(f.id)) {
              subtreeIds.add(f.id);
              added = true;
            }
          }
        }
        const subtreeFolders = allFoldersRes.data.filter((f) => subtreeIds.has(f.id));

        const filesRes = await supabaseRest<VaultFileRow[]>(
          cfg,
          auth.accessToken,
          `vault_files?select=*&owner_id=eq.${encodeURIComponent(auth.user.id)}`,
        );
        const subtreeFiles = (filesRes.data || []).filter(
          (file) => file.folder_id && subtreeIds.has(file.folder_id),
        );

        const folderDriveIds = subtreeFolders
          .map((f) => f.drive_folder_id)
          .filter((id): id is string => Boolean(id));
        const fileDriveIds = subtreeFiles
          .map((f) => f.drive_file_id)
          .filter((id): id is string => Boolean(id));
        const allDriveIds = Array.from(new Set([...folderDriveIds, ...fileDriveIds]));

        // Trash root Drive folder (or constituent files if unlinked)
        if (rootFolder.drive_folder_id) {
          await setDriveItemsTrashedBatch(driveToken, [rootFolder.drive_folder_id], true);
        } else {
          await setDriveItemsTrashedBatch(driveToken, allDriveIds, true);
        }

        const totalBytes = subtreeFiles.reduce((s, f) => s + (Number(f.file_size_bytes) || 0), 0);
        newEntries.push({
          trashId: crypto.randomUUID(),
          kind: 'folder',
          title: rootFolder.name,
          subtitle: `Folder · ${subtreeFiles.length} file${subtreeFiles.length === 1 ? '' : 's'}`,
          sizeBytes: totalBytes,
          deletedAt: nowIso,
          driveIds: rootFolder.drive_folder_id ? [rootFolder.drive_folder_id] : allDriveIds,
          payload: {
            rootFolderId: rootFolder.id,
            folders: subtreeFolders,
            files: subtreeFiles,
          },
        });

        await writeDriveJsonFile(driveToken, {
          fileId: manifestRes.fileId,
          name: TRASH_MANIFEST_FILENAME,
          parentId: structure.rootId,
          data: [...newEntries, ...manifest].slice(0, 500),
        });

        if (subtreeFiles.length > 0) {
          await supabaseRest(
            cfg,
            auth.accessToken,
            `vault_files?owner_id=eq.${encodeURIComponent(
              auth.user.id,
            )}&id=in.${encodeURIComponent(buildInFilter(subtreeFiles.map((f) => f.id)))}`,
            { method: 'DELETE' },
          );
        }

        const delRes = await supabaseRest(
          cfg,
          auth.accessToken,
          `vault_folders?id=eq.${encodeURIComponent(rootFolder.id)}&owner_id=eq.${encodeURIComponent(
            auth.user.id,
          )}`,
          { method: 'DELETE' },
        );
        if (!delRes.ok) {
          return jsonResponse({ error: 'Failed to remove trashed folder from active list.' }, 500);
        }

        return jsonResponse({ trashed: true, count: 1 });
      }

      if (body.kind === 'mod' && body.id) {
        const modRes = await supabaseRest<ModRow[]>(
          cfg,
          auth.accessToken,
          `mods?select=*&id=eq.${encodeURIComponent(body.id)}&owner_id=eq.${encodeURIComponent(
            auth.user.id,
          )}&limit=1`,
        );
        if (!modRes.ok || !modRes.data || modRes.data.length === 0) {
          return jsonResponse({ error: 'Mod not found.' }, 404);
        }
        const mod = modRes.data[0];
        const versRes = await supabaseRest<ModVersionRow[]>(
          cfg,
          auth.accessToken,
          `mod_versions?select=*&mod_id=eq.${encodeURIComponent(
            mod.id,
          )}&owner_id=eq.${encodeURIComponent(auth.user.id)}`,
        );
        const modVersions = versRes.data || [];
        const driveIds = [
          ...modVersions.map((v) => v.drive_file_id).filter((id): id is string => Boolean(id)),
          ...(mod.thumbnail_drive_id ? [mod.thumbnail_drive_id] : []),
        ];

        await setDriveItemsTrashedBatch(driveToken, driveIds, true);
        const totalBytes = modVersions.reduce((s, v) => s + (Number(v.file_size_bytes) || 0), 0);

        newEntries.push({
          trashId: crypto.randomUUID(),
          kind: 'mod',
          title: mod.name || 'Unnamed Mod',
          subtitle: `Mod (${mod.loader || 'Mod'} · MC ${mod.latest_mc_version || '—'}) · ${modVersions.length} ver`,
          sizeBytes: totalBytes,
          deletedAt: nowIso,
          driveIds,
          payload: { mod, versions: modVersions },
        });

        await writeDriveJsonFile(driveToken, {
          fileId: manifestRes.fileId,
          name: TRASH_MANIFEST_FILENAME,
          parentId: structure.rootId,
          data: [...newEntries, ...manifest].slice(0, 500),
        });

        await supabaseRest(
          cfg,
          auth.accessToken,
          `mods?id=eq.${encodeURIComponent(mod.id)}&owner_id=eq.${encodeURIComponent(auth.user.id)}`,
          { method: 'DELETE' },
        );

        return jsonResponse({ trashed: true, count: 1 });
      }

      if (body.kind === 'version' && body.id) {
        const verRes = await supabaseRest<ModVersionRow[]>(
          cfg,
          auth.accessToken,
          `mod_versions?select=*&id=eq.${encodeURIComponent(
            body.id,
          )}&owner_id=eq.${encodeURIComponent(auth.user.id)}&limit=1`,
        );
        if (!verRes.ok || !verRes.data || verRes.data.length === 0) {
          return jsonResponse({ error: 'Mod version not found.' }, 404);
        }
        const ver = verRes.data[0];
        const driveIds = ver.drive_file_id ? [ver.drive_file_id] : [];
        await setDriveItemsTrashedBatch(driveToken, driveIds, true);

        newEntries.push({
          trashId: crypto.randomUUID(),
          kind: 'version',
          title: ver.file_name,
          subtitle: `Mod version v${ver.version_number} (${ver.loader} · MC ${ver.mc_version})`,
          sizeBytes: Number(ver.file_size_bytes) || 0,
          deletedAt: nowIso,
          driveIds,
          payload: { version: ver },
        });

        await writeDriveJsonFile(driveToken, {
          fileId: manifestRes.fileId,
          name: TRASH_MANIFEST_FILENAME,
          parentId: structure.rootId,
          data: [...newEntries, ...manifest].slice(0, 500),
        });

        await supabaseRest(
          cfg,
          auth.accessToken,
          `mod_versions?id=eq.${encodeURIComponent(ver.id)}&owner_id=eq.${encodeURIComponent(
            auth.user.id,
          )}`,
          { method: 'DELETE' },
        );

        return jsonResponse({ trashed: true, count: 1 });
      }

      return jsonResponse({ error: 'Unsupported Trash move target.' }, 400);
    }

    // 24. Restore an item from Trash back to Google Drive + Supabase: POST /api/trash/restore
    if (method === 'POST' && path === '/api/trash/restore') {
      const auth = await authenticateOwner(request, cfg);
      if (auth instanceof Response) return auth;
      activeOwnerId = auth.user.id;
      const driveToken = await resolveDriveTokenRequired(request, cfg, auth.user.id);
      if (driveToken instanceof Response) return driveToken;

      const body = (await request.json().catch(() => null)) as { trashId?: string } | null;
      if (!body?.trashId) {
        return jsonResponse({ error: 'trashId is required.' }, 400);
      }

      const structure = await ensureDriveVaultStructure(driveToken);
      const manifestRes = await readDriveJsonFile<TrashManifestItem[]>(
        driveToken,
        TRASH_MANIFEST_FILENAME,
        structure.rootId,
      );
      const manifest: TrashManifestItem[] = Array.isArray(manifestRes.data) ? manifestRes.data : [];
      const target = manifest.find((item) => item.trashId === body.trashId);
      if (!target) {
        return jsonResponse({ error: 'Trash item not found.' }, 404);
      }

      await setDriveItemsTrashedBatch(driveToken, target.driveIds, false);

      if (target.kind === 'file') {
        const f = target.payload.file as VaultFileRow;
        let folderId: string | null = f.folder_id || null;
        if (folderId) {
          const folderCheck = await supabaseRest<VaultFolderRow[]>(
            cfg,
            auth.accessToken,
            `vault_folders?select=id&id=eq.${encodeURIComponent(folderId)}&limit=1`,
          );
          if (!folderCheck.ok || !folderCheck.data || folderCheck.data.length === 0) {
            folderId = null;
            if (f.drive_file_id) {
              await updateDriveItem(driveToken, f.drive_file_id, {
                addParents: [structure.vaultFolderId],
              }).catch(() => undefined);
            }
          }
        }
        await supabaseRest(cfg, auth.accessToken, 'vault_files', {
          method: 'POST',
          body: JSON.stringify({
            owner_id: auth.user.id,
            folder_id: folderId,
            name: f.name,
            file_extension: f.file_extension,
            mime_type: f.mime_type,
            drive_file_id: f.drive_file_id,
            drive_parent_id: folderId ? f.drive_parent_id : structure.vaultFolderId,
            file_size_bytes: f.file_size_bytes,
            sha256: f.sha256,
          }),
        });
      } else if (target.kind === 'folder') {
        const foldersToRestore = (target.payload.folders as VaultFolderRow[]) || [];
        const filesToRestore = (target.payload.files as VaultFileRow[]) || [];
        const rootFolderId = String(target.payload.rootFolderId || '');

        // Restore folders top-down by depth
        const oldToNewFolderId = new Map<string, string>();
        const existingFoldersRes = await supabaseRest<VaultFolderRow[]>(
          cfg,
          auth.accessToken,
          `vault_folders?select=id&owner_id=eq.${encodeURIComponent(auth.user.id)}`,
        );
        const existingIds = new Set((existingFoldersRes.data || []).map((x) => x.id));

        const remaining = [...foldersToRestore];
        let safety = 0;
        while (remaining.length > 0 && safety < 50) {
          safety += 1;
          let progressed = false;
          for (let i = remaining.length - 1; i >= 0; i--) {
            const node = remaining[i];
            const isRootOfSubtree = node.id === rootFolderId;
            const parentReady =
              isRootOfSubtree || !node.parent_id || oldToNewFolderId.has(node.parent_id);
            if (!parentReady) continue;

            let resolvedParentId: string | null = null;
            if (isRootOfSubtree) {
              resolvedParentId =
                node.parent_id && existingIds.has(node.parent_id) ? node.parent_id : null;
            } else if (node.parent_id) {
              resolvedParentId = oldToNewFolderId.get(node.parent_id) || null;
            }

            const ins = await supabaseRest<VaultFolderRow[]>(
              cfg,
              auth.accessToken,
              'vault_folders',
              {
                method: 'POST',
                headers: { Prefer: 'return=representation' },
                body: JSON.stringify({
                  owner_id: auth.user.id,
                  parent_id: resolvedParentId,
                  drive_folder_id: node.drive_folder_id,
                  drive_parent_id: resolvedParentId
                    ? node.drive_parent_id
                    : structure.vaultFolderId,
                  name: node.name,
                }),
              },
            );
            if (ins.ok && ins.data?.[0]) {
              oldToNewFolderId.set(node.id, ins.data[0].id);
            }
            remaining.splice(i, 1);
            progressed = true;
          }
          if (!progressed) break;
        }

        for (const f of filesToRestore) {
          const mappedFolderId = f.folder_id ? oldToNewFolderId.get(f.folder_id) || null : null;
          await supabaseRest(cfg, auth.accessToken, 'vault_files', {
            method: 'POST',
            body: JSON.stringify({
              owner_id: auth.user.id,
              folder_id: mappedFolderId,
              name: f.name,
              file_extension: f.file_extension,
              mime_type: f.mime_type,
              drive_file_id: f.drive_file_id,
              drive_parent_id: f.drive_parent_id,
              file_size_bytes: f.file_size_bytes,
              sha256: f.sha256,
            }),
          });
        }
      } else if (target.kind === 'mod') {
        const m = target.payload.mod as ModRow & {
          category_id?: string | null;
          name: string;
          slug: string;
          description: string;
          loader: string;
          latest_mc_version: string;
        };
        const vers = (target.payload.versions as Array<ModVersionRow & { changelog?: string }>) || [];
        const modInsert = await supabaseRest<ModRow[]>(cfg, auth.accessToken, 'mods', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            owner_id: auth.user.id,
            category_id: m.category_id || null,
            name: m.name,
            slug: `${slugify(m.name)}-${crypto.randomUUID().slice(0, 6)}`,
            description: m.description || '',
            loader: m.loader || 'Fabric',
            latest_mc_version: m.latest_mc_version || '1.21.1',
            thumbnail_key: m.thumbnail_drive_id || m.thumbnail_key || null,
            thumbnail_drive_id: m.thumbnail_drive_id || null,
          }),
        });
        const restoredModId = modInsert.data?.[0]?.id;
        if (restoredModId) {
          for (const v of vers) {
            await supabaseRest(cfg, auth.accessToken, 'mod_versions', {
              method: 'POST',
              body: JSON.stringify({
                mod_id: restoredModId,
                owner_id: auth.user.id,
                version_number: v.version_number,
                mc_version: v.mc_version,
                loader: v.loader,
                file_name: v.file_name,
                mime_type: v.mime_type || 'application/java-archive',
                drive_file_id: v.drive_file_id,
                drive_parent_id: v.drive_parent_id,
                file_size_bytes: v.file_size_bytes,
                sha256: v.sha256,
                changelog: v.changelog || '',
              }),
            });
          }
        }
      } else if (target.kind === 'version') {
        const v = target.payload.version as ModVersionRow & { changelog?: string };
        const modExists = await supabaseRest<ModRow[]>(
          cfg,
          auth.accessToken,
          `mods?select=id&id=eq.${encodeURIComponent(v.mod_id)}&limit=1`,
        );
        let modId = v.mod_id;
        if (!modExists.ok || !modExists.data || modExists.data.length === 0) {
          const recreated = await supabaseRest<ModRow[]>(cfg, auth.accessToken, 'mods', {
            method: 'POST',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({
              owner_id: auth.user.id,
              name: v.file_name.replace(/\.jar$/i, ''),
              slug: `${slugify(v.file_name)}-${crypto.randomUUID().slice(0, 6)}`,
              description: 'Restored from Trash',
              loader: v.loader,
              latest_mc_version: v.mc_version,
            }),
          });
          if (recreated.data?.[0]?.id) {
            modId = recreated.data[0].id;
          }
        }
        await supabaseRest(cfg, auth.accessToken, 'mod_versions', {
          method: 'POST',
          body: JSON.stringify({
            mod_id: modId,
            owner_id: auth.user.id,
            version_number: v.version_number,
            mc_version: v.mc_version,
            loader: v.loader,
            file_name: v.file_name,
            mime_type: v.mime_type || 'application/java-archive',
            drive_file_id: v.drive_file_id,
            drive_parent_id: v.drive_parent_id,
            file_size_bytes: v.file_size_bytes,
            sha256: v.sha256,
            changelog: v.changelog || '',
          }),
        });
      }

      const nextManifest = manifest.filter((item) => item.trashId !== body.trashId);
      await writeDriveJsonFile(driveToken, {
        fileId: manifestRes.fileId,
        name: TRASH_MANIFEST_FILENAME,
        parentId: structure.rootId,
        data: nextManifest,
      });

      return jsonResponse({ restored: true, trashId: body.trashId });
    }

    // 25. Empty Trash permanently: POST /api/trash/empty
    if (method === 'POST' && path === '/api/trash/empty') {
      const auth = await authenticateOwner(request, cfg);
      if (auth instanceof Response) return auth;
      activeOwnerId = auth.user.id;
      const driveToken = await resolveDriveTokenRequired(request, cfg, auth.user.id);
      if (driveToken instanceof Response) return driveToken;

      const structure = await ensureDriveVaultStructure(driveToken);
      const manifestRes = await readDriveJsonFile<TrashManifestItem[]>(
        driveToken,
        TRASH_MANIFEST_FILENAME,
        structure.rootId,
      );
      const manifest: TrashManifestItem[] = Array.isArray(manifestRes.data) ? manifestRes.data : [];
      const allDriveIds = manifest.flatMap((item) => item.driveIds || []);
      await deleteDriveItemsBatch(driveToken, allDriveIds);

      if (manifestRes.fileId) {
        await writeDriveJsonFile(driveToken, {
          fileId: manifestRes.fileId,
          name: TRASH_MANIFEST_FILENAME,
          parentId: structure.rootId,
          data: [],
        });
      }

      return jsonResponse({ emptied: true, count: manifest.length });
    }

    // 26. Permanently delete single Trash item: DELETE /api/trash/:trashId
    const trashDelMatch = path.match(/^\/api\/trash\/([^/]+)$/);
    if (method === 'DELETE' && trashDelMatch) {
      const auth = await authenticateOwner(request, cfg);
      if (auth instanceof Response) return auth;
      activeOwnerId = auth.user.id;
      const driveToken = await resolveDriveTokenRequired(request, cfg, auth.user.id);
      if (driveToken instanceof Response) return driveToken;

      const trashId = decodeURIComponent(trashDelMatch[1]);
      const structure = await ensureDriveVaultStructure(driveToken);
      const manifestRes = await readDriveJsonFile<TrashManifestItem[]>(
        driveToken,
        TRASH_MANIFEST_FILENAME,
        structure.rootId,
      );
      const manifest: TrashManifestItem[] = Array.isArray(manifestRes.data) ? manifestRes.data : [];
      const target = manifest.find((item) => item.trashId === trashId);
      if (!target) {
        return jsonResponse({ error: 'Trash item not found.' }, 404);
      }

      await deleteDriveItemsBatch(driveToken, target.driveIds || []);
      const nextManifest = manifest.filter((item) => item.trashId !== trashId);
      await writeDriveJsonFile(driveToken, {
        fileId: manifestRes.fileId,
        name: TRASH_MANIFEST_FILENAME,
        parentId: structure.rootId,
        data: nextManifest,
      });

      return jsonResponse({ deleted: true, trashId });
    }

    // =========================================================================
    // MODRINTH EXPLORER (STRICTLY SEPARATED PUBLIC CATALOG + EXPLICIT IMPORT)
    // =========================================================================

    const MODRINTH_API_BASE = 'https://api.modrinth.com/v2';
    const MODRINTH_USER_AGENT = 'MOD-VAULT/1.0 (private-vault-explorer)';

    // 27. Search public Modrinth catalog (Read-only, zero DB/Drive writes): GET /api/modrinth/search
    if (method === 'GET' && path === '/api/modrinth/search') {
      const auth = await authenticateOwner(request, cfg);
      if (auth instanceof Response) return auth;

      const q = (url.searchParams.get('q') || '').trim();
      const projectType = (url.searchParams.get('projectType') || 'all').trim().toLowerCase();
      const loader = (url.searchParams.get('loader') || '').trim().toLowerCase();
      const mcVersion = (url.searchParams.get('mcVersion') || '').trim();
      const sort = (url.searchParams.get('sort') || 'relevance').trim().toLowerCase();
      const offsetRaw = Number.parseInt(url.searchParams.get('offset') || '0', 10);
      const limitRaw = Number.parseInt(url.searchParams.get('limit') || '20', 10);
      const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;
      const limit = Number.isFinite(limitRaw) && limitRaw >= 1 && limitRaw <= 40 ? limitRaw : 20;

      const facets: string[][] = [];
      if (projectType === 'mod') {
        facets.push(['project_type:mod']);
      } else if (projectType === 'modpack') {
        facets.push(['project_type:modpack']);
      } else {
        facets.push(['project_type:mod', 'project_type:modpack']);
      }
      if (loader && ['fabric', 'forge', 'neoforge', 'quilt'].includes(loader)) {
        facets.push([`categories:${loader}`]);
      }
      if (mcVersion) {
        facets.push([`versions:${mcVersion}`]);
      }

      const validSorts = new Set(['relevance', 'downloads', 'follows', 'newest', 'updated']);
      const indexParam = validSorts.has(sort) ? sort : 'relevance';

      const params = new URLSearchParams({
        facets: JSON.stringify(facets),
        index: indexParam,
        offset: String(offset),
        limit: String(limit),
      });
      if (q) params.set('query', q);

      const mrRes = await fetch(`${MODRINTH_API_BASE}/search?${params.toString()}`, {
        headers: { 'User-Agent': MODRINTH_USER_AGENT },
        signal: AbortSignal.timeout(12_000),
      });

      if (!mrRes.ok) {
        const errText = await mrRes.text().catch(() => '');
        return jsonResponse(
          { error: `Modrinth search failed (${mrRes.status}): ${errText.slice(0, 180) || 'Upstream error'}` },
          mrRes.status >= 500 ? 502 : mrRes.status,
        );
      }

      const data = await mrRes.json();
      return jsonResponse(data);
    }

    // 28. Fetch public Modrinth project details (Read-only): GET /api/modrinth/project/:idOrSlug
    const mrProjectMatch = path.match(/^\/api\/modrinth\/project\/([^/]+)$/);
    if (method === 'GET' && mrProjectMatch) {
      const auth = await authenticateOwner(request, cfg);
      if (auth instanceof Response) return auth;

      const projectId = decodeURIComponent(mrProjectMatch[1]);
      if (!/^[a-zA-Z0-9._-]+$/.test(projectId)) {
        return jsonResponse({ error: 'Invalid Modrinth project identifier.' }, 400);
      }

      const mrRes = await fetch(`${MODRINTH_API_BASE}/project/${encodeURIComponent(projectId)}`, {
        headers: { 'User-Agent': MODRINTH_USER_AGENT },
        signal: AbortSignal.timeout(12_000),
      });

      if (!mrRes.ok) {
        return jsonResponse(
          { error: `Failed to fetch Modrinth project (${mrRes.status}).` },
          mrRes.status === 404 ? 404 : 502,
        );
      }

      const data = await mrRes.json();
      return jsonResponse(data);
    }

    // 29. Fetch public Modrinth project versions (Read-only): GET /api/modrinth/project/:idOrSlug/versions
    const mrVersionsMatch = path.match(/^\/api\/modrinth\/project\/([^/]+)\/versions$/);
    if (method === 'GET' && mrVersionsMatch) {
      const auth = await authenticateOwner(request, cfg);
      if (auth instanceof Response) return auth;

      const projectId = decodeURIComponent(mrVersionsMatch[1]);
      if (!/^[a-zA-Z0-9._-]+$/.test(projectId)) {
        return jsonResponse({ error: 'Invalid Modrinth project identifier.' }, 400);
      }

      const loader = (url.searchParams.get('loader') || '').trim().toLowerCase();
      const mcVersion = (url.searchParams.get('mcVersion') || '').trim();

      const params = new URLSearchParams();
      if (loader && ['fabric', 'forge', 'neoforge', 'quilt'].includes(loader)) {
        params.set('loaders', JSON.stringify([loader]));
      }
      if (mcVersion) {
        params.set('game_versions', JSON.stringify([mcVersion]));
      }

      const qs = params.toString();
      const targetUrl = `${MODRINTH_API_BASE}/project/${encodeURIComponent(projectId)}/version${
        qs ? `?${qs}` : ''
      }`;

      const mrRes = await fetch(targetUrl, {
        headers: { 'User-Agent': MODRINTH_USER_AGENT },
        signal: AbortSignal.timeout(15_000),
      });

      if (!mrRes.ok) {
        return jsonResponse(
          { error: `Failed to fetch Modrinth versions (${mrRes.status}).` },
          mrRes.status === 404 ? 404 : 502,
        );
      }

      const data = await mrRes.json();
      return jsonResponse({ versions: Array.isArray(data) ? data : [] });
    }

    // 30. Explicit user-initiated "Import to My Vault": POST /api/modrinth/import
    if (method === 'POST' && path === '/api/modrinth/import') {
      const auth = await authenticateOwner(request, cfg);
      if (auth instanceof Response) return auth;
      activeOwnerId = auth.user.id;
      const driveToken = await resolveDriveTokenRequired(request, cfg, auth.user.id);
      if (driveToken instanceof Response) return driveToken;

      const body = (await request.json().catch(() => null)) as {
        destination?: 'mods' | 'files';
        fileUrl?: string;
        fileName?: string;
        projectTitle?: string;
        projectSlug?: string;
        projectSummary?: string;
        versionNumber?: string;
        mcVersion?: string;
        loader?: string;
        changelog?: string;
        targetModId?: string | null;
        categoryId?: string | null;
        targetFolderId?: string | null;
      } | null;

      if (!body?.fileUrl || !body?.fileName) {
        return jsonResponse({ error: 'fileUrl and fileName are required.' }, 400);
      }

      let parsedFileUrl: URL;
      try {
        parsedFileUrl = new URL(body.fileUrl);
      } catch {
        return jsonResponse({ error: 'Invalid Modrinth download URL.' }, 400);
      }

      if (parsedFileUrl.protocol !== 'https:' || parsedFileUrl.hostname !== 'cdn.modrinth.com') {
        return jsonResponse(
          { error: 'Only verified https://cdn.modrinth.com artifact URLs can be imported.' },
          400,
        );
      }

      const cleanFileName = sanitizeDisplayFilename(body.fileName);
      if (!cleanFileName || isUnsafeSegment(cleanFileName)) {
        return jsonResponse({ error: 'Invalid file name.' }, 400);
      }

      const ext = extractExtension(cleanFileName);
      if (cfg.allowedExtensions[0] !== '*' && !cfg.allowedExtensions.includes(ext)) {
        return jsonResponse(
          { error: `File extension "${ext || 'unknown'}" is not allowed in vault settings.` },
          400,
        );
      }

      const destination = body.destination === 'mods' ? 'mods' : 'files';
      if (destination === 'mods' && ext !== '.jar') {
        return jsonResponse(
          { error: 'Only .jar files can be imported directly to My Mods. Import .mrpack or .zip files to File Manager.' },
          400,
        );
      }

      const cdnRes = await fetch(parsedFileUrl.toString(), {
        headers: { 'User-Agent': MODRINTH_USER_AGENT },
        signal: AbortSignal.timeout(120_000),
      });

      if (!cdnRes.ok) {
        return jsonResponse(
          { error: `Unable to download file from Modrinth CDN (${cdnRes.status}).` },
          502,
        );
      }

      const declaredLen = Number(cdnRes.headers.get('content-length') || 0);
      if (declaredLen > cfg.maxUploadBytes) {
        return jsonResponse(
          { error: `Remote file exceeds maximum upload size (${cfg.maxUploadMb} MB).` },
          413,
        );
      }

      const arrayBuf = await cdnRes.arrayBuffer();
      if (arrayBuf.byteLength > cfg.maxUploadBytes) {
        return jsonResponse(
          { error: `Downloaded file exceeds maximum upload size (${cfg.maxUploadMb} MB).` },
          413,
        );
      }

      const bytes = new Uint8Array(arrayBuf);
      const digestBuf = await crypto.subtle.digest('SHA-256', bytes);
      const sha256 = Array.from(new Uint8Array(digestBuf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      const mimeType =
        ext === '.jar'
          ? 'application/java-archive'
          : ext === '.mrpack' || ext === '.zip'
            ? 'application/zip'
            : cdnRes.headers.get('content-type') || 'application/octet-stream';

      const structure = await ensureDriveVaultStructure(driveToken);

      if (destination === 'files') {
        const targetFolderId = body.targetFolderId || null;
        const targetDriveParentId = await resolveDriveFolderId({
          driveToken,
          cfg,
          supabaseToken: auth.accessToken,
          userId: auth.user.id,
          targetFolderId,
          vaultRootDriveId: structure.vaultFolderId,
        });

        const driveFile = await uploadBytesToDriveResumable(driveToken, {
          name: cleanFileName,
          mimeType,
          parentId: targetDriveParentId,
          bytes,
        });

        const insertRes = await supabaseRest<VaultFileRow[]>(
          cfg,
          auth.accessToken,
          'vault_files',
          {
            method: 'POST',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({
              owner_id: auth.user.id,
              folder_id: targetFolderId,
              name: cleanFileName,
              file_extension: ext,
              mime_type: mimeType,
              drive_file_id: driveFile.id,
              drive_parent_id: targetDriveParentId,
              file_size_bytes: bytes.byteLength,
              sha256,
            }),
          },
        );

        if (!insertRes.ok || !insertRes.data || insertRes.data.length === 0) {
          await deleteDriveItem(driveToken, driveFile.id).catch(() => undefined);
          return jsonResponse(
            { error: `Failed to save imported file metadata: ${insertRes.errorText || 'DB error'}` },
            500,
          );
        }

        return jsonResponse(
          { imported: true, destination: 'files', file: insertRes.data[0] },
          201,
        );
      }

      // destination === 'mods'
      const rawLoader = String(body.loader || 'Fabric').trim();
      const normalizedLoader =
        Array.from(VALID_LOADERS).find((l) => l.toLowerCase() === rawLoader.toLowerCase()) ||
        'Fabric';
      const mcVersion = (body.mcVersion || '1.21.1').trim().slice(0, 32);
      const versionNumber = (body.versionNumber || '1.0.0').trim().slice(0, 64);

      const driveFile = await uploadBytesToDriveResumable(driveToken, {
        name: cleanFileName,
        mimeType,
        parentId: structure.modsFolderId,
        bytes,
      });

      let targetModId = body.targetModId || null;
      let createdModId: string | null = null;

      if (!targetModId) {
        const title = (body.projectTitle || cleanFileName.replace(/\.jar$/i, '')).trim().slice(0, 120);
        const modSlug = `${slugify(body.projectSlug || title)}-${crypto.randomUUID().slice(0, 6)}`;
        const modRes = await supabaseRest<ModRow[]>(cfg, auth.accessToken, 'mods', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            owner_id: auth.user.id,
            category_id: body.categoryId || null,
            name: title,
            slug: modSlug,
            description: (body.projectSummary || '').trim().slice(0, 2000),
            loader: normalizedLoader,
            latest_mc_version: mcVersion,
          }),
        });

        if (!modRes.ok || !modRes.data || modRes.data.length === 0) {
          await deleteDriveItem(driveToken, driveFile.id).catch(() => undefined);
          return jsonResponse(
            { error: `Failed to create mod entry: ${modRes.errorText || 'DB error'}` },
            500,
          );
        }
        targetModId = modRes.data[0].id;
        createdModId = targetModId;
      }

      const verRes = await supabaseRest<ModVersionRow[]>(
        cfg,
        auth.accessToken,
        'mod_versions',
        {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            mod_id: targetModId,
            owner_id: auth.user.id,
            version_number: versionNumber,
            mc_version: mcVersion,
            loader: normalizedLoader,
            file_name: cleanFileName,
            mime_type: mimeType,
            drive_file_id: driveFile.id,
            drive_parent_id: structure.modsFolderId,
            file_size_bytes: bytes.byteLength,
            sha256,
            changelog: (body.changelog || '').trim().slice(0, 4000),
          }),
        },
      );

      if (!verRes.ok || !verRes.data || verRes.data.length === 0) {
        await deleteDriveItem(driveToken, driveFile.id).catch(() => undefined);
        if (createdModId) {
          await supabaseRest(
            cfg,
            auth.accessToken,
            `mods?id=eq.${encodeURIComponent(createdModId)}&owner_id=eq.${encodeURIComponent(auth.user.id)}`,
            { method: 'DELETE' },
          ).catch(() => undefined);
        }
        return jsonResponse(
          { error: `Failed to save imported version metadata: ${verRes.errorText || 'DB error'}` },
          500,
        );
      }

      if (!createdModId) {
        await supabaseRest(
          cfg,
          auth.accessToken,
          `mods?id=eq.${encodeURIComponent(targetModId)}&owner_id=eq.${encodeURIComponent(auth.user.id)}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              loader: normalizedLoader,
              latest_mc_version: mcVersion,
            }),
          },
        ).catch(() => undefined);
      }

      return jsonResponse(
        {
          imported: true,
          destination: 'mods',
          modId: targetModId,
          version: verRes.data[0],
        },
        201,
      );
    }

    return jsonResponse({ error: 'API route not found.' }, 404);
  } catch (err) {
    if (err instanceof DriveApiError) {
      if (err.status === 401 && activeOwnerId) {
        await clearServerDriveSession(cfg, activeOwnerId).catch(() => undefined);
      }
      return jsonResponse({ error: err.message, code: err.code }, err.status);
    }
    const message = err instanceof Error ? err.message : 'Internal server error';
    return jsonResponse({ error: message }, 500);
  }
}

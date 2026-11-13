// Server-side Google Drive session store (memory + optional Supabase service_role table)
// Access tokens stay strictly on the server and are NEVER returned in API JSON responses.

export interface DriveVaultFolders {
  rootId: string;
  modsFolderId: string;
  vaultFolderId: string;
  thumbnailsFolderId: string;
}

export interface ServerDriveSession {
  ownerId: string;
  accessToken: string;
  googleEmail: string | null;
  googleName: string | null;
  expiresAtMs: number;
  folders: DriveVaultFolders | null;
  persistedInDb: boolean;
}

export interface DriveSessionDbConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  supabaseConfigured: boolean;
  serviceRoleConfigured: boolean;
}

interface DbSessionRow {
  owner_id: string;
  google_email: string | null;
  google_name: string | null;
  access_token: string;
  expires_at: string;
  root_folder_id: string | null;
  mods_folder_id: string | null;
  vault_folder_id: string | null;
  thumbnails_folder_id: string | null;
}

const TOKEN_EXPIRY_BUFFER_MS = 15_000;
const memoryDriveSessions = new Map<string, ServerDriveSession>();

function getServiceHeaders(cfg: DriveSessionDbConfig): Record<string, string> {
  return {
    apikey: cfg.serviceRoleKey,
    Authorization: `Bearer ${cfg.serviceRoleKey}`,
    'Content-Type': 'application/json',
  };
}

export function isServerDriveSessionActive(session: ServerDriveSession | null | undefined): boolean {
  if (!session || !session.accessToken) return false;
  return session.expiresAtMs > Date.now() + TOKEN_EXPIRY_BUFFER_MS;
}

let loggedMissingTableNotice = false;

function isMissingSessionTable(status: number, bodyText: string): boolean {
  return (
    status === 404 ||
    bodyText.includes('PGRST205') ||
    bodyText.includes('42P01') ||
    bodyText.includes('does not exist')
  );
}

export async function saveServerDriveSession(
  cfg: DriveSessionDbConfig,
  session: Omit<ServerDriveSession, 'persistedInDb'>,
): Promise<{ persistedInDb: boolean }> {
  let persistedInDb = false;

  if (cfg.supabaseConfigured && cfg.serviceRoleConfigured) {
    try {
      const res = await fetch(
        `${cfg.supabaseUrl}/rest/v1/vault_drive_sessions?on_conflict=owner_id`,
        {
          method: 'POST',
          headers: {
            ...getServiceHeaders(cfg),
            Prefer: 'resolution=merge-duplicates',
          },
          body: JSON.stringify({
            owner_id: session.ownerId,
            google_email: session.googleEmail,
            google_name: session.googleName,
            access_token: session.accessToken,
            expires_at: new Date(session.expiresAtMs).toISOString(),
            root_folder_id: session.folders?.rootId || null,
            mods_folder_id: session.folders?.modsFolderId || null,
            vault_folder_id: session.folders?.vaultFolderId || null,
            thumbnails_folder_id: session.folders?.thumbnailsFolderId || null,
            updated_at: new Date().toISOString(),
          }),
          signal: AbortSignal.timeout(5000),
        },
      );
      persistedInDb = res.ok;
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        if (isMissingSessionTable(res.status, errBody)) {
          if (!loggedMissingTableNotice) {
            loggedMissingTableNotice = true;
            console.info(
              '[MOD VAULT][DriveSession] vault_drive_sessions table not applied yet; using server memory session.',
            );
          }
        } else {
          console.info('[MOD VAULT][DriveSession] DB save skipped; kept in server memory', {
            status: res.status,
            ownerId: session.ownerId,
          });
        }
      }
    } catch {
      console.info('[MOD VAULT][DriveSession] DB save unreachable; kept in server memory', {
        ownerId: session.ownerId,
      });
    }
  }

  memoryDriveSessions.set(session.ownerId, {
    ...session,
    persistedInDb,
  });

  return { persistedInDb };
}

export async function getServerDriveSession(
  cfg: DriveSessionDbConfig,
  ownerId: string,
): Promise<{
  session: ServerDriveSession | null;
  persistedInDb: boolean;
  source: 'memory' | 'db' | 'none';
  expired: boolean;
}> {
  const cached = memoryDriveSessions.get(ownerId);
  if (cached) {
    if (isServerDriveSessionActive(cached)) {
      return {
        session: cached,
        persistedInDb: cached.persistedInDb,
        source: 'memory',
        expired: false,
      };
    }
    memoryDriveSessions.delete(ownerId);
    await clearServerDriveSession(cfg, ownerId);
    return { session: null, persistedInDb: false, source: 'none', expired: true };
  }

  if (!cfg.supabaseConfigured || !cfg.serviceRoleConfigured) {
    return { session: null, persistedInDb: false, source: 'none', expired: false };
  }

  try {
    const res = await fetch(
      `${cfg.supabaseUrl}/rest/v1/vault_drive_sessions?select=*&owner_id=eq.${encodeURIComponent(
        ownerId,
      )}&limit=1`,
      {
        headers: getServiceHeaders(cfg),
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      if (isMissingSessionTable(res.status, errBody)) {
        if (!loggedMissingTableNotice) {
          loggedMissingTableNotice = true;
          console.info(
            '[MOD VAULT][DriveSession] vault_drive_sessions table not applied yet; using server memory session.',
          );
        }
      } else {
        console.info('[MOD VAULT][DriveSession] DB read unavailable', {
          status: res.status,
          ownerId,
        });
      }
      return { session: null, persistedInDb: false, source: 'none', expired: false };
    }

    const rows = (await res.json().catch(() => null)) as DbSessionRow[] | null;
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || !row.access_token) {
      return { session: null, persistedInDb: false, source: 'none', expired: false };
    }

    const expiresAtMs = new Date(row.expires_at).getTime();
    const folders: DriveVaultFolders | null =
      row.root_folder_id && row.mods_folder_id && row.vault_folder_id && row.thumbnails_folder_id
        ? {
            rootId: row.root_folder_id,
            modsFolderId: row.mods_folder_id,
            vaultFolderId: row.vault_folder_id,
            thumbnailsFolderId: row.thumbnails_folder_id,
          }
        : null;

    const restored: ServerDriveSession = {
      ownerId: row.owner_id,
      accessToken: row.access_token,
      googleEmail: row.google_email || null,
      googleName: row.google_name || null,
      expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : 0,
      folders,
      persistedInDb: true,
    };

    if (!isServerDriveSessionActive(restored)) {
      await clearServerDriveSession(cfg, ownerId);
      return { session: null, persistedInDb: true, source: 'none', expired: true };
    }

    memoryDriveSessions.set(ownerId, restored);
    return { session: restored, persistedInDb: true, source: 'db', expired: false };
  } catch {
    console.info('[MOD VAULT][DriveSession] DB read unreachable; falling back to memory', {
      ownerId,
    });
    return { session: null, persistedInDb: false, source: 'none', expired: false };
  }
}

export async function clearServerDriveSession(
  cfg: DriveSessionDbConfig,
  ownerId: string,
): Promise<void> {
  memoryDriveSessions.delete(ownerId);

  if (!cfg.supabaseConfigured || !cfg.serviceRoleConfigured) {
    return;
  }

  try {
    await fetch(
      `${cfg.supabaseUrl}/rest/v1/vault_drive_sessions?owner_id=eq.${encodeURIComponent(ownerId)}`,
      {
        method: 'DELETE',
        headers: getServiceHeaders(cfg),
        signal: AbortSignal.timeout(4000),
      },
    );
  } catch {
    // Best-effort cleanup
  }
}

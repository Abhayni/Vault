/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import type {
  Category,
  DriveQuotaInfo,
  DriveSessionStatus,
  ModRecord,
  ModVersion,
  ToastMessage,
  VaultConfigStatus,
  VaultFavorites,
  VaultFile,
  VaultFolder,
  VaultPage,
  VaultPreferences,
} from './types/vault';
import {
  apiBlobRequest,
  apiRequest,
  DriveAuthRequiredError,
  fetchVaultConfig,
  getSupabaseClient,
} from './lib/supabase';
import {
  connectGoogleDrive,
  disconnectGoogleDrive,
  initGoogleDriveAuth,
  invalidateGoogleDriveToken,
} from './lib/google-drive-auth';
import {
  applyVaultTheme,
  cacheVaultFavoritesLocally,
  cacheVaultPreferencesLocally,
  DEFAULT_VAULT_FAVORITES,
  DEFAULT_VAULT_PREFERENCES,
  loadVaultFavorites,
  loadVaultPreferences,
  resolveEffectiveDark,
} from './lib/preferences';
import { triggerBlobDownload } from './lib/format';
import { packageUrlsAsZip } from './lib/archive-tools';
import { SidebarLayout } from './components/SidebarLayout';
import { ModFormModal } from './components/ModFormModal';
import { FilePreviewModal } from './components/FilePreviewModal';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { MyModsPage } from './pages/MyModsPage';
import { FileManagerPage } from './pages/FileManagerPage';
import { UploadModPage } from './pages/UploadModPage';
import { ModDetailsPage } from './pages/ModDetailsPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { FavoritesPage } from './pages/FavoritesPage';
import { RecentFilesPage } from './pages/RecentFilesPage';
import { TrashPage } from './pages/TrashPage';
import { ModrinthExplorerPage } from './pages/ModrinthExplorerPage';
import { GoogleDrivePage } from './pages/GoogleDrivePage';
import { SettingsPage } from './pages/SettingsPage';

export default function App() {
  const [config, setConfig] = useState<VaultConfigStatus | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [checkingConfig, setCheckingConfig] = useState(false);

  const [session, setSession] = useState<Session | null>(null);
  const [ownerVerified, setOwnerVerified] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);

  const [googleDriveToken, setGoogleDriveToken] = useState<string | null>(null);
  const [driveConnected, setDriveConnected] = useState(false);
  const [driveNeedsReconnect, setDriveNeedsReconnect] = useState(false);
  const [driveSessionInfo, setDriveSessionInfo] = useState<DriveSessionStatus | null>(null);
  const [driveConnecting, setDriveConnecting] = useState(false);
  const [driveQuota, setDriveQuota] = useState<DriveQuotaInfo | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);

  const [activePage, setActivePage] = useState<VaultPage>('dashboard');
  const [selectedModId, setSelectedModId] = useState<string | null>(null);
  const [uploadTargetModId, setUploadTargetModId] = useState<string | null>(null);
  const [initialCategoryFilter, setInitialCategoryFilter] = useState<string>('');
  const [globalSearch, setGlobalSearch] = useState('');

  const [mods, setMods] = useState<ModRecord[]>([]);
  const [versions, setVersions] = useState<ModVersion[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [vaultFolders, setVaultFolders] = useState<VaultFolder[]>([]);
  const [vaultFiles, setVaultFiles] = useState<VaultFile[]>([]);
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({});
  const thumbnailObjectUrlsRef = useRef<string[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [batchDownloading, setBatchDownloading] = useState(false);

  const [editingMod, setEditingMod] = useState<ModRecord | null>(null);
  const [dashboardPreviewFile, setDashboardPreviewFile] = useState<VaultFile | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [preferences, setPreferences] = useState<VaultPreferences>({
    ...DEFAULT_VAULT_PREFERENCES,
  });
  const [favorites, setFavorites] = useState<VaultFavorites>({
    ...DEFAULT_VAULT_FAVORITES,
  });

  const notify = useCallback(
    (type: 'success' | 'error' | 'info', title: string, detail?: string) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev, { id, type, title, detail }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, type === 'error' ? 9000 : 4500);
    },
    [],
  );

  const revokeThumbnailUrls = useCallback(() => {
    for (const url of thumbnailObjectUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    thumbnailObjectUrlsRef.current = [];
    setThumbnailUrls({});
  }, []);

  const handleDriveAuthFailure = useCallback((reasonMessage?: string) => {
    invalidateGoogleDriveToken();
    setGoogleDriveToken(null);
    setDriveConnected(false);
    setDriveNeedsReconnect(true);
    setDriveQuota(null);
    setDriveSessionInfo(null);
    if (reasonMessage) {
      setDriveError(reasonMessage);
    }
  }, []);

  const loadConfig = useCallback(async () => {
    setCheckingConfig(true);
    try {
      const next = await fetchVaultConfig();
      setConfig(next);
    } catch (err) {
      notify(
        'error',
        'Backend unreachable',
        err instanceof Error ? err.message : 'Unable to reach /api/config',
      );
    } finally {
      setConfigLoading(false);
      setCheckingConfig(false);
    }
  }, [notify]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    applyVaultTheme(preferences.theme);
    if (preferences.theme !== 'system' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyVaultTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [preferences.theme]);

  useEffect(() => {
    const unsubscribe = initGoogleDriveAuth(
      (_user, token) => {
        setGoogleDriveToken(token);
      },
      () => {
        setGoogleDriveToken(null);
      },
    );
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const url of thumbnailObjectUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  const supabase: SupabaseClient | null = useMemo(
    () => getSupabaseClient(config),
    [config],
  );

  const verifyOwnerSession = useCallback(
    async (activeSession: Session | null) => {
      if (!activeSession?.access_token || !supabase) {
        setOwnerVerified(false);
        return false;
      }

      try {
        const res = await fetch('/api/auth/verify', {
          headers: { Authorization: `Bearer ${activeSession.access_token}` },
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          await supabase.auth.signOut();
          setSession(null);
          setOwnerVerified(false);
          setAuthError(body.error || 'Access restricted to OWNER_EMAIL.');
          return false;
        }
        setAuthError(null);
        setOwnerVerified(true);
        return true;
      } catch {
        setOwnerVerified(false);
        return false;
      }
    },
    [supabase],
  );

  useEffect(() => {
    if (!supabase) return;

    let mounted = true;

    void supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      if (data.session) {
        setPreferences(loadVaultPreferences(data.session.user));
        setFavorites(loadVaultFavorites(data.session.user));
        await verifyOwnerSession(data.session);
      } else {
        setOwnerVerified(false);
        setPreferences({ ...DEFAULT_VAULT_PREFERENCES });
        setFavorites({ ...DEFAULT_VAULT_FAVORITES });
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (event, nextSession) => {
        if (!mounted) return;
        if (event === 'PASSWORD_RECOVERY') {
          setIsRecoveryMode(true);
        }
        if (event === 'SIGNED_OUT') {
          setSession(null);
          setOwnerVerified(false);
          setMods([]);
          setVersions([]);
          setCategories([]);
          setVaultFolders([]);
          setVaultFiles([]);
          setPreferences({ ...DEFAULT_VAULT_PREFERENCES });
          setFavorites({ ...DEFAULT_VAULT_FAVORITES });
          revokeThumbnailUrls();
          handleDriveAuthFailure();
          return;
        }
        setSession(nextSession);
        if (nextSession && event !== 'PASSWORD_RECOVERY') {
          setPreferences(loadVaultPreferences(nextSession.user));
          setFavorites(loadVaultFavorites(nextSession.user));
          await verifyOwnerSession(nextSession);
        }
      },
    );

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase, verifyOwnerSession, revokeThumbnailUrls, handleDriveAuthFailure]);

  const syncDriveStatus = useCallback(
    async (
      supabaseToken: string,
      overrideDriveToken?: string | null,
    ): Promise<DriveSessionStatus | null> => {
      try {
        const status = await apiRequest<DriveSessionStatus>(
          '/api/drive/status',
          supabaseToken,
          { method: 'GET' },
          overrideDriveToken ?? googleDriveToken,
        );
        setDriveSessionInfo(status);
        if (status.connected) {
          setDriveConnected(true);
          setDriveNeedsReconnect(status.expiresInSeconds > 0 && status.expiresInSeconds <= 300);
          setDriveQuota(status.quota);
          setDriveError(null);
        } else {
          setDriveConnected(false);
          setDriveQuota(null);
          if (status.reason === 'expired') {
            invalidateGoogleDriveToken();
            setGoogleDriveToken(null);
            setDriveNeedsReconnect(true);
            setDriveError(
              status.error || 'Google Drive session expired. Click Reconnect Google Drive.',
            );
          } else {
            setDriveNeedsReconnect(false);
          }
        }
        return status;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unable to check Google Drive session.';
        if (err instanceof DriveAuthRequiredError) {
          handleDriveAuthFailure(message);
        } else {
          setDriveError(message);
        }
        return null;
      }
    },
    [googleDriveToken, handleDriveAuthFailure],
  );

  const handleConnectDrive = useCallback(async (): Promise<string | null> => {
    setDriveConnecting(true);
    setDriveError(null);
    try {
      let supabaseToken = session?.access_token || '';
      if (!supabaseToken && supabase) {
        const { data } = await supabase.auth.getSession();
        supabaseToken = data.session?.access_token || '';
      }
      if (!supabaseToken) {
        throw new Error('Sign in with your MOD VAULT owner account before connecting Google Drive.');
      }

      const { accessToken: token } = await connectGoogleDrive();
      const connected = await apiRequest<DriveSessionStatus>(
        '/api/drive/connect',
        supabaseToken,
        {
          method: 'POST',
          body: JSON.stringify({ driveAccessToken: token }),
        },
        token,
      );

      if (!connected.connected) {
        throw new Error(connected.error || 'Backend could not verify the Google Drive session.');
      }

      setGoogleDriveToken(token);
      setDriveConnected(true);
      setDriveNeedsReconnect(false);
      setDriveSessionInfo(connected);
      setDriveQuota(connected.quota);
      setDriveError(null);
      notify(
        'success',
        'Google Drive connected',
        connected.email
          ? `Private Drive access verified for ${connected.email}.`
          : 'Private MOD VAULT Drive folder ready.',
      );
      return token;
    } catch (err) {
      invalidateGoogleDriveToken();
      setGoogleDriveToken(null);
      setDriveConnected(false);
      setDriveQuota(null);
      setDriveSessionInfo(null);
      const message =
        err instanceof Error ? err.message : 'Unable to authorize Google Drive.';
      setDriveError(message);
      notify('error', 'Google Drive connection failed', message);
      return null;
    } finally {
      setDriveConnecting(false);
    }
  }, [session?.access_token, supabase, notify]);

  const handleDisconnectDrive = useCallback(async () => {
    if (session?.access_token) {
      await apiRequest(
        '/api/drive/disconnect',
        session.access_token,
        { method: 'POST' },
      ).catch(() => undefined);
    }
    await disconnectGoogleDrive().catch(() => undefined);
    invalidateGoogleDriveToken();
    setGoogleDriveToken(null);
    setDriveConnected(false);
    setDriveNeedsReconnect(false);
    setDriveQuota(null);
    setDriveSessionInfo(null);
    setDriveError(null);
    revokeThumbnailUrls();
    notify('info', 'Google Drive disconnected', 'Drive session cleared.');
  }, [session?.access_token, revokeThumbnailUrls, notify]);

  const ensureDriveConnected = useCallback(async (): Promise<boolean> => {
    if (driveConnected) return true;
    if (session?.access_token) {
      const status = await syncDriveStatus(session.access_token);
      if (status?.connected) return true;
    }
    const token = await handleConnectDrive();
    return Boolean(token);
  }, [driveConnected, session?.access_token, syncDriveStatus, handleConnectDrive]);

  const loadVaultData = useCallback(async () => {
    if (!supabase || !session?.access_token || !ownerVerified) return;
    setDataLoading(true);
    try {
      const [modsRes, versRes, catsRes, foldersRes, filesRes] = await Promise.all([
        supabase
          .from('mods')
          .select('*')
          .order('updated_at', { ascending: false }),
        supabase
          .from('mod_versions')
          .select('*')
          .order('created_at', { ascending: false }),
        supabase.from('categories').select('*').order('name', { ascending: true }),
        supabase.from('vault_folders').select('*').order('name', { ascending: true }),
        supabase
          .from('vault_files')
          .select('*')
          .order('created_at', { ascending: false }),
      ]);

      if (modsRes.error) throw modsRes.error;
      if (versRes.error) throw versRes.error;
      if (catsRes.error) throw catsRes.error;
      if (foldersRes.error) throw foldersRes.error;
      if (filesRes.error) throw filesRes.error;

      setMods((modsRes.data || []) as ModRecord[]);
      setVersions((versRes.data || []) as ModVersion[]);
      setCategories((catsRes.data || []) as Category[]);
      setVaultFolders((foldersRes.data || []) as VaultFolder[]);
      setVaultFiles((filesRes.data || []) as VaultFile[]);

      void syncDriveStatus(session.access_token);
    } catch (err) {
      notify(
        'error',
        'Failed to load vault data',
        err instanceof Error ? err.message : 'Ensure updated schema.sql is applied.',
      );
    } finally {
      setDataLoading(false);
    }
  }, [supabase, session, ownerVerified, syncDriveStatus, notify]);

  useEffect(() => {
    if (ownerVerified && session?.access_token) {
      void loadVaultData();
    }
  }, [ownerVerified, session?.access_token, loadVaultData]);

  // Periodically check Drive session validity while connected (detects near-expiry)
  useEffect(() => {
    if (!ownerVerified || !session?.access_token || !driveConnected) return;
    const timer = setInterval(() => {
      void syncDriveStatus(session.access_token);
    }, 120_000);
    return () => clearInterval(timer);
  }, [ownerVerified, session?.access_token, driveConnected, syncDriveStatus]);

  // Load private mod thumbnails from Google Drive via backend proxy whenever Drive is connected
  useEffect(() => {
    if (!ownerVerified || !session?.access_token || !driveConnected) {
      revokeThumbnailUrls();
      return;
    }

    const driveIds = Array.from(
      new Set(
        mods
          .map((m) => m.thumbnail_drive_id)
          .filter((id): id is string => Boolean(id)),
      ),
    );

    if (driveIds.length === 0) {
      revokeThumbnailUrls();
      return;
    }

    let active = true;
    const createdUrls: string[] = [];

    const fetchThumbs = async () => {
      const nextMap: Record<string, string> = {};
      await Promise.all(
        driveIds.map(async (driveId) => {
          try {
            const { blob } = await apiBlobRequest(
              `/api/thumbnails/${encodeURIComponent(driveId)}`,
              session.access_token,
              googleDriveToken,
              { method: 'GET' },
            );
            const url = URL.createObjectURL(blob);
            createdUrls.push(url);
            nextMap[driveId] = url;
          } catch (err) {
            if (err instanceof DriveAuthRequiredError && active) {
              handleDriveAuthFailure(err.message);
            }
          }
        }),
      );

      if (!active) {
        for (const u of createdUrls) URL.revokeObjectURL(u);
        return;
      }

      for (const oldUrl of thumbnailObjectUrlsRef.current) {
        URL.revokeObjectURL(oldUrl);
      }
      thumbnailObjectUrlsRef.current = createdUrls;
      setThumbnailUrls(nextMap);
    };

    void fetchThumbs();

    return () => {
      active = false;
    };
  }, [
    ownerVerified,
    session?.access_token,
    driveConnected,
    googleDriveToken,
    mods,
    revokeThumbnailUrls,
    handleDriveAuthFailure,
  ]);

  const handleSignOut = async () => {
    if (session?.access_token) {
      await apiRequest('/api/drive/disconnect', session.access_token, {
        method: 'POST',
      }).catch(() => undefined);
    }
    if (supabase) {
      await supabase.auth.signOut();
    }
    await disconnectGoogleDrive().catch(() => undefined);
    handleDriveAuthFailure();
    setDriveNeedsReconnect(false);
    setDriveError(null);
    revokeThumbnailUrls();
    setSession(null);
    setOwnerVerified(false);
    setIsRecoveryMode(false);
    setActivePage('dashboard');
  };

  const handleDownloadVersion = async (version: ModVersion) => {
    if (!session?.access_token) return;
    const ready = await ensureDriveConnected();
    if (!ready) return;

    try {
      notify('info', 'Streaming from Google Drive', version.file_name);
      const { blob, fileName } = await apiBlobRequest(
        `/api/versions/${encodeURIComponent(version.id)}/download`,
        session.access_token,
        googleDriveToken,
        { method: 'POST' },
      );

      triggerBlobDownload(blob, fileName || version.file_name);
    } catch (err) {
      if (err instanceof DriveAuthRequiredError) {
        handleDriveAuthFailure(err.message);
      }
      notify(
        'error',
        'Download failed',
        err instanceof Error ? err.message : 'Unable to stream file from Google Drive.',
      );
    }
  };

  const handleBatchDownloadVersions = async (versionIds: string[], zipName: string) => {
    if (!session?.access_token || versionIds.length === 0) return;
    const ready = await ensureDriveConnected();
    if (!ready) return;

    setBatchDownloading(true);
    try {
      notify(
        'info',
        'Preparing batch ZIP',
        `Streaming ${versionIds.length} mod version${versionIds.length === 1 ? '' : 's'} from Google Drive...`,
      );

      const signed = await apiRequest<{
        items: Array<{
          id: string;
          fileName: string;
          versionNumber: string;
          mcVersion: string;
          loader: string;
          downloadUrl: string;
        }>;
      }>(
        '/api/versions/sign-batch',
        session.access_token,
        {
          method: 'POST',
          body: JSON.stringify({ versionIds }),
        },
        googleDriveToken,
      );

      const batchHeaders: Record<string, string> = {
        Authorization: `Bearer ${session.access_token}`,
      };
      if (googleDriveToken) {
        batchHeaders['X-Google-Drive-Token'] = googleDriveToken;
      }

      const zipBlob = await packageUrlsAsZip(
        signed.items.map((item) => ({
          archivePath: item.fileName,
          downloadUrl: item.downloadUrl,
        })),
        undefined,
        {
          method: 'POST',
          headers: batchHeaders,
        },
      );

      triggerBlobDownload(zipBlob, zipName);
      notify(
        'success',
        'Batch ZIP ready',
        `${zipName} (${signed.items.length} mod files packaged).`,
      );
    } catch (err) {
      if (err instanceof DriveAuthRequiredError) {
        handleDriveAuthFailure(err.message);
      }
      notify(
        'error',
        'Batch download failed',
        err instanceof Error ? err.message : 'Unable to package selected mod versions.',
      );
    } finally {
      setBatchDownloading(false);
    }
  };

  const handleDownloadVaultFile = async (file: VaultFile) => {
    if (!session?.access_token) return;
    const ready = await ensureDriveConnected();
    if (!ready) return;

    try {
      notify('info', 'Streaming from Google Drive', file.name);
      const { blob, fileName } = await apiBlobRequest(
        `/api/vault/files/${encodeURIComponent(file.id)}/download`,
        session.access_token,
        googleDriveToken,
        {
          method: 'POST',
          body: JSON.stringify({ mode: 'attachment' }),
        },
      );
      triggerBlobDownload(blob, fileName || file.name);
    } catch (err) {
      if (err instanceof DriveAuthRequiredError) {
        handleDriveAuthFailure(err.message);
      }
      notify(
        'error',
        'Download failed',
        err instanceof Error ? err.message : 'Unable to stream file from Google Drive.',
      );
    }
  };

  const updatePreferences = useCallback(
    (patch: Partial<VaultPreferences>) => {
      setPreferences((prev) => {
        const next: VaultPreferences = { ...prev, ...patch };
        if (session?.user?.id) {
          cacheVaultPreferencesLocally(session.user.id, next);
        }
        if (supabase && session?.user) {
          void supabase.auth
            .updateUser({ data: { vault_prefs: next } })
            .catch(() => undefined);
        }
        return next;
      });
    },
    [supabase, session],
  );

  const toggleFavoriteMod = useCallback(
    (modId: string) => {
      setFavorites((prev) => {
        const exists = prev.modIds.includes(modId);
        const modIds = exists
          ? prev.modIds.filter((id) => id !== modId)
          : [...prev.modIds, modId];
        const next: VaultFavorites = { ...prev, modIds };
        if (session?.user?.id) {
          cacheVaultFavoritesLocally(session.user.id, next);
        }
        if (supabase && session?.user) {
          void supabase.auth
            .updateUser({ data: { vault_favorites: next } })
            .catch(() => undefined);
        }
        return next;
      });
    },
    [supabase, session],
  );

  const toggleFavoriteFile = useCallback(
    (fileId: string) => {
      setFavorites((prev) => {
        const exists = prev.fileIds.includes(fileId);
        const fileIds = exists
          ? prev.fileIds.filter((id) => id !== fileId)
          : [...prev.fileIds, fileId];
        const next: VaultFavorites = { ...prev, fileIds };
        if (session?.user?.id) {
          cacheVaultFavoritesLocally(session.user.id, next);
        }
        if (supabase && session?.user) {
          void supabase.auth
            .updateUser({ data: { vault_favorites: next } })
            .catch(() => undefined);
        }
        return next;
      });
    },
    [supabase, session],
  );

  const validFavoriteModIds = useMemo(() => {
    const existing = new Set(mods.map((m) => m.id));
    return new Set(favorites.modIds.filter((id) => existing.has(id)));
  }, [favorites.modIds, mods]);

  const validFavoriteFileIds = useMemo(() => {
    const existing = new Set(vaultFiles.map((f) => f.id));
    return new Set(favorites.fileIds.filter((id) => existing.has(id)));
  }, [favorites.fileIds, vaultFiles]);

  const favoritesCount = validFavoriteModIds.size + validFavoriteFileIds.size;

  const handleDeleteMod = async (mod: ModRecord) => {
    if (!session?.access_token) return;
    const ready = await ensureDriveConnected();
    if (!ready) return;

    try {
      await apiRequest(
        '/api/trash/move',
        session.access_token,
        {
          method: 'POST',
          body: JSON.stringify({ kind: 'mod', id: mod.id }),
        },
        googleDriveToken,
      );
      notify('success', 'Moved to Trash', `${mod.name} can be restored from Trash.`);
      if (selectedModId === mod.id) {
        setSelectedModId(null);
        setActivePage('mods');
      }
      await loadVaultData();
    } catch (err) {
      if (err instanceof DriveAuthRequiredError) {
        handleDriveAuthFailure(err.message);
      }
      notify(
        'error',
        'Move to Trash failed',
        err instanceof Error ? err.message : 'Unable to move mod to Trash.',
      );
    }
  };

  const handleDeleteVersion = async (version: ModVersion) => {
    if (!session?.access_token) return;
    const ready = await ensureDriveConnected();
    if (!ready) return;

    try {
      await apiRequest(
        '/api/trash/move',
        session.access_token,
        {
          method: 'POST',
          body: JSON.stringify({ kind: 'version', id: version.id }),
        },
        googleDriveToken,
      );
      notify('success', 'Version moved to Trash', `${version.file_name} can be restored from Trash.`);
      await loadVaultData();
    } catch (err) {
      if (err instanceof DriveAuthRequiredError) {
        handleDriveAuthFailure(err.message);
      }
      notify(
        'error',
        'Move to Trash failed',
        err instanceof Error ? err.message : 'Unable to move version to Trash.',
      );
    }
  };

  const toggleTheme = useCallback(() => {
    const isCurrentlyDark = resolveEffectiveDark(preferences.theme);
    updatePreferences({ theme: isCurrentlyDark ? 'light' : 'dark' });
  }, [preferences.theme, updatePreferences]);

  if (configLoading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#090B12] flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-[#8B5CF6] border-t-transparent animate-spin" />
          <p className="text-xs font-mono text-slate-500 dark:text-[#94A3B8]">
            Initializing MOD VAULT...
          </p>
        </div>
      </div>
    );
  }

  if (!session || !ownerVerified || isRecoveryMode) {
    return (
      <LoginPage
        config={config}
        supabase={supabase}
        isRecoveryMode={isRecoveryMode}
        onRecheckConfig={loadConfig}
        checkingConfig={checkingConfig}
        authError={authError}
        onAuthenticated={async () => {
          setIsRecoveryMode(false);
          if (supabase) {
            const { data } = await supabase.auth.getSession();
            setSession(data.session);
            if (data.session) {
              setPreferences(loadVaultPreferences(data.session.user));
              setFavorites(loadVaultFavorites(data.session.user));
              await verifyOwnerSession(data.session);
            }
          }
        }}
      />
    );
  }

  const selectedMod = selectedModId
    ? mods.find((m) => m.id === selectedModId) || null
    : null;

  const pageMeta: Record<VaultPage, { title: string; breadcrumb?: string }> = {
    dashboard: { title: 'Dashboard', breadcrumb: 'My Private Storage' },
    mods: { title: 'My Mods', breadcrumb: 'My Private Storage' },
    files: { title: 'File Manager', breadcrumb: 'My Private Storage' },
    recent: { title: 'Recent Files', breadcrumb: 'My Private Storage' },
    favorites: { title: 'Favorites', breadcrumb: 'My Private Storage' },
    trash: { title: 'Trash', breadcrumb: 'My Private Storage' },
    modrinth: { title: 'Modrinth Explorer', breadcrumb: 'Discover' },
    upload: { title: 'Upload Center', breadcrumb: 'My Private Storage' },
    'mod-details': {
      title: selectedMod?.name || 'Mod Details',
      breadcrumb: 'My Mods',
    },
    categories: { title: 'Categories', breadcrumb: 'My Mods' },
    drive: { title: 'Google Drive', breadcrumb: 'System' },
    settings: { title: 'Settings', breadcrumb: 'System' },
  };

  const navigateTo = (page: VaultPage) => {
    if (page !== 'upload') {
      setUploadTargetModId(null);
    }
    setActivePage(page);
  };

  const selectedThumbKey =
    selectedMod?.thumbnail_drive_id || selectedMod?.thumbnail_key || null;

  return (
    <>
      <SidebarLayout
        activePage={activePage}
        onNavigate={navigateTo}
        pageTitle={pageMeta[activePage].title}
        breadcrumb={pageMeta[activePage].breadcrumb}
        ownerEmail={session.user.email || ''}
        onSignOut={handleSignOut}
        globalSearch={globalSearch}
        onGlobalSearchChange={setGlobalSearch}
        driveConnected={driveConnected}
        driveNeedsReconnect={driveNeedsReconnect}
        driveConnecting={driveConnecting}
        driveEmail={driveSessionInfo?.email || driveQuota?.userEmail || null}
        driveQuota={driveQuota}
        driveError={driveError}
        onDismissDriveError={() => setDriveError(null)}
        onConnectDrive={handleConnectDrive}
        sidebarCollapsed={preferences.sidebarCollapsed}
        onToggleSidebarCollapsed={() =>
          updatePreferences({ sidebarCollapsed: !preferences.sidebarCollapsed })
        }
        theme={preferences.theme}
        onToggleTheme={toggleTheme}
        compactDensity={preferences.compactDensity}
        favoritesCount={favoritesCount}
      >
        {activePage === 'dashboard' && (
          <DashboardPage
            mods={mods}
            versions={versions}
            categories={categories}
            vaultFolders={vaultFolders}
            vaultFiles={vaultFiles}
            thumbnailUrls={thumbnailUrls}
            driveQuota={driveQuota}
            driveConnected={driveConnected}
            favoritesCount={favoritesCount}
            loading={dataLoading}
            onNavigate={navigateTo}
            onOpenMod={(id) => {
              setSelectedModId(id);
              setActivePage('mod-details');
            }}
            onPreviewVaultFile={(file) => setDashboardPreviewFile(file)}
            onDownloadVersion={handleDownloadVersion}
            onDownloadVaultFile={handleDownloadVaultFile}
          />
        )}

        {activePage === 'mods' && (
          <MyModsPage
            mods={mods}
            versions={versions}
            categories={categories}
            thumbnailUrls={thumbnailUrls}
            searchQuery={globalSearch}
            onSearchChange={setGlobalSearch}
            initialCategoryFilter={initialCategoryFilter}
            onClearInitialCategory={() => setInitialCategoryFilter('')}
            defaultViewMode={preferences.defaultModView}
            favoriteModIds={validFavoriteModIds}
            onToggleFavoriteMod={toggleFavoriteMod}
            onOpenMod={(id) => {
              setSelectedModId(id);
              setActivePage('mod-details');
            }}
            onEditMod={(mod) => setEditingMod(mod)}
            onDeleteMod={handleDeleteMod}
            onDownloadVersion={handleDownloadVersion}
            onBatchDownloadVersions={handleBatchDownloadVersions}
            batchDownloading={batchDownloading}
            onGoUpload={() => navigateTo('upload')}
            onOpenCategories={() => navigateTo('categories')}
          />
        )}

        {activePage === 'files' && (
          <FileManagerPage
            folders={vaultFolders}
            files={vaultFiles}
            config={config}
            accessToken={session.access_token}
            driveConnected={driveConnected}
            googleDriveToken={googleDriveToken}
            onEnsureDriveConnected={ensureDriveConnected}
            onDriveAuthInvalid={handleDriveAuthFailure}
            searchQuery={globalSearch}
            onSearchChange={setGlobalSearch}
            defaultViewMode={preferences.defaultFileView}
            confirmBeforeTrash={preferences.confirmBeforeTrash}
            defaultAutoUnzip={preferences.autoUnzipOnUpload}
            favoriteFileIds={validFavoriteFileIds}
            onToggleFavoriteFile={toggleFavoriteFile}
            onRefresh={loadVaultData}
            onNotify={notify}
          />
        )}

        {activePage === 'upload' && (
          <UploadModPage
            mods={mods}
            categories={categories}
            folders={vaultFolders}
            config={config}
            accessToken={session.access_token}
            driveConnected={driveConnected}
            googleDriveToken={googleDriveToken}
            onEnsureDriveConnected={ensureDriveConnected}
            onDriveAuthInvalid={handleDriveAuthFailure}
            initialTargetModId={uploadTargetModId}
            defaultAutoUnzip={preferences.autoUnzipOnUpload}
            onUploadComplete={async (modId) => {
              setUploadTargetModId(null);
              await loadVaultData();
              setSelectedModId(modId);
              setActivePage('mod-details');
            }}
            onFilesUploaded={async () => {
              await loadVaultData();
            }}
            onNotify={notify}
          />
        )}

        {activePage === 'mod-details' && selectedMod && (
          <ModDetailsPage
            mod={selectedMod}
            versions={versions.filter((v) => v.mod_id === selectedMod.id)}
            category={categories.find((c) => c.id === selectedMod.category_id) || null}
            thumbnailUrl={selectedThumbKey ? thumbnailUrls[selectedThumbKey] || null : null}
            isFavorite={validFavoriteModIds.has(selectedMod.id)}
            onToggleFavorite={toggleFavoriteMod}
            onBack={() => setActivePage('mods')}
            onUploadVersion={(modId) => {
              setUploadTargetModId(modId);
              setActivePage('upload');
            }}
            onEditMod={(mod) => setEditingMod(mod)}
            onDeleteMod={handleDeleteMod}
            onDeleteVersion={handleDeleteVersion}
            onDownloadVersion={handleDownloadVersion}
            onBatchDownloadVersions={handleBatchDownloadVersions}
            batchDownloading={batchDownloading}
          />
        )}

        {activePage === 'mod-details' && !selectedMod && (
          <div className="vault-glass rounded-xl p-8 text-center space-y-3">
            <p className="text-sm text-slate-600 dark:text-[#CBD5E1]">Selected mod was not found.</p>
            <button
              type="button"
              onClick={() => setActivePage('mods')}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#8B5CF6] text-white"
            >
              Return to My Mods
            </button>
          </div>
        )}

        {activePage === 'categories' && supabase && (
          <CategoriesPage
            categories={categories}
            mods={mods}
            versions={versions}
            supabase={supabase}
            userId={session.user.id}
            onRefresh={loadVaultData}
            onOpenCategoryMods={(catId) => {
              setInitialCategoryFilter(catId);
              setActivePage('mods');
            }}
            onNotify={notify}
          />
        )}

        {activePage === 'favorites' && (
          <FavoritesPage
            mods={mods}
            versions={versions}
            categories={categories}
            files={vaultFiles}
            folders={vaultFolders}
            thumbnailUrls={thumbnailUrls}
            favoriteModIds={validFavoriteModIds}
            favoriteFileIds={validFavoriteFileIds}
            onToggleFavoriteMod={toggleFavoriteMod}
            onToggleFavoriteFile={toggleFavoriteFile}
            onOpenMod={(id) => {
              setSelectedModId(id);
              setActivePage('mod-details');
            }}
            onDownloadVersion={handleDownloadVersion}
            onPreviewFile={(file) => setDashboardPreviewFile(file)}
            onDownloadFile={handleDownloadVaultFile}
            onNavigate={navigateTo}
          />
        )}

        {activePage === 'recent' && (
          <RecentFilesPage
            mods={mods}
            versions={versions}
            vaultFiles={vaultFiles}
            vaultFolders={vaultFolders}
            searchQuery={globalSearch}
            onSearchChange={setGlobalSearch}
            favoriteModIds={validFavoriteModIds}
            favoriteFileIds={validFavoriteFileIds}
            onToggleFavoriteMod={toggleFavoriteMod}
            onToggleFavoriteFile={toggleFavoriteFile}
            onOpenMod={(id) => {
              setSelectedModId(id);
              setActivePage('mod-details');
            }}
            onDownloadVersion={handleDownloadVersion}
            onPreviewVaultFile={(file) => setDashboardPreviewFile(file)}
            onDownloadVaultFile={handleDownloadVaultFile}
            onNavigate={navigateTo}
          />
        )}

        {activePage === 'trash' && (
          <TrashPage
            accessToken={session.access_token}
            driveConnected={driveConnected}
            googleDriveToken={googleDriveToken}
            onEnsureDriveConnected={ensureDriveConnected}
            onDriveAuthInvalid={handleDriveAuthFailure}
            onRestored={loadVaultData}
            onNotify={notify}
          />
        )}

        {activePage === 'modrinth' && (
          <ModrinthExplorerPage
            userId={session.user.id}
            accessToken={session.access_token}
            driveConnected={driveConnected}
            googleDriveToken={googleDriveToken}
            onEnsureDriveConnected={ensureDriveConnected}
            onDriveAuthInvalid={handleDriveAuthFailure}
            existingMods={mods}
            categories={categories}
            vaultFolders={vaultFolders}
            onImportedToVault={async () => {
              await loadVaultData();
            }}
            onNotify={notify}
          />
        )}

        {activePage === 'drive' && (
          <GoogleDrivePage
            mods={mods}
            versions={versions}
            categories={categories}
            vaultFolders={vaultFolders}
            vaultFiles={vaultFiles}
            driveConnected={driveConnected}
            driveNeedsReconnect={driveNeedsReconnect}
            driveConnecting={driveConnecting}
            driveSessionInfo={driveSessionInfo}
            driveQuota={driveQuota}
            driveError={driveError}
            onConnectDrive={handleConnectDrive}
            onDisconnectDrive={handleDisconnectDrive}
            onOpenMod={(id) => {
              setSelectedModId(id);
              setActivePage('mod-details');
            }}
          />
        )}

        {activePage === 'settings' && (
          <SettingsPage
            ownerEmail={session.user.email || ''}
            userId={session.user.id}
            config={config}
            supabase={supabase}
            driveConnected={driveConnected}
            driveNeedsReconnect={driveNeedsReconnect}
            driveConnecting={driveConnecting}
            driveSessionInfo={driveSessionInfo}
            driveQuota={driveQuota}
            driveError={driveError}
            preferences={preferences}
            onUpdatePreferences={updatePreferences}
            mods={mods}
            versions={versions}
            categories={categories}
            vaultFolders={vaultFolders}
            vaultFiles={vaultFiles}
            onNavigate={navigateTo}
            onConnectDrive={handleConnectDrive}
            onDisconnectDrive={handleDisconnectDrive}
            onRecheckConfig={loadConfig}
            checkingConfig={checkingConfig}
            onSignOut={handleSignOut}
            onNotify={notify}
          />
        )}
      </SidebarLayout>

      {editingMod && (
        <ModFormModal
          mod={editingMod}
          categories={categories}
          accessToken={session.access_token}
          driveConnected={driveConnected}
          googleDriveToken={googleDriveToken}
          onEnsureDriveConnected={ensureDriveConnected}
          onClose={() => setEditingMod(null)}
          onSaved={loadVaultData}
          onNotify={notify}
        />
      )}

      {dashboardPreviewFile && (
        <FilePreviewModal
          file={dashboardPreviewFile}
          accessToken={session.access_token}
          driveConnected={driveConnected}
          googleDriveToken={googleDriveToken}
          onConnectDrive={ensureDriveConnected}
          onDriveAuthInvalid={handleDriveAuthFailure}
          onClose={() => setDashboardPreviewFile(null)}
          onDownload={handleDownloadVaultFile}
        />
      )}

      {/* Toast Stack */}
      <div
        aria-live="polite"
        className="fixed bottom-20 lg:bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto vault-glass rounded-xl p-3.5 shadow-xl flex items-start gap-2.5 border border-slate-200 dark:border-white/12"
          >
            {toast.type === 'success' && (
              <CheckCircle2
                className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5"
                aria-hidden="true"
              />
            )}
            {toast.type === 'error' && (
              <AlertCircle
                className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5"
                aria-hidden="true"
              />
            )}
            {toast.type === 'info' && (
              <Info
                className="w-4 h-4 text-blue-600 dark:text-[#60A5FA] shrink-0 mt-0.5"
                aria-hidden="true"
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-950 dark:text-white">{toast.title}</p>
              {toast.detail && (
                <p className="text-[11px] text-slate-600 dark:text-[#94A3B8] mt-0.5 break-words">
                  {toast.detail}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
              aria-label="Dismiss notification"
              className="text-slate-500 dark:text-[#94A3B8] hover:text-slate-950 dark:hover:text-white p-1.5 rounded-lg min-h-[36px] min-w-[36px] flex items-center justify-center shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

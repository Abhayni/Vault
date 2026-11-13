import type { User } from '@supabase/supabase-js';
import type {
  ModrinthSearchHistoryEntry,
  VaultFavorites,
  VaultPreferences,
  VaultTheme,
} from '../types/vault';

export const GLOBAL_THEME_STORAGE_KEY = 'mod_vault_theme_v1';

export const DEFAULT_VAULT_PREFERENCES: VaultPreferences = {
  theme: readStoredGlobalTheme() || 'light',
  sidebarCollapsed: false,
  defaultFileView: 'list',
  defaultModView: 'table',
  compactDensity: false,
  confirmBeforeTrash: true,
  autoUnzipOnUpload: false,
};

export const DEFAULT_VAULT_FAVORITES: VaultFavorites = {
  modIds: [],
  fileIds: [],
};

const PREFS_KEY_PREFIX = 'mod_vault_prefs_v1:';
const FAVS_KEY_PREFIX = 'mod_vault_favs_v1:';
const MODRINTH_HISTORY_PREFIX = 'mod_vault_modrinth_history_v1:';

export function readStoredGlobalTheme(): VaultTheme | null {
  try {
    const val = localStorage.getItem(GLOBAL_THEME_STORAGE_KEY);
    if (val === 'light' || val === 'dark' || val === 'system') {
      return val;
    }
  } catch {
    // Ignore storage read errors
  }
  return null;
}

export function resolveEffectiveDark(theme: VaultTheme): boolean {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return false;
}

export function applyVaultTheme(theme: VaultTheme): void {
  if (typeof document === 'undefined') return;
  const isDark = resolveEffectiveDark(theme);
  document.documentElement.classList.toggle('dark', isDark);
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  try {
    localStorage.setItem(GLOBAL_THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore storage quota errors
  }
}

export function loadVaultPreferences(user: User | null | undefined): VaultPreferences {
  const globalTheme = readStoredGlobalTheme();
  const base: VaultPreferences = {
    ...DEFAULT_VAULT_PREFERENCES,
    theme: globalTheme || DEFAULT_VAULT_PREFERENCES.theme,
  };
  if (!user) return base;

  let localPrefs: Partial<VaultPreferences> = {};
  try {
    const raw = localStorage.getItem(`${PREFS_KEY_PREFIX}${user.id}`);
    if (raw) {
      localPrefs = JSON.parse(raw) as Partial<VaultPreferences>;
    }
  } catch {
    // Ignore storage read errors
  }

  const metaPrefs = (user.user_metadata?.vault_prefs || {}) as Partial<VaultPreferences>;

  return {
    ...base,
    ...localPrefs,
    ...metaPrefs,
  };
}

export function cacheVaultPreferencesLocally(userId: string, prefs: VaultPreferences): void {
  try {
    localStorage.setItem(`${PREFS_KEY_PREFIX}${userId}`, JSON.stringify(prefs));
    localStorage.setItem(GLOBAL_THEME_STORAGE_KEY, prefs.theme);
  } catch {
    // Ignore storage quota errors
  }
}

export function loadVaultFavorites(user: User | null | undefined): VaultFavorites {
  if (!user) return { modIds: [], fileIds: [] };

  let localFavs: Partial<VaultFavorites> = {};
  try {
    const raw = localStorage.getItem(`${FAVS_KEY_PREFIX}${user.id}`);
    if (raw) {
      localFavs = JSON.parse(raw) as Partial<VaultFavorites>;
    }
  } catch {
    // Ignore storage read errors
  }

  const metaFavs = (user.user_metadata?.vault_favorites || {}) as Partial<VaultFavorites>;

  const rawModIds = Array.isArray(metaFavs.modIds)
    ? metaFavs.modIds
    : Array.isArray(localFavs.modIds)
      ? localFavs.modIds
      : [];
  const rawFileIds = Array.isArray(metaFavs.fileIds)
    ? metaFavs.fileIds
    : Array.isArray(localFavs.fileIds)
      ? localFavs.fileIds
      : [];

  return {
    modIds: Array.from(new Set(rawModIds.filter((id): id is string => typeof id === 'string'))),
    fileIds: Array.from(new Set(rawFileIds.filter((id): id is string => typeof id === 'string'))),
  };
}

export function cacheVaultFavoritesLocally(userId: string, favs: VaultFavorites): void {
  try {
    localStorage.setItem(`${FAVS_KEY_PREFIX}${userId}`, JSON.stringify(favs));
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Modrinth Explorer search history — stored locally on device only,
 * completely separated from Supabase and private vault metadata.
 */
export function loadModrinthSearchHistory(userId: string): ModrinthSearchHistoryEntry[] {
  try {
    const raw = localStorage.getItem(`${MODRINTH_HISTORY_PREFIX}${userId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ModrinthSearchHistoryEntry[]).slice(0, 12) : [];
  } catch {
    return [];
  }
}

export function saveModrinthSearchHistory(
  userId: string,
  entries: ModrinthSearchHistoryEntry[],
): void {
  try {
    localStorage.setItem(
      `${MODRINTH_HISTORY_PREFIX}${userId}`,
      JSON.stringify(entries.slice(0, 12)),
    );
  } catch {
    // Ignore storage quota errors
  }
}

export function clearModrinthSearchHistory(userId: string): void {
  try {
    localStorage.removeItem(`${MODRINTH_HISTORY_PREFIX}${userId}`);
  } catch {
    // Ignore storage errors
  }
}

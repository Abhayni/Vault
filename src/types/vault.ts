export type ModLoader = 'Forge' | 'Fabric' | 'NeoForge' | 'Quilt';

export type VaultPage =
  | 'dashboard'
  | 'mods'
  | 'files'
  | 'recent'
  | 'favorites'
  | 'trash'
  | 'modrinth'
  | 'upload'
  | 'categories'
  | 'drive'
  | 'settings'
  | 'mod-details';

export type VaultTheme = 'light' | 'dark' | 'system';

export interface DriveQuotaInfo {
  limitBytes: number | null;
  usageBytes: number;
  usageInDriveBytes: number;
  usageInTrashBytes: number;
  userEmail: string | null;
  userDisplayName: string | null;
}

export interface DriveFoldersInfo {
  rootId: string;
  modsFolderId: string;
  vaultFolderId: string;
  thumbnailsFolderId: string;
}

export interface DriveSessionStatus {
  connected: boolean;
  email: string | null;
  displayName: string | null;
  expiresAt: string | null;
  expiresInSeconds: number;
  persisted: boolean;
  quota: DriveQuotaInfo | null;
  folders?: DriveFoldersInfo | null;
  reason?: 'not_connected' | 'expired' | 'invalid';
  error?: string | null;
}

export interface VaultConfigStatus {
  status: 'ready' | 'setup_required';
  runtime: string;
  configured: boolean;
  supabaseConfigured: boolean;
  serviceRoleConfigured: boolean;
  storageProvider: 'google-drive';
  storageConfigured: boolean;
  driveConfigured: boolean;
  ownerEmailConfigured: boolean;
  ownerEmailHint: string;
  storageBucket: string | null;
  maxUploadMb: number;
  allowedExtensions: string[];
  missingKeys: string[];
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  schemaReady?: boolean | null;
  storageBucketReady?: boolean | null;
  ownerAccountReady?: boolean | null;
}

export interface UploadAuthorization {
  provider: 'google-drive';
  uploadSessionUri: string;
  driveParentId: string;
  fileName: string;
  mimeType: string;
}

export interface Category {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  description: string;
  accent_color: string;
  created_at: string;
  updated_at: string;
}

export interface ModVersion {
  id: string;
  mod_id: string;
  owner_id: string;
  version_number: string;
  mc_version: string;
  loader: ModLoader;
  file_name: string;
  mime_type?: string;
  drive_file_id: string | null;
  drive_parent_id: string | null;
  storage_path?: string | null;
  file_size_bytes: number;
  sha256: string;
  changelog: string;
  created_at: string;
}

export interface ModRecord {
  id: string;
  owner_id: string;
  category_id: string | null;
  name: string;
  slug: string;
  description: string;
  loader: ModLoader;
  latest_mc_version: string;
  thumbnail_key: string | null;
  thumbnail_drive_id?: string | null;
  created_at: string;
  updated_at: string;
  versions?: ModVersion[];
  category?: Category | null;
}

export interface VaultFolder {
  id: string;
  owner_id: string;
  parent_id: string | null;
  drive_folder_id: string | null;
  drive_parent_id: string | null;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface VaultFile {
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

export interface TrashItem {
  trashId: string;
  kind: 'file' | 'folder' | 'mod' | 'version';
  title: string;
  subtitle: string;
  sizeBytes: number;
  deletedAt: string;
  driveIds: string[];
}

export interface VaultFavorites {
  modIds: string[];
  fileIds: string[];
}

export interface VaultPreferences {
  theme: VaultTheme;
  sidebarCollapsed: boolean;
  defaultFileView: 'list' | 'grid';
  defaultModView: 'table' | 'grid';
  compactDensity: boolean;
  confirmBeforeTrash: boolean;
  autoUnzipOnUpload: boolean;
}

export interface ModrinthSearchHit {
  project_id: string;
  project_type: 'mod' | 'modpack' | string;
  slug: string;
  author: string;
  title: string;
  description: string;
  categories: string[];
  display_categories?: string[];
  versions: string[];
  downloads: number;
  follows: number;
  icon_url: string | null;
  date_created: string;
  date_modified: string;
  latest_version?: string;
  license?: string;
}

export interface ModrinthProjectDetails {
  id: string;
  slug: string;
  project_type: 'mod' | 'modpack' | string;
  title: string;
  description: string;
  body?: string;
  categories: string[];
  loaders?: string[];
  game_versions?: string[];
  downloads: number;
  followers: number;
  icon_url: string | null;
  license?: { id?: string; name?: string; url?: string | null } | null;
  source_url?: string | null;
  wiki_url?: string | null;
  issues_url?: string | null;
  updated?: string;
  published?: string;
}

export interface ModrinthVersionFile {
  url: string;
  filename: string;
  primary: boolean;
  size: number;
  file_type?: string | null;
}

export interface ModrinthVersionRecord {
  id: string;
  project_id: string;
  name: string;
  version_number: string;
  changelog?: string;
  date_published: string;
  downloads: number;
  version_type: 'release' | 'beta' | 'alpha' | string;
  game_versions: string[];
  loaders: string[];
  files: ModrinthVersionFile[];
}

export interface ModrinthSearchHistoryEntry {
  id: string;
  query: string;
  projectType: 'all' | 'mod' | 'modpack';
  loader: string;
  mcVersion: string;
  searchedAt: string;
}

export interface ParsedJarManifest {
  detected: boolean;
  sourceFile: string | null;
  name: string;
  versionNumber: string;
  loader: ModLoader;
  mcVersion: string;
  description: string;
  sha256: string;
  iconBlob: Blob | null;
  iconPreviewUrl: string | null;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  detail?: string;
}

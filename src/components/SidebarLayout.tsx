import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  LayoutDashboard,
  Package,
  FolderOpen,
  Star,
  Clock,
  Trash2,
  Compass,
  HardDrive,
  Settings,
  Upload,
  LogOut,
  Menu,
  X,
  Search,
  CheckCircle2,
  AlertCircle,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  Moon,
  ExternalLink,
} from 'lucide-react';
import type { DriveQuotaInfo, VaultPage, VaultTheme } from '../types/vault';
import { formatBytes } from '../lib/format';
import { resolveEffectiveDark } from '../lib/preferences';
import emblemImg from '../assets/images/vault_obsidian_emblem_1794588538953.jpg';
import { GoogleSignInButton } from './GoogleSignInButton';

interface SidebarLayoutProps {
  activePage: VaultPage;
  onNavigate: (page: VaultPage) => void;
  pageTitle: string;
  breadcrumb?: string;
  ownerEmail: string;
  onSignOut: () => void;
  globalSearch: string;
  onGlobalSearchChange: (value: string) => void;
  driveConnected: boolean;
  driveNeedsReconnect?: boolean;
  driveConnecting: boolean;
  driveEmail?: string | null;
  driveQuota: DriveQuotaInfo | null;
  driveError: string | null;
  onDismissDriveError: () => void;
  onConnectDrive: () => Promise<string | null>;
  sidebarCollapsed: boolean;
  onToggleSidebarCollapsed: () => void;
  theme: VaultTheme;
  onToggleTheme: () => void;
  compactDensity?: boolean;
  favoritesCount?: number;
  children: ReactNode;
}

interface NavItemDef {
  id: VaultPage;
  label: string;
  shortLabel: string;
  icon: typeof LayoutDashboard;
  subtitle?: string;
}

const PRIVATE_STORAGE_NAV: NavItemDef[] = [
  { id: 'dashboard', label: 'Dashboard', shortLabel: 'Home', icon: LayoutDashboard },
  { id: 'mods', label: 'My Mods', shortLabel: 'Mods', icon: Package },
  { id: 'files', label: 'File Manager', shortLabel: 'Files', icon: FolderOpen },
  { id: 'favorites', label: 'Favorites', shortLabel: 'Starred', icon: Star },
  { id: 'recent', label: 'Recent Files', shortLabel: 'Recent', icon: Clock },
  { id: 'trash', label: 'Trash', shortLabel: 'Trash', icon: Trash2 },
];

const DISCOVER_NAV: NavItemDef[] = [
  {
    id: 'modrinth',
    label: 'Modrinth Explorer',
    shortLabel: 'Discover',
    icon: Compass,
    subtitle: 'Public catalog',
  },
];

const SYSTEM_NAV: NavItemDef[] = [
  { id: 'drive', label: 'Google Drive', shortLabel: 'Drive', icon: HardDrive },
  { id: 'settings', label: 'Settings', shortLabel: 'Settings', icon: Settings },
];

const ALL_NAV_ITEMS: NavItemDef[] = [
  ...PRIVATE_STORAGE_NAV,
  ...DISCOVER_NAV,
  ...SYSTEM_NAV,
];

const MOBILE_QUICK_NAV: VaultPage[] = ['dashboard', 'mods', 'files', 'modrinth'];

export function SidebarLayout({
  activePage,
  onNavigate,
  pageTitle,
  breadcrumb,
  ownerEmail,
  onSignOut,
  globalSearch,
  onGlobalSearchChange,
  driveConnected,
  driveNeedsReconnect = false,
  driveConnecting,
  driveEmail = null,
  driveQuota,
  driveError,
  onDismissDriveError,
  onConnectDrive,
  sidebarCollapsed,
  onToggleSidebarCollapsed,
  theme,
  onToggleTheme,
  compactDensity = false,
  favoritesCount = 0,
  children,
}: SidebarLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const isDark = resolveEffectiveDark(theme);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        Boolean(target?.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (!isInput && e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'Escape' && mobileOpen) {
        setMobileOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen]);

  const handleSelectNav = (page: VaultPage) => {
    onNavigate(page);
    setMobileOpen(false);
  };

  // Show Drive notice banner only on Private Storage / System views, NEVER cluttering public Modrinth browsing
  const showDriveActionBanner =
    activePage !== 'modrinth' &&
    (!driveConnected || driveNeedsReconnect || Boolean(driveError));

  const renderNavButton = (
    item: NavItemDef,
    collapsed: boolean,
    variant: 'private' | 'discover' | 'system',
  ) => {
    const Icon = item.icon;
    const isActive =
      activePage === item.id ||
      (variant === 'private' &&
        ((activePage === 'mod-details' && item.id === 'mods') ||
          (activePage === 'categories' && item.id === 'mods')));

    if (variant === 'discover') {
      return (
        <button
          key={item.id}
          type="button"
          onClick={() => handleSelectNav(item.id)}
          title={collapsed ? `${item.label} (Public Catalog)` : undefined}
          aria-label={item.label}
          className={`vault-glow-ring w-full flex items-center rounded-xl text-sm font-medium transition-colors whitespace-nowrap min-h-[44px] ${
            collapsed ? 'justify-center px-2 py-2.5' : 'justify-between gap-2.5 px-3 py-2.5'
          } ${
            isActive
              ? 'bg-emerald-600/12 dark:bg-emerald-500/18 text-emerald-800 dark:text-emerald-200 border border-emerald-500/35 dark:border-emerald-400/40'
              : 'bg-slate-50 dark:bg-white/[0.03] text-slate-700 dark:text-[#CBD5E1] hover:text-emerald-800 dark:hover:text-emerald-200 hover:bg-emerald-500/8 dark:hover:bg-emerald-500/10 border border-slate-200/80 dark:border-white/8'
          }`}
        >
          <span className={`flex items-center ${collapsed ? '' : 'gap-2.5 min-w-0'}`}>
            <Icon
              className={`w-4 h-4 shrink-0 ${
                isActive
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-emerald-600/80 dark:text-emerald-400/80'
              }`}
              aria-hidden="true"
            />
            {!collapsed && (
              <span className="flex flex-col items-start min-w-0">
                <span className="truncate leading-tight">{item.label}</span>
                {item.subtitle && (
                  <span className="text-[10px] font-normal text-slate-500 dark:text-[#94A3B8] leading-tight mt-0.5">
                    {item.subtitle}
                  </span>
                )}
              </span>
            )}
          </span>
          {!collapsed && (
            <ExternalLink
              className="w-3.5 h-3.5 shrink-0 text-emerald-600/70 dark:text-emerald-400/70"
              aria-hidden="true"
            />
          )}
        </button>
      );
    }

    return (
      <button
        key={item.id}
        type="button"
        onClick={() => handleSelectNav(item.id)}
        title={collapsed ? item.label : undefined}
        aria-label={item.label}
        className={`vault-glow-ring w-full flex items-center rounded-lg text-sm font-medium transition-colors whitespace-nowrap min-h-[40px] ${
          collapsed ? 'justify-center px-2 py-2.5' : 'justify-between gap-2.5 px-3 py-2'
        } ${
          isActive
            ? 'bg-[#8B5CF6]/12 dark:bg-[#8B5CF6]/18 text-slate-950 dark:text-white border border-[#8B5CF6]/35 dark:border-[#8B5CF6]/45'
            : 'text-slate-600 dark:text-[#94A3B8] hover:text-slate-950 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 border border-transparent'
        }`}
      >
        <span className={`flex items-center ${collapsed ? '' : 'gap-2.5 min-w-0'}`}>
          <Icon
            className={`w-4 h-4 shrink-0 ${
              isActive
                ? item.id === 'drive' || item.id === 'files'
                  ? 'text-[#0891B2] dark:text-[#06B6D4]'
                  : 'text-[#7C3AED] dark:text-[#A78BFA]'
                : 'text-slate-400 dark:text-[#64748B]'
            }`}
            aria-hidden="true"
          />
          {!collapsed && <span className="truncate">{item.label}</span>}
        </span>
        {!collapsed && item.id === 'favorites' && favoritesCount > 0 && (
          <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-[#CBD5E1]">
            {favoritesCount}
          </span>
        )}
      </button>
    );
  };

  const renderSidebarContent = (isMobileDrawer = false) => {
    const collapsed = !isMobileDrawer && sidebarCollapsed;

    return (
      <div className="flex flex-col h-full">
        {/* Brand header */}
        <div
          className={`h-16 flex items-center border-b border-slate-200 dark:border-white/8 shrink-0 ${
            collapsed ? 'px-3 justify-center' : 'px-4 justify-between gap-2'
          }`}
        >
          <button
            type="button"
            onClick={() => handleSelectNav('dashboard')}
            className="flex items-center gap-2.5 min-w-0 text-left"
            title="MOD VAULT Dashboard"
          >
            <img
              src={emblemImg}
              alt="MOD VAULT emblem"
              referrerPolicy="no-referrer"
              className="w-8 h-8 rounded-lg object-cover border border-slate-200 dark:border-white/15 shrink-0"
            />
            {!collapsed && (
              <span className="font-display text-base font-bold tracking-tight text-slate-950 dark:text-white whitespace-nowrap truncate">
                MOD VAULT
              </span>
            )}
          </button>

          {!isMobileDrawer && !collapsed && (
            <button
              type="button"
              onClick={onToggleSidebarCollapsed}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              className="p-2 rounded-lg text-slate-500 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/8 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center shrink-0"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Grouped Navigation Sections */}
        <nav
          className="flex-1 px-2.5 py-3.5 space-y-5 overflow-y-auto"
          aria-label="Vault navigation"
        >
          {collapsed && !isMobileDrawer && (
            <button
              type="button"
              onClick={onToggleSidebarCollapsed}
              aria-label="Expand sidebar"
              title="Expand sidebar"
              className="vault-glow-ring w-full flex items-center justify-center p-2.5 rounded-lg text-slate-500 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/8 transition-colors min-h-[40px]"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          )}

          {/* Group 1: MY PRIVATE STORAGE */}
          <div className="space-y-1">
            {!collapsed ? (
              <p className="px-3 pb-1 text-[10px] font-semibold tracking-wider uppercase text-slate-400 dark:text-[#64748B]">
                My Private Storage
              </p>
            ) : (
              <div className="mx-2 border-t border-slate-200 dark:border-white/10 my-1" />
            )}
            {PRIVATE_STORAGE_NAV.map((item) => renderNavButton(item, collapsed, 'private'))}
          </div>

          {/* Group 2: DISCOVER (Visually separated external Modrinth catalog) */}
          <div className="space-y-1.5 pt-3 border-t border-slate-200 dark:border-white/8">
            {!collapsed && (
              <p className="px-3 pb-0.5 text-[10px] font-semibold tracking-wider uppercase text-emerald-700 dark:text-emerald-400">
                Discover
              </p>
            )}
            {DISCOVER_NAV.map((item) => renderNavButton(item, collapsed, 'discover'))}
          </div>

          {/* Group 3: SYSTEM */}
          <div className="space-y-1 pt-3 border-t border-slate-200 dark:border-white/8">
            {!collapsed && (
              <p className="px-3 pb-1 text-[10px] font-semibold tracking-wider uppercase text-slate-400 dark:text-[#64748B]">
                System
              </p>
            )}
            {SYSTEM_NAV.map((item) => renderNavButton(item, collapsed, 'system'))}
          </div>
        </nav>

        {/* Google Drive & Owner footer */}
        <div
          className={`border-t border-slate-200 dark:border-white/8 shrink-0 bg-slate-50/90 dark:bg-[#090B12]/70 ${
            collapsed ? 'p-2.5 space-y-2' : 'px-3.5 py-3.5 space-y-3'
          }`}
        >
          {collapsed ? (
            <>
              <button
                type="button"
                onClick={() => handleSelectNav('drive')}
                title={
                  driveConnected
                    ? `Google Drive Connected (${driveEmail || '5 TB'})`
                    : 'Connect Google Drive'
                }
                aria-label="Google Drive status"
                className="vault-glow-ring w-full flex items-center justify-center p-2.5 rounded-lg border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5 min-h-[40px]"
              >
                <HardDrive
                  className={`w-4 h-4 ${
                    driveConnected && !driveNeedsReconnect
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : driveNeedsReconnect
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-[#0891B2] dark:text-[#06B6D4]'
                  }`}
                />
              </button>
              <button
                type="button"
                onClick={onSignOut}
                title="Sign Out"
                aria-label="Sign Out"
                className="vault-glow-ring w-full flex items-center justify-center p-2.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-[#CBD5E1] hover:text-red-600 dark:hover:text-white hover:border-red-500/40 hover:bg-red-500/10 min-h-[40px]"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => handleSelectNav('drive')}
                    className="inline-flex items-center gap-1.5 font-medium text-slate-800 dark:text-[#E2E8F0] hover:text-slate-950 dark:hover:text-white"
                  >
                    <HardDrive
                      className={`w-3.5 h-3.5 ${
                        driveConnected && !driveNeedsReconnect
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : driveNeedsReconnect
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-[#0891B2] dark:text-[#06B6D4]'
                      }`}
                      aria-hidden="true"
                    />
                    Google Drive
                  </button>
                  <span
                    className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                      driveConnected && !driveNeedsReconnect
                        ? 'text-emerald-700 dark:text-emerald-300'
                        : driveNeedsReconnect
                          ? 'text-amber-700 dark:text-amber-300'
                          : 'text-[#0891B2] dark:text-[#06B6D4]'
                    }`}
                  >
                    {driveConnected && !driveNeedsReconnect ? (
                      <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                    ) : (
                      <AlertCircle className="w-3 h-3" aria-hidden="true" />
                    )}
                    {driveConnected
                      ? driveNeedsReconnect
                        ? 'Expiring'
                        : 'Connected'
                      : 'Offline'}
                  </span>
                </div>

                {driveConnected ? (
                  <div className="space-y-1">
                    {driveEmail && (
                      <p
                        className="text-[11px] font-mono text-slate-700 dark:text-[#CBD5E1] truncate"
                        title={driveEmail}
                      >
                        {driveEmail}
                      </p>
                    )}
                    {driveQuota && (
                      <p className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-[#94A3B8] truncate">
                        {formatBytes(driveQuota.usageBytes)} /{' '}
                        {driveQuota.limitBytes ? formatBytes(driveQuota.limitBytes) : '5 TB'}
                      </p>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={driveConnecting}
                    onClick={() => void onConnectDrive()}
                    className="vault-glow-ring w-full inline-flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold rounded-lg bg-slate-900 dark:bg-white text-white dark:text-[#1f1f1f] hover:bg-slate-800 dark:hover:bg-white/90 transition-colors min-h-[40px] disabled:opacity-60"
                  >
                    {driveConnecting && (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    )}
                    {driveConnecting
                      ? 'Connecting...'
                      : driveNeedsReconnect
                        ? 'Reconnect Drive'
                        : 'Connect Drive'}
                  </button>
                )}
              </div>

              <div className="pt-2.5 border-t border-slate-200 dark:border-white/8 space-y-2">
                <p
                  className="text-[11px] font-mono text-slate-500 dark:text-[#94A3B8] truncate"
                  title={ownerEmail}
                >
                  {ownerEmail}
                </p>
                <button
                  type="button"
                  onClick={onSignOut}
                  className="vault-glow-ring w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 text-slate-700 dark:text-[#CBD5E1] hover:text-red-700 dark:hover:text-white hover:border-red-500/40 hover:bg-red-500/10 transition-colors min-h-[40px] whitespace-nowrap"
                >
                  <LogOut className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  Sign Out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#090B12] text-slate-900 dark:text-[#F1F5F9] flex transition-colors duration-200">
      {/* Subtle ambient glow (more pronounced in dark mode, delicate ice tint in light mode) */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-48 left-1/4 w-[520px] h-[520px] rounded-full bg-[#8B5CF6]/6 dark:bg-[#8B5CF6]/8 blur-[140px]" />
        <div className="absolute -bottom-48 right-1/6 w-[460px] h-[460px] rounded-full bg-[#06B6D4]/6 dark:bg-[#06B6D4]/8 blur-[140px]" />
      </div>

      {/* Desktop persistent collapsible sidebar */}
      <aside
        className={`hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 z-30 bg-white/95 dark:bg-[#0D101B]/95 border-r border-slate-200 dark:border-white/8 backdrop-blur-xl transition-all duration-200 ${
          sidebarCollapsed ? 'lg:w-[72px]' : 'lg:w-64'
        }`}
      >
        {renderSidebarContent(false)}
      </aside>

      {/* Mobile slide-over drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/45 dark:bg-black/75 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative w-72 max-w-[85vw] bg-white dark:bg-[#0D101B] border-r border-slate-200 dark:border-white/10 h-full z-10">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation menu"
              className="absolute top-3 right-3 p-2 rounded-lg text-slate-500 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 min-h-[40px] min-w-[40px] flex items-center justify-center"
            >
              <X className="w-5 h-5" />
            </button>
            {renderSidebarContent(true)}
          </aside>
        </div>
      )}

      {/* Main viewport */}
      <div
        className={`flex-1 flex flex-col min-w-0 relative z-10 transition-all duration-200 ${
          sidebarCollapsed ? 'lg:pl-[72px]' : 'lg:pl-64'
        }`}
      >
        {/* Top bar */}
        <header className="sticky top-0 z-20 h-16 px-4 sm:px-6 lg:px-8 border-b border-slate-200 dark:border-white/8 bg-white/90 dark:bg-[#090B12]/85 backdrop-blur-md flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-700 dark:text-[#CBD5E1] hover:text-slate-950 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 min-h-[42px] min-w-[42px] flex items-center justify-center shrink-0"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              {breadcrumb ? (
                <div className="flex items-center gap-2 text-xs sm:text-sm text-slate-500 dark:text-[#94A3B8] truncate">
                  <span>{breadcrumb}</span>
                  <span aria-hidden="true">/</span>
                  <span className="text-slate-950 dark:text-white font-semibold truncate">
                    {pageTitle}
                  </span>
                </div>
              ) : (
                <h1 className="font-display text-base sm:text-lg font-semibold text-slate-950 dark:text-white truncate">
                  {pageTitle}
                </h1>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden md:flex items-center relative w-64 lg:w-72">
              <Search
                className="w-4 h-4 text-slate-400 dark:text-[#64748B] absolute left-3 pointer-events-none"
                aria-hidden="true"
              />
              <input
                ref={searchInputRef}
                type="text"
                value={globalSearch}
                onChange={(e) => {
                  onGlobalSearchChange(e.target.value);
                  if (
                    activePage !== 'mods' &&
                    activePage !== 'files' &&
                    activePage !== 'recent' &&
                    e.target.value.trim().length > 0
                  ) {
                    onNavigate('mods');
                  }
                }}
                placeholder={
                  activePage === 'files'
                    ? 'Search private files... (/)'
                    : 'Search private vault... (/)'
                }
                aria-label="Search my private vault"
                className="vault-glow-ring w-full pl-9 pr-8 py-2 text-xs rounded-lg bg-slate-100/80 dark:bg-[#151925] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-[#64748B] focus:border-[#8B5CF6]/60 min-h-[40px]"
              />
              {globalSearch && (
                <button
                  type="button"
                  onClick={() => onGlobalSearchChange('')}
                  aria-label="Clear private search"
                  className="absolute right-1.5 p-1 rounded text-slate-500 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={isDark ? 'Switch to Arctic White light theme' : 'Switch to Dark theme'}
              title={isDark ? 'Switch to Arctic White' : 'Switch to Dark mode'}
              className="vault-glow-ring p-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#151925] text-slate-700 dark:text-[#CBD5E1] hover:border-[#8B5CF6]/50 hover:text-slate-950 dark:hover:text-white transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center shrink-0"
            >
              {isDark ? (
                <Sun className="w-4 h-4 text-amber-400" aria-hidden="true" />
              ) : (
                <Moon className="w-4 h-4 text-[#7C3AED]" aria-hidden="true" />
              )}
            </button>

            {activePage !== 'upload' && (
              <button
                type="button"
                onClick={() => onNavigate('upload')}
                className="vault-glow-ring inline-flex items-center gap-2 px-3.5 sm:px-4 py-2 text-xs font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
              >
                <Upload className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span className="hidden sm:inline">Upload Center</span>
                <span className="sm:hidden">Upload</span>
              </button>
            )}
          </div>
        </header>

        <main
          className={`flex-1 pb-24 lg:pb-8 max-w-[1380px] w-full mx-auto ${
            compactDensity
              ? 'p-3 sm:p-4 lg:p-5 space-y-4'
              : 'p-4 sm:p-6 lg:p-8 space-y-6'
          }`}
        >
          {/* Guided Google Drive connection / reconnect banner */}
          {showDriveActionBanner && (
            <section
              aria-label="Google Drive connection notice"
              className={`vault-glass rounded-xl px-4 py-3.5 border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                driveError
                  ? 'border-red-300 dark:border-red-500/35 bg-red-50/70 dark:bg-red-500/8'
                  : driveNeedsReconnect
                    ? 'border-amber-300 dark:border-amber-500/35 bg-amber-50/70 dark:bg-amber-500/8'
                    : 'border-cyan-300 dark:border-[#06B6D4]/35 bg-cyan-50/70 dark:bg-[#06B6D4]/8'
              }`}
            >
              <div className="flex items-start sm:items-center gap-3 min-w-0">
                <div
                  className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                    driveError
                      ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                      : driveNeedsReconnect
                        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                        : 'bg-[#06B6D4]/15 text-[#0891B2] dark:text-[#06B6D4]'
                  }`}
                >
                  <HardDrive className="w-4 h-4" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white">
                    {driveError
                      ? 'Google Drive needs your attention'
                      : driveNeedsReconnect
                        ? 'Google Drive session expires soon'
                        : 'Connect your Google Drive to manage files'}
                  </p>
                  <p className="text-xs text-slate-600 dark:text-[#CBD5E1] mt-0.5 break-words">
                    {driveError
                      ? driveError
                      : driveNeedsReconnect
                        ? 'Reconnect with one click so uploads and downloads keep running without interruption.'
                        : 'Authorize Google Drive once to upload, preview, download, copy, rename, or move private files.'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <GoogleSignInButton
                  onClick={() => void onConnectDrive()}
                  disabled={driveConnecting}
                  label={
                    driveConnecting
                      ? 'Connecting...'
                      : driveConnected || driveNeedsReconnect
                        ? 'Reconnect Drive'
                        : 'Connect Google Drive'
                  }
                />
                {driveError && (
                  <button
                    type="button"
                    onClick={onDismissDriveError}
                    aria-label="Dismiss Drive notice"
                    className="p-2 rounded-lg text-slate-600 dark:text-[#CBD5E1] hover:text-slate-950 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-white/10 min-h-[40px] min-w-[40px] flex items-center justify-center"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </section>
          )}

          {children}
        </main>
      </div>

      {/* Compact Mobile bottom navigation (Home, Mods, Files, Discover, More) */}
      <nav
        aria-label="Quick mobile navigation"
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 h-16 px-2 bg-white/95 dark:bg-[#0D101B]/95 border-t border-slate-200 dark:border-white/10 backdrop-blur-xl grid grid-cols-5 items-center gap-1"
      >
        {MOBILE_QUICK_NAV.map((id) => {
          const item = ALL_NAV_ITEMS.find((n) => n.id === id)!;
          const Icon = item.icon;
          const isActive =
            activePage === item.id ||
            (activePage === 'mod-details' && item.id === 'mods');
          const isDiscover = item.id === 'modrinth';
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleSelectNav(item.id)}
              className={`flex flex-col items-center justify-center gap-1 rounded-lg py-1.5 min-h-[44px] text-[11px] font-medium transition-colors ${
                isActive
                  ? isDiscover
                    ? 'text-emerald-800 dark:text-emerald-200 bg-emerald-500/15'
                    : 'text-slate-950 dark:text-white bg-[#8B5CF6]/15 dark:bg-[#8B5CF6]/20'
                  : 'text-slate-600 dark:text-[#94A3B8] hover:text-slate-950 dark:hover:text-white'
              }`}
            >
              <Icon
                className={`w-4 h-4 ${
                  isActive
                    ? isDiscover
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-[#7C3AED] dark:text-[#A78BFA]'
                    : isDiscover
                      ? 'text-emerald-600/80 dark:text-emerald-400/80'
                      : 'text-slate-400 dark:text-[#64748B]'
                }`}
                aria-hidden="true"
              />
              <span>{item.shortLabel}</span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className={`flex flex-col items-center justify-center gap-1 rounded-lg py-1.5 min-h-[44px] text-[11px] font-medium transition-colors ${
            !MOBILE_QUICK_NAV.includes(activePage) && activePage !== 'mod-details'
              ? 'text-slate-950 dark:text-white bg-[#8B5CF6]/15 dark:bg-[#8B5CF6]/20'
              : 'text-slate-600 dark:text-[#94A3B8] hover:text-slate-950 dark:hover:text-white'
          }`}
        >
          <Menu className="w-4 h-4 text-[#0891B2] dark:text-[#06B6D4]" aria-hidden="true" />
          <span>More</span>
        </button>
      </nav>
    </div>
  );
}

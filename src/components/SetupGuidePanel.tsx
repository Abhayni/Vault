import { useState } from 'react';
import { Check, Copy, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import type { DriveQuotaInfo, VaultConfigStatus } from '../types/vault';
import {
  ENV_TEMPLATE,
  FREE_TIER_LIMITS,
  SUPABASE_SCHEMA_SQL,
} from '../lib/setup-snippets';
import { copyText, formatBytes } from '../lib/format';

interface SetupGuidePanelProps {
  config: VaultConfigStatus | null;
  driveConnected?: boolean;
  driveQuota?: DriveQuotaInfo | null;
  onRecheck?: () => Promise<void> | void;
  checking?: boolean;
}

type SetupTab = 'steps' | 'sql' | 'env' | 'limits';

export function SetupGuidePanel({
  config,
  driveConnected = false,
  driveQuota = null,
  onRecheck,
  checking = false,
}: SetupGuidePanelProps) {
  const [activeTab, setActiveTab] = useState<SetupTab>('steps');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (id: string, text: string) => {
    const ok = await copyText(text);
    if (ok) {
      setCopiedId(id);
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 2000);
    }
  };

  const checks = [
    {
      label: 'Owner Allowlist & Account',
      ok: Boolean(config?.ownerEmailConfigured && config?.ownerAccountReady !== false),
      detail: !config?.ownerEmailConfigured
        ? 'Missing OWNER_EMAIL environment variable'
        : config.ownerAccountReady === false
          ? `OWNER_EMAIL (${config.ownerEmailHint}) set, but no Auth user exists yet in Supabase`
          : `Locked to ${config.ownerEmailHint}`,
    },
    {
      label: 'Supabase Auth & PostgreSQL Schema',
      ok: Boolean(config?.supabaseConfigured && config?.schemaReady !== false),
      detail: !config?.supabaseConfigured
        ? 'Missing SUPABASE_URL or SUPABASE_ANON_KEY'
        : config.schemaReady === false
          ? 'Connected, but updated Google Drive columns in supabase/schema.sql are not applied yet'
          : 'SUPABASE_URL, SUPABASE_ANON_KEY, and Google Drive metadata columns detected',
    },
    {
      label: 'Google Drive Primary Storage (5 TB)',
      ok: driveConnected,
      detail: driveConnected
        ? driveQuota?.userEmail
          ? `Connected to ${driveQuota.userEmail} (${formatBytes(driveQuota.usageBytes)} / ${
              driveQuota.limitBytes ? formatBytes(driveQuota.limitBytes) : 'Unlimited'
            })`
          : 'Google Drive API v3 OAuth session active'
        : 'Ready via Google OAuth 2.0 (Sign in with Google inside the vault to connect your 5 TB Drive)',
    },
  ];

  const tabs: Array<{ id: SetupTab; label: string }> = [
    { id: 'steps', label: 'Deployment Steps' },
    { id: 'sql', label: 'Supabase Metadata SQL' },
    { id: 'env', label: '.env Template' },
    { id: 'limits', label: 'Storage Limits' },
  ];

  const snippetMap: Record<Exclude<SetupTab, 'steps' | 'limits'>, { title: string; code: string }> = {
    sql: {
      title:
        'Run in Supabase Dashboard -> SQL Editor (creates/upgrades Drive file ID columns and owner-only PostgreSQL RLS)',
      code: SUPABASE_SCHEMA_SQL,
    },
    env: {
      title:
        'Set in .env or server environment variables (never expose SUPABASE_SERVICE_ROLE_KEY in VITE_* vars)',
      code: ENV_TEMPLATE,
    },
  };

  return (
    <div className="space-y-6">
      {/* Live Diagnostics */}
      <div className="vault-glass rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              Cloud Infrastructure Readiness
            </h3>
            <p className="text-xs text-slate-500 dark:text-[#94A3B8] mt-0.5">
              Live check of Supabase Auth/PostgreSQL metadata and Google Drive v3 storage without exposing secret keys.
            </p>
          </div>
          {onRecheck && (
            <button
              type="button"
              onClick={onRecheck}
              disabled={checking}
              className="vault-glow-ring inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#161924] text-slate-800 dark:text-white hover:border-[#8B5CF6]/50 transition-colors whitespace-nowrap shrink-0 min-h-[40px] disabled:opacity-60"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              {checking ? 'Checking...' : 'Re-check Environment'}
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {checks.map((item) => (
            <div
              key={item.label}
              className="rounded-lg border border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-[#0B0D13] p-3.5"
            >
              <div className="flex items-center gap-2">
                {item.ok ? (
                  <CheckCircle2
                    className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0"
                    aria-hidden="true"
                  />
                ) : (
                  <AlertTriangle
                    className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0"
                    aria-hidden="true"
                  />
                )}
                <span className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                  {item.label}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-[#94A3B8] mt-1.5 leading-relaxed">
                {item.detail}
              </p>
            </div>
          ))}
        </div>

        {config && config.missingKeys.length > 0 && (
          <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-200">
            <span className="font-semibold">Missing server variables:</span>{' '}
            <span className="font-mono">{config.missingKeys.join(', ')}</span>
          </div>
        )}
      </div>

      {/* Tabbed Setup & Reference */}
      <div className="vault-glass rounded-xl overflow-hidden">
        <div className="border-b border-slate-200 dark:border-white/8 px-4 py-3 flex items-center gap-2 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-3.5 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[38px] ${
                activeTab === tab.id
                  ? 'bg-[#8B5CF6] text-white'
                  : 'text-slate-500 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-5">
          {activeTab === 'steps' && (
            <ol className="space-y-3 text-sm text-slate-600 dark:text-[#CBD5E1]">
              <li className="rounded-lg border border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-[#0B0D13] p-3.5">
                <span className="font-semibold text-slate-900 dark:text-white">1. Supabase Auth &amp; Owner User:</span>{' '}
                Under Supabase Authentication -&gt; Providers -&gt; Email, disable public Sign Ups and verify your single owner account (<code className="font-mono text-xs text-[#7C3AED] dark:text-[#A78BFA]">{config?.ownerEmailHint || 'OWNER_EMAIL'}</code>) exists with Auto Confirm enabled.
              </li>
              <li className="rounded-lg border border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-[#0B0D13] p-3.5">
                <span className="font-semibold text-slate-900 dark:text-white">2. Metadata Schema Migration:</span>{' '}
                Run the SQL script from the <span className="font-medium text-slate-900 dark:text-white">Supabase Metadata SQL</span> tab in Supabase SQL Editor. It adds <code className="font-mono text-xs text-[#7C3AED] dark:text-[#A78BFA]">drive_file_id</code>, <code className="font-mono text-xs text-[#7C3AED] dark:text-[#A78BFA]">drive_folder_id</code>, and <code className="font-mono text-xs text-[#7C3AED] dark:text-[#A78BFA]">drive_parent_id</code> columns with owner-only RLS.
              </li>
              <li className="rounded-lg border border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-[#0B0D13] p-3.5">
                <span className="font-semibold text-slate-900 dark:text-white">3. Connect Google Drive (5 TB):</span>{' '}
                Sign into the vault and click <span className="font-medium text-slate-900 dark:text-white">Sign in with Google</span> to authorize private access for MOD VAULT. Files are uploaded via resumable chunked transfers to a private <code className="font-mono text-xs text-[#7C3AED] dark:text-[#A78BFA]">MOD VAULT</code> folder in your Drive.
              </li>
              <li className="rounded-lg border border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-[#0B0D13] p-3.5">
                <span className="font-semibold text-slate-900 dark:text-white">4. Build &amp; Run 24/7:</span>{' '}
                Build with <code className="font-mono text-xs">npm run build</code> and start Express with <code className="font-mono text-xs">npm start</code> (<code className="font-mono text-xs">node server.ts</code>).
              </li>
            </ol>
          )}

          {(activeTab === 'sql' || activeTab === 'env') && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-slate-500 dark:text-[#94A3B8]">{snippetMap[activeTab].title}</p>
                <button
                  type="button"
                  onClick={() => handleCopy(activeTab, snippetMap[activeTab].code)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#161924] text-slate-800 dark:text-white hover:border-[#8B5CF6]/50 transition-colors whitespace-nowrap shrink-0"
                >
                  {copiedId === activeTab ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                      Copy Snippet
                    </>
                  )}
                </button>
              </div>
              <pre className="rounded-lg border border-slate-200 dark:border-white/8 bg-[#0F172A] dark:bg-[#06070A] p-4 text-xs font-mono text-slate-100 dark:text-[#E2E8F0] overflow-x-auto max-h-96 leading-relaxed">
                <code>{snippetMap[activeTab].code}</code>
              </pre>
            </div>
          )}

          {activeTab === 'limits' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500 dark:text-[#94A3B8]">
                Transparent summary of Google Drive primary storage and Supabase PostgreSQL metadata capacities.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-white/10 text-slate-500 dark:text-[#94A3B8]">
                      <th className="py-2.5 pr-4 font-semibold">Service</th>
                      <th className="py-2.5 pr-4 font-semibold">Allowance</th>
                      <th className="py-2.5 pr-4 font-semibold">Limitations</th>
                      <th className="py-2.5 font-semibold">Notes / Charges</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-white/6 text-slate-700 dark:text-[#E2E8F0]">
                    {FREE_TIER_LIMITS.map((row) => (
                      <tr key={row.service}>
                        <td className="py-3 pr-4 font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                          {row.service}
                        </td>
                        <td className="py-3 pr-4">{row.allowance}</td>
                        <td className="py-3 pr-4 text-slate-500 dark:text-[#94A3B8]">{row.limitations}</td>
                        <td className="py-3 font-mono text-[11px] text-slate-600 dark:text-[#CBD5E1]">
                          {row.charges}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

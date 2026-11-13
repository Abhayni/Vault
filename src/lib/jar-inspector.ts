import JSZip from 'jszip';
import { parse as parseToml } from 'smol-toml';
import type { ModLoader, ParsedJarManifest } from '../types/vault';

async function computeSha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(hash);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function cleanMcVersion(raw: unknown): string {
  if (typeof raw === 'string') {
    const match = raw.match(/1\.\d+(?:\.\d+)?/);
    return match ? match[0] : raw.replace(/[\[\]()>=~^*,\s]/g, '').slice(0, 24) || '1.21.1';
  }
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string') {
        const match = item.match(/1\.\d+(?:\.\d+)?/);
        if (match) return match[0];
      }
    }
  }
  return '1.21.1';
}

function guessNameFromFilename(fileName: string): string {
  return fileName
    .replace(/\.jar$/i, '')
    .replace(/[-_](mc)?\d+\.\d+(\.\d+)?/gi, '')
    .replace(/[-_](fabric|forge|neoforge|quilt)/gi, '')
    .replace(/[-_]+v?\d+(\.\d+)*.*$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();
}

function guessVersionFromFilename(fileName: string): string {
  const base = fileName.replace(/\.jar$/i, '');
  const match = base.match(/[-_+v](\d+\.\d+(?:\.\d+)?(?:[-+][a-zA-Z0-9.]+)?)$/);
  return match ? match[1] : '1.0.0';
}

async function extractIconBlob(
  zip: JSZip,
  iconPath: string | undefined,
): Promise<{ blob: Blob | null; url: string | null }> {
  if (!iconPath) return { blob: null, url: null };
  const cleanPath = iconPath.replace(/^\/+/, '');
  const entry = zip.file(cleanPath);
  if (!entry) return { blob: null, url: null };
  try {
    const data = await entry.async('blob');
    const mime = cleanPath.toLowerCase().endsWith('.jpg') ? 'image/jpeg' : 'image/png';
    const typedBlob = new Blob([data], { type: mime });
    return { blob: typedBlob, url: URL.createObjectURL(typedBlob) };
  } catch {
    return { blob: null, url: null };
  }
}

export async function inspectJarFile(file: File): Promise<ParsedJarManifest> {
  const buffer = await file.arrayBuffer();
  const sha256 = await computeSha256Hex(buffer);

  const fallback: ParsedJarManifest = {
    detected: false,
    sourceFile: null,
    name: guessNameFromFilename(file.name) || file.name.replace(/\.jar$/i, ''),
    versionNumber: guessVersionFromFilename(file.name),
    loader: 'Fabric',
    mcVersion: '1.21.1',
    description: '',
    sha256,
    iconBlob: null,
    iconPreviewUrl: null,
  };

  try {
    const zip = await JSZip.loadAsync(buffer);

    // 1. Fabric: fabric.mod.json
    const fabricEntry = zip.file('fabric.mod.json');
    if (fabricEntry) {
      const raw = await fabricEntry.async('string');
      const json = JSON.parse(raw) as {
        name?: string;
        id?: string;
        version?: string;
        description?: string;
        icon?: string | Record<string, string>;
        depends?: Record<string, unknown>;
      };

      let iconPath: string | undefined;
      if (typeof json.icon === 'string') {
        iconPath = json.icon;
      } else if (json.icon && typeof json.icon === 'object') {
        const values = Object.values(json.icon);
        iconPath = values[values.length - 1];
      }
      const icon = await extractIconBlob(zip, iconPath);

      return {
        detected: true,
        sourceFile: 'fabric.mod.json',
        name: (json.name || json.id || fallback.name).trim(),
        versionNumber: (json.version && !json.version.includes('${') ? json.version : fallback.versionNumber).trim(),
        loader: 'Fabric',
        mcVersion: cleanMcVersion(json.depends?.minecraft),
        description: (json.description || '').trim(),
        sha256,
        iconBlob: icon.blob,
        iconPreviewUrl: icon.url,
      };
    }

    // 2. NeoForge: META-INF/neoforge.mods.toml
    const neoforgeEntry = zip.file('META-INF/neoforge.mods.toml');
    if (neoforgeEntry) {
      const raw = await neoforgeEntry.async('string');
      const toml = parseToml(raw) as {
        mods?: Array<{
          modId?: string;
          displayName?: string;
          version?: string;
          description?: string;
          logoFile?: string;
        }>;
        dependencies?: Record<string, Array<{ modId?: string; versionRange?: string }>>;
      };
      const modMeta = toml.mods?.[0];
      const modId = modMeta?.modId || '';
      const deps = (modId && toml.dependencies?.[modId]) || [];
      const mcDep = deps.find((d) => d.modId === 'minecraft');
      const icon = await extractIconBlob(zip, modMeta?.logoFile);

      return {
        detected: true,
        sourceFile: 'META-INF/neoforge.mods.toml',
        name: (modMeta?.displayName || modMeta?.modId || fallback.name).trim(),
        versionNumber:
          modMeta?.version && !modMeta.version.includes('${')
            ? modMeta.version.trim()
            : fallback.versionNumber,
        loader: 'NeoForge',
        mcVersion: cleanMcVersion(mcDep?.versionRange),
        description: (modMeta?.description || '').trim(),
        sha256,
        iconBlob: icon.blob,
        iconPreviewUrl: icon.url,
      };
    }

    // 3. Forge: META-INF/mods.toml
    const forgeEntry = zip.file('META-INF/mods.toml');
    if (forgeEntry) {
      const raw = await forgeEntry.async('string');
      const toml = parseToml(raw) as {
        mods?: Array<{
          modId?: string;
          displayName?: string;
          version?: string;
          description?: string;
          logoFile?: string;
        }>;
        dependencies?: Record<string, Array<{ modId?: string; versionRange?: string }>>;
      };
      const modMeta = toml.mods?.[0];
      const modId = modMeta?.modId || '';
      const deps = (modId && toml.dependencies?.[modId]) || [];
      const mcDep = deps.find((d) => d.modId === 'minecraft');
      const icon = await extractIconBlob(zip, modMeta?.logoFile);

      return {
        detected: true,
        sourceFile: 'META-INF/mods.toml',
        name: (modMeta?.displayName || modMeta?.modId || fallback.name).trim(),
        versionNumber:
          modMeta?.version && !modMeta.version.includes('${')
            ? modMeta.version.trim()
            : fallback.versionNumber,
        loader: 'Forge',
        mcVersion: cleanMcVersion(mcDep?.versionRange),
        description: (modMeta?.description || '').trim(),
        sha256,
        iconBlob: icon.blob,
        iconPreviewUrl: icon.url,
      };
    }

    // 4. Quilt: quilt.mod.json
    const quiltEntry = zip.file('quilt.mod.json');
    if (quiltEntry) {
      const raw = await quiltEntry.async('string');
      const json = JSON.parse(raw) as {
        quilt_loader?: {
          id?: string;
          version?: string;
          metadata?: { name?: string; description?: string; icon?: string };
          depends?: Array<{ id?: string; versions?: unknown }>;
        };
      };
      const q = json.quilt_loader;
      const mcDep = q?.depends?.find((d) => d.id === 'minecraft');
      const icon = await extractIconBlob(zip, q?.metadata?.icon);

      return {
        detected: true,
        sourceFile: 'quilt.mod.json',
        name: (q?.metadata?.name || q?.id || fallback.name).trim(),
        versionNumber: (q?.version || fallback.versionNumber).trim(),
        loader: 'Quilt',
        mcVersion: cleanMcVersion(mcDep?.versions),
        description: (q?.metadata?.description || '').trim(),
        sha256,
        iconBlob: icon.blob,
        iconPreviewUrl: icon.url,
      };
    }

    // 5. Legacy Forge: mcmod.info
    const mcmodEntry = zip.file('mcmod.info');
    if (mcmodEntry) {
      const raw = await mcmodEntry.async('string');
      const parsed = JSON.parse(raw) as
        | Array<{ name?: string; version?: string; mcversion?: string; description?: string; logoFile?: string }>
        | { modList?: Array<{ name?: string; version?: string; mcversion?: string; description?: string; logoFile?: string }> };
      const list = Array.isArray(parsed) ? parsed : parsed.modList || [];
      const first = list[0];
      if (first) {
        const icon = await extractIconBlob(zip, first.logoFile);
        return {
          detected: true,
          sourceFile: 'mcmod.info',
          name: (first.name || fallback.name).trim(),
          versionNumber: (first.version || fallback.versionNumber).trim(),
          loader: 'Forge' as ModLoader,
          mcVersion: cleanMcVersion(first.mcversion),
          description: (first.description || '').trim(),
          sha256,
          iconBlob: icon.blob,
          iconPreviewUrl: icon.url,
        };
      }
    }
  } catch {
    // Graceful fallback if manifest is malformed or missing
  }

  return fallback;
}

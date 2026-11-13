import { useEffect, useState, type FormEvent } from 'react';
import { X, Upload, Loader2 } from 'lucide-react';
import type { Category, ModLoader, ModRecord, UploadAuthorization } from '../types/vault';
import { apiRequest, uploadToGoogleDriveResumable } from '../lib/supabase';

interface ModFormModalProps {
  mod: ModRecord;
  categories: Category[];
  accessToken: string;
  driveConnected: boolean;
  googleDriveToken: string | null;
  onEnsureDriveConnected: () => Promise<boolean>;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  onNotify: (type: 'success' | 'error', title: string, detail?: string) => void;
}

const LOADERS: ModLoader[] = ['Fabric', 'Forge', 'NeoForge', 'Quilt'];

export function ModFormModal({
  mod,
  categories,
  accessToken,
  driveConnected,
  googleDriveToken,
  onEnsureDriveConnected,
  onClose,
  onSaved,
  onNotify,
}: ModFormModalProps) {
  const [name, setName] = useState(mod.name);
  const [description, setDescription] = useState(mod.description);
  const [categoryId, setCategoryId] = useState<string>(mod.category_id || '');
  const [loader, setLoader] = useState<ModLoader>(mod.loader);
  const [latestMcVersion, setLatestMcVersion] = useState(mod.latest_mc_version);
  const [thumbFile, setThumbFile] = useState<File | null>(null);
  const [removeThumb, setRemoveThumb] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saving, onClose]);

  const hasThumb = Boolean(mod.thumbnail_drive_id || mod.thumbnail_key);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);

    try {
      const needsDrive = Boolean(thumbFile || (removeThumb && mod.thumbnail_drive_id));
      if (needsDrive && !driveConnected && !googleDriveToken) {
        const ready = await onEnsureDriveConnected();
        if (!ready) {
          throw new Error('Connect Google Drive to update or remove mod thumbnails.');
        }
      }

      let nextThumbDriveId: string | null | undefined = undefined;
      if (removeThumb) {
        nextThumbDriveId = null;
      } else if (thumbFile) {
        const authz = await apiRequest<UploadAuthorization>(
          '/api/uploads/authorize',
          accessToken,
          {
            method: 'POST',
            body: JSON.stringify({
              kind: 'thumbnail',
              fileName: thumbFile.name,
              mimeType: thumbFile.type || 'image/png',
              fileSizeBytes: thumbFile.size,
            }),
          },
          googleDriveToken,
        );
        const uploaded = await uploadToGoogleDriveResumable({
          authz,
          file: thumbFile,
          contentType: thumbFile.type || 'image/png',
          accessToken,
          onProgress: () => undefined,
        });
        nextThumbDriveId = uploaded.driveFileId;
      }

      await apiRequest(
        `/api/mods/${encodeURIComponent(mod.id)}`,
        accessToken,
        {
          method: 'PATCH',
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim(),
            categoryId: categoryId || null,
            loader,
            latestMcVersion: latestMcVersion.trim(),
            ...(nextThumbDriveId !== undefined ? { thumbnailDriveId: nextThumbDriveId } : {}),
          }),
        },
        googleDriveToken,
      );

      onNotify('success', 'Mod updated', `${name.trim()} saved.`);
      await onSaved();
      onClose();
    } catch (err) {
      onNotify(
        'error',
        'Update failed',
        err instanceof Error ? err.message : 'Unable to save details.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 dark:bg-black/75 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-mod-title"
        className="vault-glass w-full max-w-lg rounded-xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-slate-200 dark:border-white/8 flex items-center justify-between gap-3">
          <h2 id="edit-mod-title" className="text-base font-semibold text-slate-900 dark:text-white">
            Edit Mod Details
          </h2>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            aria-label="Close modal"
            className="p-2 rounded-lg text-slate-500 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 min-h-[40px] min-w-[40px] flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label htmlFor="edit-mod-name" className="block text-xs font-medium text-slate-700 dark:text-[#CBD5E1] mb-1.5">
              Mod Name
            </label>
            <input
              id="edit-mod-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="vault-glow-ring w-full px-3.5 py-2.5 text-sm rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="edit-mod-loader" className="block text-xs font-medium text-slate-700 dark:text-[#CBD5E1] mb-1.5">
                Mod Loader
              </label>
              <select
                id="edit-mod-loader"
                value={loader}
                onChange={(e) => setLoader(e.target.value as ModLoader)}
                className="vault-glow-ring w-full px-3.5 py-2.5 text-sm rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white"
              >
                {LOADERS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="edit-mod-mc" className="block text-xs font-medium text-slate-700 dark:text-[#CBD5E1] mb-1.5">
                Minecraft Version
              </label>
              <input
                id="edit-mod-mc"
                type="text"
                required
                value={latestMcVersion}
                onChange={(e) => setLatestMcVersion(e.target.value)}
                className="vault-glow-ring w-full px-3.5 py-2.5 text-sm font-mono rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white"
              />
            </div>
          </div>

          <div>
            <label htmlFor="edit-mod-cat" className="block text-xs font-medium text-slate-700 dark:text-[#CBD5E1] mb-1.5">
              Category
            </label>
            <select
              id="edit-mod-cat"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="vault-glow-ring w-full px-3.5 py-2.5 text-sm rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white"
            >
              <option value="">Uncategorized</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="edit-mod-desc" className="block text-xs font-medium text-slate-700 dark:text-[#CBD5E1] mb-1.5">
              Notes / Description
            </label>
            <textarea
              id="edit-mod-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="vault-glow-ring w-full px-3.5 py-2.5 text-sm rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white resize-y"
            />
          </div>

          <div>
            <span className="block text-xs font-medium text-slate-700 dark:text-[#CBD5E1] mb-1.5">
              Mod Icon (Optional)
            </span>
            <div className="flex flex-wrap items-center gap-3">
              <label className="cursor-pointer inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#161924] text-slate-800 dark:text-white hover:border-[#8B5CF6]/50 transition-colors min-h-[40px]">
                <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                {thumbFile ? thumbFile.name : 'Choose PNG / JPG / WebP'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    setThumbFile(file);
                    if (file) setRemoveThumb(false);
                  }}
                />
              </label>
              {hasThumb && !removeThumb && !thumbFile && (
                <button
                  type="button"
                  onClick={() => setRemoveThumb(true)}
                  className="px-2 py-2 text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 min-h-[40px]"
                >
                  Remove current icon
                </button>
              )}
              {removeThumb && (
                <span className="text-xs text-amber-700 dark:text-amber-300">Icon will be removed when you save.</span>
              )}
            </div>
          </div>

          <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-200 dark:border-white/8">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 text-slate-700 dark:text-[#CBD5E1] hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 min-h-[40px] whitespace-nowrap"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="vault-glow-ring inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white transition-colors min-h-[40px] whitespace-nowrap disabled:opacity-60"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

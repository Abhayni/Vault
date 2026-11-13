import { useState, type FormEvent } from 'react';
import { FolderPlus, Pencil, Trash2, ArrowRight, Loader2, FolderKanban } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Category, ModRecord, ModVersion } from '../types/vault';
import { formatBytes, slugify } from '../lib/format';

interface CategoriesPageProps {
  categories: Category[];
  mods: ModRecord[];
  versions: ModVersion[];
  supabase: SupabaseClient;
  userId: string;
  onRefresh: () => Promise<void>;
  onOpenCategoryMods: (categoryId: string) => void;
  onNotify: (type: 'success' | 'error', title: string, detail?: string) => void;
}

const ACCENT_PRESETS = ['#8B5CF6', '#06B6D4', '#10B981', '#F59E0B', '#EC4899'];

export function CategoriesPage({
  categories,
  mods,
  versions,
  supabase,
  userId,
  onRefresh,
  onOpenCategoryMods,
  onNotify,
}: CategoriesPageProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [accentColor, setAccentColor] = useState('#8B5CF6');
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setDescription('');
    setAccentColor('#8B5CF6');
  };

  const handleEditClick = (cat: Category) => {
    setEditingId(cat.id);
    setName(cat.name);
    setDescription(cat.description);
    setAccentColor(cat.accent_color || '#8B5CF6');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);

    try {
      if (editingId) {
        const { error } = await supabase
          .from('categories')
          .update({
            name: name.trim(),
            description: description.trim(),
            accent_color: accentColor,
          })
          .eq('id', editingId)
          .eq('owner_id', userId);
        if (error) throw error;
        onNotify('success', 'Category updated', name.trim());
      } else {
        const uniqueSlug = `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`;
        const { error } = await supabase.from('categories').insert({
          owner_id: userId,
          name: name.trim(),
          slug: uniqueSlug,
          description: description.trim(),
          accent_color: accentColor,
        });
        if (error) throw error;
        onNotify('success', 'Category created', name.trim());
      }
      resetForm();
      await onRefresh();
    } catch (err) {
      onNotify(
        'error',
        'Category error',
        err instanceof Error ? err.message : 'Unable to save category.',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (cat: Category) => {
    try {
      const { error } = await supabase
        .from('categories')
        .delete()
        .eq('id', cat.id)
        .eq('owner_id', userId);
      if (error) throw error;
      setConfirmDeleteId(null);
      if (editingId === cat.id) resetForm();
      onNotify('success', 'Category removed', `${cat.name} deleted (mods kept as uncategorized).`);
      await onRefresh();
    } catch (err) {
      onNotify(
        'error',
        'Delete failed',
        err instanceof Error ? err.message : 'Unable to delete category.',
      );
    }
  };

  const getCategoryStats = (catId: string) => {
    const catMods = mods.filter((m) => m.category_id === catId);
    const modIds = new Set(catMods.map((m) => m.id));
    const catBytes = versions
      .filter((v) => modIds.has(v.mod_id))
      .reduce((sum, v) => sum + (Number(v.file_size_bytes) || 0), 0);
    return { modCount: catMods.length, totalBytes: catBytes };
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left: Create / Edit Category Form */}
      <form
        onSubmit={handleSubmit}
        className="lg:col-span-4 vault-glass rounded-xl p-5 space-y-4"
      >
        <div className="flex items-center gap-2">
          <FolderPlus className="w-4 h-4 text-[#7C3AED] dark:text-[#A78BFA]" aria-hidden="true" />
          <h2 className="text-base font-semibold text-slate-950 dark:text-white">
            {editingId ? 'Edit Category' : 'Create Category'}
          </h2>
        </div>

        <div>
          <label htmlFor="cat-name" className="block text-xs font-medium text-slate-700 dark:text-[#CBD5E1] mb-1.5">
            Category Name
          </label>
          <input
            id="cat-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Performance, Shaders, Magic"
            className="vault-glow-ring w-full px-3.5 py-2.5 text-sm rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-[#64748B]"
          />
        </div>

        <div>
          <label htmlFor="cat-desc" className="block text-xs font-medium text-slate-700 dark:text-[#CBD5E1] mb-1.5">
            Notes (Optional)
          </label>
          <textarea
            id="cat-desc"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What kind of mods belong here?"
            className="vault-glow-ring w-full px-3.5 py-2.5 text-sm rounded-lg bg-slate-50 dark:bg-[#090B12] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-[#64748B] resize-y"
          />
        </div>

        <div>
          <span className="block text-xs font-medium text-slate-700 dark:text-[#CBD5E1] mb-2">
            Color Tag
          </span>
          <div className="flex items-center gap-3">
            {ACCENT_PRESETS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => setAccentColor(color)}
                aria-label={`Select color ${color}`}
                className={`w-8 h-8 rounded-lg transition-transform ${
                  accentColor === color
                    ? 'ring-2 ring-slate-900 dark:ring-white ring-offset-2 ring-offset-white dark:ring-offset-[#151925] scale-110'
                    : 'opacity-75 hover:opacity-100'
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>

        <div className="pt-2 flex items-center gap-2">
          <button
            type="submit"
            disabled={saving}
            className="vault-glow-ring flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white transition-colors min-h-[40px] disabled:opacity-60"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
            {editingId ? 'Save Changes' : 'Create Category'}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 text-slate-700 dark:text-[#CBD5E1] hover:text-slate-950 dark:hover:text-white min-h-[40px]"
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      {/* Right: Categories List */}
      <div className="lg:col-span-8 space-y-4">
        {categories.length === 0 ? (
          <div className="vault-glass rounded-xl p-10 text-center space-y-3">
            <div className="w-12 h-12 rounded-xl bg-[#8B5CF6]/12 dark:bg-[#8B5CF6]/15 border border-[#8B5CF6]/30 mx-auto flex items-center justify-center">
              <FolderKanban className="w-6 h-6 text-[#7C3AED] dark:text-[#A78BFA]" aria-hidden="true" />
            </div>
            <h3 className="text-base font-semibold text-slate-950 dark:text-white">
              No categories yet
            </h3>
            <p className="text-xs text-slate-500 dark:text-[#94A3B8] max-w-sm mx-auto">
              Create groups like Performance, Shaders, Tech, or Utility to keep your mods neatly organized.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {categories.map((cat) => {
              const stats = getCategoryStats(cat.id);
              const isConfirming = confirmDeleteId === cat.id;
              return (
                <div
                  key={cat.id}
                  className="vault-glass rounded-xl p-5 flex flex-col justify-between gap-4"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0 pt-1">
                        <span
                          className="w-3 h-3 rounded-sm shrink-0"
                          style={{ backgroundColor: cat.accent_color || '#8B5CF6' }}
                          aria-hidden="true"
                        />
                        <h3 className="text-base font-semibold text-slate-950 dark:text-white truncate">
                          {cat.name}
                        </h3>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {isConfirming ? (
                          <>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-white/10 text-slate-700 dark:text-[#CBD5E1] hover:text-slate-950 dark:hover:text-white min-h-[36px]"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDelete(cat)}
                              className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-500 text-white min-h-[36px]"
                            >
                              Delete
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => handleEditClick(cat)}
                              aria-label={`Edit ${cat.name}`}
                              className="p-2 rounded-lg text-slate-400 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 min-h-[40px] min-w-[40px] flex items-center justify-center"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(cat.id)}
                              aria-label={`Delete ${cat.name}`}
                              className="p-2 rounded-lg text-slate-400 dark:text-[#94A3B8] hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-white/10 min-h-[40px] min-w-[40px] flex items-center justify-center"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    <p className="text-xs text-slate-500 dark:text-[#94A3B8] leading-relaxed min-h-[32px]">
                      {cat.description || 'No notes added.'}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-slate-200 dark:border-white/8 flex items-center justify-between text-xs">
                    <span className="font-mono tabular-nums text-slate-600 dark:text-[#CBD5E1]">
                      {stats.modCount} mod{stats.modCount === 1 ? '' : 's'} · {formatBytes(stats.totalBytes)}
                    </span>
                    <button
                      type="button"
                      onClick={() => onOpenCategoryMods(cat.id)}
                      className="inline-flex items-center gap-1 text-[#7C3AED] dark:text-[#A78BFA] hover:text-slate-950 dark:hover:text-white transition-colors py-1"
                    >
                      View Mods
                      <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

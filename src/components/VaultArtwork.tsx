import { useState } from 'react';
import { Box } from 'lucide-react';
import defaultEmblem from '../assets/images/vault_obsidian_emblem_1794588538953.jpg';

interface VaultArtworkProps {
  src?: string | null;
  alt: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function VaultArtwork({
  src,
  alt,
  size = 'md',
  className = '',
}: VaultArtworkProps) {
  const [failed, setFailed] = useState(false);

  const dims =
    size === 'sm'
      ? 'w-10 h-10 rounded-lg'
      : size === 'lg'
        ? 'w-24 h-24 rounded-xl'
        : 'w-12 h-12 rounded-lg';

  const resolvedSrc = !failed ? src || defaultEmblem : null;

  return (
    <div
      className={`${dims} shrink-0 overflow-hidden border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-[#141724] flex items-center justify-center ${className}`}
    >
      {resolvedSrc ? (
        <img
          src={resolvedSrc}
          alt={alt}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full bg-gradient-to-br from-[#8B5CF6]/15 to-[#3B82F6]/15 flex items-center justify-center">
          <Box className="w-5 h-5 text-[#7C3AED] dark:text-[#A78BFA]" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

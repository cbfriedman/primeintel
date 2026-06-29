'use client';

import { useState } from 'react';
import { Bookmark } from 'lucide-react';
import { clsx } from 'clsx';

export function BookmarkButton({
  bidId,
  isSaved: initialSaved,
}: {
  bidId: string;
  isSaved: boolean;
}) {
  const [saved, setSaved] = useState(initialSaved);
  const [loading, setLoading] = useState(false);

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (loading) return;

    setSaved((v) => !v);
    setLoading(true);

    try {
      const res = await fetch('/api/saved-bids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bid_id: bidId, action: saved ? 'unsave' : 'save' }),
      });
      const data = await res.json();
      if (!data.ok) setSaved((v) => !v); // revert on error
    } catch {
      setSaved((v) => !v); // revert on network error
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      title={saved ? 'Remove bookmark' : 'Save bid'}
      className={clsx(
        'transition-colors disabled:opacity-50',
        saved
          ? 'text-zinc-900 hover:text-zinc-500'
          : 'text-zinc-300 hover:text-zinc-600',
      )}
    >
      <Bookmark
        className="h-4 w-4"
        fill={saved ? 'currentColor' : 'none'}
      />
    </button>
  );
}

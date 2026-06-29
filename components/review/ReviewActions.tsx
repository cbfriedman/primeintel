'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { ManualReviewStatus } from '@/types/extraction';

export function ReviewActions({
  reviewId,
  currentStatus,
  existingNotes,
}: {
  reviewId: string;
  currentStatus: ManualReviewStatus;
  existingNotes: string | null;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(existingNotes ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reviews/${reviewId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? 'Request failed');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-6 space-y-4">
      <h2 className="text-sm font-semibold text-zinc-900">Reviewer Actions</h2>

      {currentStatus === 'open' && (
        <div className="flex items-center gap-3">
          <Button
            onClick={() => patch({ status: 'in_progress' })}
            disabled={loading}
            variant="outline"
            size="sm"
          >
            Start Review
          </Button>
          <p className="text-xs text-zinc-500">
            Mark this review in progress before making changes.
          </p>
        </div>
      )}

      {currentStatus === 'in_progress' && (
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-zinc-700 block mb-1.5">
              Reviewer Notes
            </label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Describe what you found and any corrections made…"
              rows={3}
              className="text-sm"
            />
          </div>
          <div className="flex items-center gap-3">
            <Button
              onClick={() => patch({ status: 'approved', reviewer_notes: notes })}
              disabled={loading}
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              Approve
            </Button>
            <Button
              onClick={() => patch({ status: 'corrected', reviewer_notes: notes })}
              disabled={loading}
              variant="outline"
              size="sm"
            >
              Mark Corrected
            </Button>
          </div>
        </div>
      )}

      {(currentStatus === 'approved' ||
        currentStatus === 'corrected' ||
        currentStatus === 'failed') && (
        <div className="flex items-center gap-2">
          <span
            className={`text-sm font-medium ${currentStatus === 'approved' ? 'text-green-600' : 'text-zinc-600'}`}
          >
            {currentStatus === 'approved'
              ? '✓ Approved'
              : currentStatus === 'corrected'
                ? '✓ Corrected'
                : '✗ Failed'}
          </span>
          {existingNotes && (
            <p className="text-sm text-zinc-500 ml-2">— {existingNotes}</p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

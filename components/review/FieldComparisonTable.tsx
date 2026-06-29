'use client';

import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { clsx } from 'clsx';
import { AgreementBadge } from './AgreementBadge';
import type { FieldComparison } from '@/workers/comparison/comparison-schema';

const SORT_ORDER: Record<string, number> = {
  conflict: 0,
  invalid_evidence: 0,
  claude_only: 1,
  openai_only: 1,
  partial_match: 2,
  normalized_match: 3,
  exact_match: 4,
  not_comparable: 5,
  both_null: 6,
};

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.join(', ') || '—';
  if (typeof v === 'number') return v.toLocaleString();
  return String(v);
}

export function FieldComparisonTable({
  fieldComparisons,
}: {
  fieldComparisons: FieldComparison[];
}) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);

  const sorted = [...fieldComparisons].sort(
    (a, b) => (SORT_ORDER[a.agreement] ?? 5) - (SORT_ORDER[b.agreement] ?? 5),
  );

  const visible = showAll
    ? sorted
    : sorted.filter((f) => f.agreement !== 'both_null');

  const bothNullCount = sorted.filter((f) => f.agreement === 'both_null').length;

  function toggleRow(name: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-zinc-200">
        <table className="min-w-full divide-y divide-zinc-200 text-sm">
          <thead className="bg-zinc-50">
            <tr>
              <th className="w-6 px-3 py-3" />
              <th className="px-4 py-3 text-left font-medium text-zinc-500">Field</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-500">Claude</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-500">OpenAI</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-500">Agreement</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-500">Risk</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 bg-white">
            {visible.map((field) => {
              const expanded = expandedRows.has(field.field_name);
              const hasExcerpts =
                field.claude_source_excerpt ||
                field.openai_source_excerpt ||
                field.claude_page_numbers?.length ||
                field.openai_page_numbers?.length;

              return (
                <Fragment key={field.field_name}>
                  <tr
                    className={clsx(
                      'cursor-pointer hover:bg-zinc-50 transition-colors',
                      field.agreement === 'conflict' && 'bg-red-50/30',
                      hasExcerpts && 'cursor-pointer',
                    )}
                    onClick={() => hasExcerpts && toggleRow(field.field_name)}
                  >
                    <td className="px-3 py-3 text-zinc-400">
                      {hasExcerpts ? (
                        expanded ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )
                      ) : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-700 whitespace-nowrap">
                      {field.field_name}
                    </td>
                    <td className="px-4 py-3 text-zinc-800 max-w-[200px] truncate">
                      {formatValue(field.claude_value)}
                    </td>
                    <td className="px-4 py-3 text-zinc-800 max-w-[200px] truncate">
                      {formatValue(field.openai_value)}
                    </td>
                    <td className="px-4 py-3">
                      <AgreementBadge agreement={field.agreement} />
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500 capitalize">
                      {field.risk_level}
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="bg-zinc-50">
                      <td />
                      <td colSpan={5} className="px-4 py-3">
                        <div className="grid grid-cols-2 gap-4 text-xs">
                          <div>
                            <p className="font-medium text-zinc-500 mb-1">
                              Claude — pages {field.claude_page_numbers?.join(', ') ?? '—'}
                            </p>
                            <p className="text-zinc-700 italic">
                              {field.claude_source_excerpt ?? 'No excerpt provided'}
                            </p>
                          </div>
                          <div>
                            <p className="font-medium text-zinc-500 mb-1">
                              OpenAI — pages {field.openai_page_numbers?.join(', ') ?? '—'}
                            </p>
                            <p className="text-zinc-700 italic">
                              {field.openai_source_excerpt ?? 'No excerpt provided'}
                            </p>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {bothNullCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-3 text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
        >
          {showAll
            ? `Hide ${bothNullCount} empty fields`
            : `Show ${bothNullCount} empty fields`}
        </button>
      )}
    </div>
  );
}

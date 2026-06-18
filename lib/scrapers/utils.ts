const UNPARSEABLE_DATE_VALUES = new Set(['tbd', 'n/a', '-', '—', 'pending', '']);

export function parseDate(raw: string | null | undefined): string | null {
  if (raw == null) return null;

  const trimmed = raw.trim();
  if (UNPARSEABLE_DATE_VALUES.has(trimmed.toLowerCase())) return null;

  // MM/DD/YYYY (most common in CA portals)
  const mdyMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch) {
    const [, m, d, y] = mdyMatch;
    const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    const date = new Date(`${iso}T00:00:00`);
    if (!isNaN(date.getTime())) return iso;
  }

  // Already ISO: YYYY-MM-DD
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return trimmed;

  // Fallback: let Date parse it (handles "June 1, 2026" etc.)
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }

  return null;
}

export function normalizeText(raw: string | null | undefined): string {
  if (raw == null) return '';
  return raw.trim().replace(/\s+/g, ' ');
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

export function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeDate(value: string): string | null {
  const trimmed = value.trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const slashMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (slashMatch) {
    const month = slashMatch[1].padStart(2, '0');
    const day = slashMatch[2].padStart(2, '0');
    return `${slashMatch[3]}-${month}-${day}`;
  }

  const longMatch = trimmed.match(
    /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/,
  );
  if (longMatch) {
    const month = MONTHS[longMatch[1].toLowerCase()];
    if (!month) return null;
    const day = longMatch[2].padStart(2, '0');
    const monthStr = String(month).padStart(2, '0');
    return `${longMatch[3]}-${monthStr}-${day}`;
  }

  return null;
}

export function normalizeTime(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) {
    return trimmed;
  }

  let hour = Number.parseInt(match[1], 10);
  const minute = match[2];
  const meridiem = match[3].toUpperCase();

  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;

  return `${String(hour).padStart(2, '0')}:${minute}`;
}

export function normalizeCents(value: number): number {
  return value;
}

export function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeList(values: string[]): string[] {
  const normalized = values.map((value) => normalizeText(value));
  return [...new Set(normalized)].sort();
}

export function normalizeLicenseClassification(code: string): string {
  let normalized = code.trim();
  normalized = normalized.replace(/^class\s+/i, '');

  const compact = normalized.toUpperCase().replace(/\s+/g, '');
  const cMatch = compact.match(/^C-?(\d{1,2})$/);
  if (cMatch) {
    return `C-${cMatch[1]}`;
  }

  const letterMatch = compact.match(/^([A-Z])$/);
  if (letterMatch) {
    return letterMatch[1];
  }

  return normalized.toUpperCase();
}

export function extractPercentage(value: string): number | null {
  const match = value.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!match) return null;
  return Number.parseFloat(match[1]);
}

export function extractDollarAmount(value: string): number | null {
  const match = value.match(/\$\s*([\d,]+(?:\.\d+)?)/);
  if (!match) return null;
  return Number.parseFloat(match[1].replace(/,/g, ''));
}

export function detectCentsMismatch(a: number, b: number): boolean {
  if (a === 0 || b === 0) return false;
  const ratioAB = a / b;
  const ratioBA = b / a;
  return Math.abs(ratioAB - 100) < 0.5 || Math.abs(ratioBA - 100) < 0.5;
}

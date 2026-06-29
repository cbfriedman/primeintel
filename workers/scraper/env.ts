import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type LoadEnvLocalOptions = {
  /** When true, throw if `.env.local` is missing (for worker CLI scripts). */
  required?: boolean;
};

function parseEnvValue(raw: string): string {
  const value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Load environment variables from `.env.local` for worker CLI scripts.
 * Resolves relative to `process.cwd()` — run commands from the project root.
 */
export function loadEnvLocal(options: LoadEnvLocalOptions = {}): void {
  const envPath = resolve(process.cwd(), '.env.local');

  if (!existsSync(envPath)) {
    // In production (Railway/Render), env vars are injected directly — no .env.local needed.
    if (options.required && !process.env.NEXT_PUBLIC_SUPABASE_URL) {
      throw new Error(
        `Missing .env.local at ${envPath}. Create it in the project root with Supabase credentials before running worker CLI scripts.`,
      );
    }
    return;
  }

  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = parseEnvValue(trimmed.slice(separatorIndex + 1));

    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

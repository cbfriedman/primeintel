import { PROMPT_VERSION, SCHEMA_VERSION } from './schema';

export type ExtractionConfig = {
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  promptVersion: string;
  schemaVersion: string;
};

function readInt(envVar: string, defaultValue: number): number {
  const raw = process.env[envVar]?.trim();
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

export function getExtractionConfig(): ExtractionConfig {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('Missing ANTHROPIC_API_KEY environment variable.');
  }

  return {
    apiKey,
    model:         process.env.CLAUDE_EXTRACTION_MODEL?.trim()        || 'claude-sonnet-4-6',
    timeoutMs:     readInt('CLAUDE_EXTRACTION_TIMEOUT_MS', 90_000),
    maxRetries:    readInt('CLAUDE_EXTRACTION_MAX_RETRIES', 3),
    promptVersion: process.env.CLAUDE_EXTRACTION_PROMPT_VERSION?.trim() || PROMPT_VERSION,
    schemaVersion: process.env.AI_EXTRACTION_SCHEMA_VERSION?.trim()     || SCHEMA_VERSION,
  };
}

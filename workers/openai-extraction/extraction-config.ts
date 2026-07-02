import { SCHEMA_VERSION } from '../claude-extraction/schema';

export type OpenAIExtractionConfig = {
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

export function getOpenAIExtractionConfig(): OpenAIExtractionConfig {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY environment variable.');
  }

  return {
    apiKey,
    model: process.env.OPENAI_EXTRACTION_MODEL?.trim() || 'gpt-4o',
    timeoutMs: readInt('OPENAI_EXTRACTION_TIMEOUT_MS', 90_000),
    maxRetries: readInt('OPENAI_EXTRACTION_MAX_RETRIES', 3),
    promptVersion:
      process.env.OPENAI_EXTRACTION_PROMPT_VERSION?.trim() || 'openai-extraction-v2',
    schemaVersion: SCHEMA_VERSION,
  };
}

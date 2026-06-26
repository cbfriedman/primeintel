import OpenAI, { APIError } from 'openai';

import { OPENAI_EXTRACTION_INPUT_SCHEMA } from '../claude-extraction/schema';
import { OPENAI_SYSTEM_PROMPT } from './prompt';
import { getOpenAIExtractionConfig } from './extraction-config';

const LOG_PREFIX = '[openai-client]';

export type OpenAICallResult = {
  rawOutput: Record<string, unknown>;
  usage: { input_tokens: number; output_tokens: number };
};

export class ExtractionRefusalError extends Error {
  constructor(public readonly reason: string) {
    super(`OpenAI refused extraction: ${reason}`);
    this.name = 'ExtractionRefusalError';
  }
}

export class ExtractionParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractionParseError';
  }
}

function isRetryable(err: unknown): boolean {
  if (err instanceof ExtractionRefusalError) return false;
  if (err instanceof ExtractionParseError) return false;
  if (err instanceof APIError) {
    return err.status === 429 || (err.status !== undefined && err.status >= 500);
  }
  if (err instanceof Error && err.name === 'TimeoutError') {
    return true;
  }
  return err instanceof TypeError;
}

function jitteredDelay(baseMs: number): number {
  return Math.round(baseMs * (0.8 + Math.random() * 0.4));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function findRefusalReason(
  output: OpenAI.Responses.Response['output'] | undefined,
): string | null {
  if (!output) {
    return null;
  }

  for (const item of output) {
    if (item.type === 'message') {
      for (const part of item.content) {
        if (part.type === 'refusal') {
          return part.refusal;
        }
      }
    }
  }

  return null;
}

export async function callOpenAIExtraction(userPrompt: string): Promise<OpenAICallResult> {
  const config = getOpenAIExtractionConfig();
  const client = new OpenAI({ apiKey: config.apiKey });

  const retryDelays = [2000, 4000, 8000].slice(0, config.maxRetries - 1);
  let lastError: unknown;

  for (let attempt = 0; attempt < config.maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = jitteredDelay(retryDelays[attempt - 1]);
      console.log(`${LOG_PREFIX} Retry ${attempt + 1}/${config.maxRetries} in ${delay}ms...`);
      await sleep(delay);
    }

    try {
      const signal = AbortSignal.timeout(config.timeoutMs);

      const response = await client.responses.create(
        {
          model: config.model,
          instructions: OPENAI_SYSTEM_PROMPT,
          input: [{ role: 'user', content: userPrompt }],
          text: {
            format: {
              type: 'json_schema',
              name: 'extracted_bid_fields',
              strict: true,
              schema: OPENAI_EXTRACTION_INPUT_SCHEMA,
            },
          },
        },
        { signal },
      );

      if (response.error) {
        throw new ExtractionParseError(
          `OpenAI response error: ${response.error.message ?? response.error.code ?? 'unknown'}`,
        );
      }

      const refusalReason = findRefusalReason(response.output);
      if (refusalReason) {
        throw new ExtractionRefusalError(refusalReason);
      }

      const rawText = response.output_text;
      if (!rawText) {
        throw new ExtractionParseError(
          `OpenAI returned no output text; status=${response.status ?? 'unknown'}`,
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        throw new ExtractionParseError('OpenAI response was not valid JSON');
      }

      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new ExtractionParseError('OpenAI response JSON was not an object');
      }

      return {
        rawOutput: parsed as Record<string, unknown>,
        usage: {
          input_tokens: response.usage?.input_tokens ?? 0,
          output_tokens: response.usage?.output_tokens ?? 0,
        },
      };
    } catch (err) {
      lastError = err;

      if (!isRetryable(err)) {
        throw err;
      }

      if (attempt < config.maxRetries - 1) {
        console.log(
          `${LOG_PREFIX} Attempt ${attempt + 1} failed (will retry): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  throw lastError;
}

import Anthropic, { APIError } from '@anthropic-ai/sdk';

import { EXTRACTION_TOOL_NAME, EXTRACTION_TOOL_INPUT_SCHEMA } from './schema';
import { SYSTEM_PROMPT } from './prompt';
import { getExtractionConfig } from './extraction-config';

const LOG_PREFIX = '[claude-client]';
const MAX_OUTPUT_TOKENS = 8192;
const TEMPERATURE = 0;

export type ClaudeCallResult = {
  toolInput: Record<string, unknown>;
  usage: { input_tokens: number; output_tokens: number };
};

function isRetryable(err: unknown): boolean {
  if (err instanceof APIError) {
    return err.status === 429 || (err.status !== undefined && err.status >= 500);
  }
  return true; // network error or timeout
}

function jitteredDelay(baseMs: number): number {
  return Math.round(baseMs * (0.8 + Math.random() * 0.4));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function callClaudeExtraction(userPrompt: string): Promise<ClaudeCallResult> {
  const config = getExtractionConfig();
  const client = new Anthropic({ apiKey: config.apiKey });

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

      const response = await client.messages.create(
        {
          model: config.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          temperature: TEMPERATURE,
          system: SYSTEM_PROMPT,
          tools: [
            {
              name: EXTRACTION_TOOL_NAME,
              description:
                'Extract structured bid fields from a California public works bid specification.',
              input_schema: EXTRACTION_TOOL_INPUT_SCHEMA,
            },
          ],
          tool_choice: { type: 'tool', name: EXTRACTION_TOOL_NAME },
          messages: [{ role: 'user', content: userPrompt }],
        },
        { signal },
      );

      const toolUseBlock = response.content.find((b) => b.type === 'tool_use');
      if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
        throw new Error(
          `Claude did not call ${EXTRACTION_TOOL_NAME}; stop_reason=${response.stop_reason}`,
        );
      }

      return {
        toolInput: toolUseBlock.input as Record<string, unknown>,
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
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

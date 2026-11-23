import fs from 'fs';
import os from 'os';
import path from 'path';
import { AppConfig } from '../config';
import { AiInput, AiResult, CATEGORY_TIMEOUT_MS, DeepSeekAiClient, DeepSeekChatRequest, grokPromptParts } from './ai.client';
import { DEFAULT_GROK_MODEL, findGrokCommand } from './ai-profile';
import { grokArgv, grokLogHint, GrokSpawn, readGrokResult, spawnGrok } from './grok.spawn';

/**
 * Checklist call through the signed-in `grok` binary, spawned without a shell.
 * Frames are JPEG files in an empty temp directory, named in the prompt.
 * Four turns leave a turn to read an @file and still print the answer.
 */
export class GrokBuildAiClient extends DeepSeekAiClient {
  constructor(
    config: AppConfig,
    private readonly spawnImpl: GrokSpawn = spawnGrok,
    private readonly commandImpl: () => string | null = () => findGrokCommand(),
  ) {
    super(config, (async () => {
      throw new Error('grok');
    }) as typeof fetch);
  }

  override async review(input: AiInput): Promise<AiResult> {
    const result = await super.review(input);
    if (!result.ai_requests) return result;
    return {
      ...result,
      ai_requests: { shots: {}, calls: result.ai_requests.calls },
    };
  }

  protected override model(): string {
    return this.slug();
  }

  protected override visionModel(): string {
    return this.slug();
  }

  protected override async complete(
    request: DeepSeekChatRequest,
  ): Promise<{ content: string; usage: Record<string, unknown> | null }> {
    const command = this.commandImpl();
    if (!command) throw grokFailure('missing');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-grok-'));
    try {
      const parts = grokPromptParts(request);
      for (const frame of parts.frames) {
        fs.writeFileSync(path.join(dir, frame.name), frame.bytes);
      }
      const mentions = parts.frames.map((frame) => `@${frame.name}`);
      const prompt = mentions.length ? `${parts.text}\n${mentions.join('\n')}` : parts.text;
      const args = grokArgv({ prompt, model: this.slug(), cwd: dir, system: parts.system });
      const result = await this.spawnImpl(command, args, { cwd: dir, timeoutMs: CATEGORY_TIMEOUT_MS });
      if (result.code !== 0) {
        const recovered = readFinishedAnswer(result.stdout);
        if (recovered) return recovered;
        throw grokFailure(
          result.code == null ? 'timeout' : 'exit',
          result.code == null,
          grokLogHint(result.code, result.stderr ?? ''),
        );
      }
      return readGrokResult(result.stdout);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  private slug(): string {
    return this.config.grokModel.trim() || DEFAULT_GROK_MODEL;
  }
}

/**
 * A non-zero exit still counts when stdout is already the JSON answer wrapper.
 * Empty stdout and non-JSON stay a failure so the caller can log the exit.
 */
function readFinishedAnswer(stdout: string): { content: string; usage: Record<string, unknown> | null } | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (typeof (parsed as { text?: unknown }).text !== 'string') return null;
    return readGrokResult(trimmed);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function grokFailure(message: string, timeout = false, logHint = ''): Error {
  const error = new Error(message);
  error.name = timeout ? 'TimeoutError' : 'GrokCallError';
  if (logHint) (error as Error & { logHint?: string }).logHint = logHint;
  return error;
}

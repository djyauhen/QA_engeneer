import fs from 'fs';
import os from 'os';
import path from 'path';
import { AppConfig } from '../config';
import { AiCallError, AiInput, AiResult, DeepSeekAiClient, DeepSeekChatRequest, grokPromptParts, grokVisionSystem } from './ai.client';
import { DEFAULT_GROK_MODEL, findGrokCommand } from './ai-profile';
import { errorMessageThenStderr, grokArgv, grokLogHint, GROK_SPAWN_TIMEOUT_MS, grokSystemFileText, GrokSpawn, GrokSpawnResult, readGrokResult, spawnGrok } from './grok.spawn';
import { grokCategorySystem } from './qa-category-instruction';

/** Checklist points in flight. Each spawn has its own directory, so prompt files do not clobber. */
export const GROK_CATEGORY_CONCURRENCY = 2;

const GROK_FRAME_LINE =
  'Каждая строка выше начинается с @ и кончается на .jpg. Это один кадр. Метка в JSON — имя файла без @ и без .jpg. Открой каждый названный файл один раз через read_file и смотри как изображение. Каталог не листай. Пиксели не видны — кадр не выдумывай. В пункте статус N/A и эта фраза в note. В глазах статус не ставь: face_visible false и та же фраза в note записи.';

/**
 * One fresh Grok Build process per turn, in its own subdirectory of the review temp dir.
 * The prompt file is the current user turn, so the CLI does not need a session id or --resume.
 * System and prompt stay on disk: Windows rejects a command line near 32KB.
 */
export class GrokBuildAiClient extends DeepSeekAiClient {
  private turnDir: string | null = null;

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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-grok-'));
    this.turnDir = dir;
    try {
      const result = await super.review(input);
      if (!result.ai_requests) return result;
      return {
        ...result,
        ai_requests: {
          shots: {},
          calls: result.ai_requests.calls.map((call) => ({
            ...call,
            system: grokSystemFileText(grokTurnSystem(call.kind, call.category ?? null)),
          })),
        },
      };
    } finally {
      this.turnDir = null;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  protected override model(): string {
    return this.slug();
  }

  protected override visionModel(): string {
    return this.slug();
  }

  protected override categoryConcurrency(): number {
    return GROK_CATEGORY_CONCURRENCY;
  }

  protected override async complete(
    request: DeepSeekChatRequest,
  ): Promise<{ content: string; usage: Record<string, unknown> | null }> {
    const parent = this.turnDir;
    const command = this.commandImpl();
    if (!parent || !command) throw new AiCallError('Grok Build не найден.');
    const dir = fs.mkdtempSync(path.join(parent, 'call-'));
    try {
      const parts = grokPromptParts(request);
      for (const frame of parts.frames) {
        fs.writeFileSync(path.join(dir, frame.name), frame.bytes);
      }
      const mentions = parts.frames.map((frame) => `@${frame.name}`);
      const prompt = mentions.length ? `${parts.text}\n${mentions.join('\n')}\n${GROK_FRAME_LINE}` : parts.text;
      const promptFile = path.join(dir, 'prompt.txt');
      const systemFile = path.join(dir, 'system.txt');
      fs.writeFileSync(promptFile, prompt, 'utf8');
      fs.writeFileSync(systemFile, grokSystemFileText(grokTurnSystem(parts.kind, parts.category)), 'utf8');
      const args = grokArgv({ promptFile, model: this.slug(), cwd: dir, systemFile });
      let result: GrokSpawnResult;
      try {
        result = await this.spawnImpl(command, args, { cwd: dir, timeoutMs: GROK_SPAWN_TIMEOUT_MS });
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        throw new AiCallError(message && message !== 'spawn' ? message : 'Grok Build не запустился.');
      }
      if (result.code !== 0) throw new AiCallError(cliDetail(result));
      let parsed: { content: string; usage: Record<string, unknown> | null } | null;
      try {
        parsed = result.stdout.trim() ? readGrokResult(result.stdout) : null;
      } catch (error) {
        if (error instanceof SyntaxError) throw new AiCallError(cliDetail(result));
        throw error;
      }
      if (!parsed?.content.trim()) throw new AiCallError(cliDetail(result));
      return { content: parsed.content, usage: parsed.usage };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  private slug(): string {
    return this.config.grokModel.trim() || DEFAULT_GROK_MODEL;
  }
}

function grokTurnSystem(kind: 'vision' | 'category', category: number | null): string {
  if (kind === 'vision') return grokVisionSystem();
  if (kind === 'category' && category != null && category >= 1 && category <= 11) return grokCategorySystem(category);
  throw new AiCallError('Grok Build не собрал system.');
}

function cliDetail(result: GrokSpawnResult): string {
  const hint = grokLogHint(result.code, errorMessageThenStderr(result.stdout, result.stderr ?? ''));
  if (hint) return hint;
  if (result.code == null) return 'timeout';
  return `exit ${result.code}`;
}

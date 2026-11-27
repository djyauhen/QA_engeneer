import fs from 'fs';
import os from 'os';
import path from 'path';
import { AppConfig } from '../config';
import { AiCallError, AiInput, AiResult, DeepSeekAiClient, DeepSeekChatRequest, grokPromptParts, grokVisionSystem } from './ai.client';
import { DEFAULT_GROK_MODEL, findGrokCommand } from './ai-profile';
import {
  errorMessageThenStderr,
  grokArgv,
  grokLogHint,
  GROK_CATEGORY_DISALLOWED_TOOLS,
  GROK_CATEGORY_MAX_TURNS,
  GROK_DISALLOWED_TOOLS,
  GROK_REASONING_EFFORT,
  GROK_SPAWN_TIMEOUT_MS,
  GROK_VISION_MAX_TURNS,
  GROK_VISION_REASONING_EFFORT,
  grokSystemFileText,
  GrokSpawn,
  GrokSpawnResult,
  readGrokResult,
  spawnGrok,
} from './grok.spawn';
import { grokCategorySystem } from './qa-category-instruction';

/** Checklist points in flight. Same width as DeepSeek. Each spawn has its own directory, so prompt files do not clobber. */
export const GROK_CATEGORY_CONCURRENCY = 4;

const GROK_VISION_FRAME_LINE =
  'Каждая строка выше начинается с @ и кончается на .jpg. Это один кадр. Метка в JSON — имя файла без @ и без .jpg. Открой каждый названный файл один раз через read_file, все в одном сообщении, и смотри как изображение. list_dir не вызывай. Пиксели не видны — кадр не выдумывай: face_visible false и эта фраза в note записи. Статус не ставь.';

const GROK_CATEGORY_FRAME_LINE =
  'Строки выше с @ и .jpg — те же кадры. Файлы не открывай и инструменты не вызывай. Пиксели уже в visual_observations. Чего там нет, не выдумывай. quote — дословная подстрока page_text; нет такой подстроки — finding не пиши.';

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
      const frameLine = parts.kind === 'vision' ? GROK_VISION_FRAME_LINE : GROK_CATEGORY_FRAME_LINE;
      const prompt = mentions.length ? `${parts.text}\n${mentions.join('\n')}\n${frameLine}` : parts.text;
      const promptFile = path.join(dir, 'prompt.txt');
      const systemFile = path.join(dir, 'system.txt');
      fs.writeFileSync(promptFile, prompt, 'utf8');
      fs.writeFileSync(systemFile, grokSystemFileText(grokTurnSystem(parts.kind, parts.category)), 'utf8');
      const vision = parts.kind === 'vision';
      const args = grokArgv({
        promptFile,
        model: this.slug(),
        cwd: dir,
        systemFile,
        reasoningEffort: vision ? GROK_VISION_REASONING_EFFORT : GROK_REASONING_EFFORT,
        maxTurns: vision ? GROK_VISION_MAX_TURNS : GROK_CATEGORY_MAX_TURNS,
        disallowedTools: vision ? GROK_DISALLOWED_TOOLS : GROK_CATEGORY_DISALLOWED_TOOLS,
      });
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

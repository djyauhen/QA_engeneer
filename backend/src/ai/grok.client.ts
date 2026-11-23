import { AsyncLocalStorage } from 'async_hooks';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AppConfig } from '../config';
import { AiCallError, AiInput, AiResult, CATEGORY_TIMEOUT_MS, DeepSeekAiClient, DeepSeekChatRequest, grokPromptParts } from './ai.client';
import { DEFAULT_GROK_MODEL, findGrokCommand } from './ai-profile';
import { grokArgv, grokLogHint, GrokSpawn, readGrokResult, spawnGrok } from './grok.spawn';

interface GrokTurnState {
  dir: string;
  sessionId: string | null;
  wroteFrames: boolean;
}

const grokTurn = new AsyncLocalStorage<GrokTurnState>();

/**
 * One Grok Build session per review(). Frames are written once into that temp directory.
 * The first spawn is a fresh -p. Later spawns --resume the sessionId from that stdout.
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-grok-'));
    const state: GrokTurnState = { dir, sessionId: null, wroteFrames: false };
    try {
      const result = await grokTurn.run(state, () => super.review(input));
      if (!result.ai_requests) return result;
      return {
        ...result,
        ai_requests: { shots: {}, calls: result.ai_requests.calls },
      };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  protected override afterTurn(): void {
    const state = grokTurn.getStore();
    if (state && !state.sessionId) throw new AiCallError('grok session: no sessionId');
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
    const state = grokTurn.getStore();
    const command = this.commandImpl();
    if (!command || !state) throw grokFailure('missing');
    const parts = grokPromptParts(request);
    if (!state.wroteFrames && parts.frames.length) {
      for (const frame of parts.frames) {
        fs.writeFileSync(path.join(state.dir, frame.name), frame.bytes);
      }
      state.wroteFrames = true;
    }
    const resume = state.sessionId;
    const mentions = resume ? [] : parts.frames.map((frame) => `@${frame.name}`);
    const prompt = mentions.length ? `${parts.text}\n${mentions.join('\n')}` : parts.text;
    const args = grokArgv({ prompt, model: this.slug(), cwd: state.dir, system: parts.system, resume });
    const result = await this.spawnImpl(command, args, { cwd: state.dir, timeoutMs: CATEGORY_TIMEOUT_MS });
    const parsed = result.code === 0 ? readGrokResult(result.stdout) : readFinishedAnswer(result.stdout);
    if (!parsed) {
      throw grokFailure(
        result.code == null ? 'timeout' : 'exit',
        result.code == null,
        grokLogHint(result.code, result.stderr ?? ''),
      );
    }
    if (!parsed.sessionId) throw new AiCallError('grok session: no sessionId');
    state.sessionId = parsed.sessionId;
    return { content: parsed.content, usage: parsed.usage };
  }

  private slug(): string {
    return this.config.grokModel.trim() || DEFAULT_GROK_MODEL;
  }
}

/**
 * A non-zero exit still counts when stdout is already the JSON answer wrapper.
 * Empty stdout and non-JSON stay a failure so the caller can log the exit.
 */
function readFinishedAnswer(stdout: string): {
  content: string;
  usage: Record<string, unknown> | null;
  sessionId: string | null;
} | null {
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

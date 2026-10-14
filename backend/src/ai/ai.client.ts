import OpenAI from 'openai';
import { AppConfig } from '../config';
import { AiFinding } from '../reports/report.types';

export const DEFAULT_DEEPSEEK_API_BASE = 'https://api.deepseek.com';
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-flash';
/** Thinking stays on, but the default high-effort budget is 64K tokens and outlives a Vercel function. */
export const DEEPSEEK_REASONING_EFFORT = 'low';
export const DEEPSEEK_MAX_OUTPUT_TOKENS = 8192;

export interface AiInput {
  files: Array<{ path: string; text: string }>;
  languages: string[];
  countries: string[];
  standUrl: string | null;
  name: string;
}

export interface AiResult {
  findings: Array<Partial<AiFinding>>;
  usage?: Record<string, unknown> | null;
  skipped?: boolean;
}

export abstract class AiClient {
  abstract review(input: AiInput): Promise<AiResult>;
}

export function completeFindings(raw: Array<Partial<AiFinding>>): AiFinding[] {
  return raw
    .filter(
      (finding): finding is AiFinding =>
        !!finding &&
        typeof finding.file === 'string' &&
        finding.file.length > 0 &&
        typeof finding.quote === 'string' &&
        finding.quote.length > 0 &&
        typeof finding.screenshot === 'string' &&
        finding.screenshot.length > 0,
    )
    .map((finding) => ({ file: finding.file, quote: finding.quote, screenshot: finding.screenshot }));
}

const SYSTEM_PROMPT = [
  'Ты проверяешь лендинг и только перечисляешь дефекты.',
  'Не ставь общий статус и не решай, годен ленд или нет.',
  'Ищи: орфографию, смешение языков, смысл фраз, личные имена нетипичные для ГЕО, валюту не для этого ГЕО, повтор изображения там, где нужно уникальное.',
  'Верни JSON {"findings":[{"file":"путь","quote":"цитата","screenshot":"описание или путь скриншота"}]}.',
  'Находка без пути, цитаты и скриншота не нужна. Цитаты не переводи.',
  'Основной контекст — файлы ленда. Публичный URL стенда можно учесть, если модель умеет его открыть; локальный или закрытый URL не обязателен.',
].join(' ');

export class AiCallError extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super('Сбой вызова ИИ');
    this.name = 'AiCallError';
    this.detail = detail;
  }
}

export class StubAiClient extends AiClient {
  async review(): Promise<AiResult> {
    return { findings: [], usage: null, skipped: true };
  }
}

/** Official OpenAI types include reasoning_effort and omit DeepSeek thinking. */
type DeepSeekChatRequest = OpenAI.Chat.ChatCompletionCreateParamsNonStreaming & {
  thinking: { type: 'enabled' };
};

export class DeepSeekAiClient extends AiClient {
  private readonly openai: OpenAI;

  constructor(
    private readonly config: AppConfig,
    fetchImpl: typeof fetch = globalThis.fetch,
  ) {
    super();
    const baseURL = (this.config.aiBaseUrl || DEFAULT_DEEPSEEK_API_BASE).replace(/\/$/, '');
    this.openai = new OpenAI({
      baseURL,
      apiKey: this.config.aiApiKey,
      fetch: fetchImpl,
      maxRetries: 0,
      logLevel: 'off',
    });
  }

  async review(input: AiInput): Promise<AiResult> {
    try {
      const model = this.config.aiModel || DEFAULT_DEEPSEEK_MODEL;
      const userPayload = {
        name: input.name,
        languages: input.languages,
        countries: input.countries,
        stand_url: input.standUrl,
        files: input.files,
      };
      const request: DeepSeekChatRequest = {
        model,
        stream: false,
        thinking: { type: 'enabled' },
        reasoning_effort: DEEPSEEK_REASONING_EFFORT,
        max_tokens: DEEPSEEK_MAX_OUTPUT_TOKENS,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(userPayload) },
        ],
      };
      const completion = await this.openai.chat.completions.create(request);
      const content = completion.choices[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) throw new AiCallError('empty');
      try {
        return { findings: parseFindings(content), usage: plainUsage(completion.usage) };
      } catch {
        throw new AiCallError('invalid_json');
      }
    } catch (error) {
      if (error instanceof AiCallError) {
        logAiFailure(error.detail);
        throw error;
      }
      const detail = aiFailureLabel(error);
      logAiFailure(detail);
      throw new AiCallError(detail);
    }
  }
}

function logAiFailure(detail: string): void {
  if (process.env.NODE_ENV !== 'test') console.error(`ai call failed: ${detail}`);
}

function aiFailureLabel(error: unknown): string {
  const name = error instanceof Error ? error.name : 'Error';
  if (!error || typeof error !== 'object') return name;
  const status =
    'status' in error && typeof error.status === 'number' ? ` HTTP ${error.status}` : '';
  return `${name}${status}${safeCode(error)}`;
}

function safeCode(error: object): string {
  const direct = 'code' in error && typeof error.code === 'string' ? error.code : '';
  const nested = 'error' in error ? error.error : undefined;
  const nestedCode =
    nested && typeof nested === 'object' && 'code' in nested && typeof nested.code === 'string' ? nested.code : '';
  const code = direct || nestedCode;
  return /^[a-z0-9_]{1,40}$/i.test(code) ? ` ${code}` : '';
}

function plainUsage(usage: unknown): Record<string, unknown> | null {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  return usage as Record<string, unknown>;
}

function parseFindings(content: string): Array<Partial<AiFinding>> {
  const trimmed = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(trimmed) as { findings?: Array<Partial<AiFinding>> };
  return Array.isArray(parsed.findings) ? parsed.findings : [];
}

export function createAiClient(config: AppConfig): AiClient {
  if (config.aiMode === 'real' && config.aiApiKey) return new DeepSeekAiClient(config);
  return new StubAiClient();
}

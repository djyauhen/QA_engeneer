import { AppConfig } from '../config';
import { AiFinding } from '../reports/report.types';

export const DEFAULT_GEMINI_API_BASE = 'https://generativelanguage.googleapis.com';
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';

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

export class StubAiClient extends AiClient {
  async review(): Promise<AiResult> {
    return { findings: [], usage: null };
  }
}

export class GeminiAiClient extends AiClient {
  constructor(
    private readonly config: AppConfig,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {
    super();
  }

  async review(input: AiInput): Promise<AiResult> {
    try {
      const model = this.config.aiModel || DEFAULT_GEMINI_MODEL;
      const base = (this.config.aiBaseUrl || DEFAULT_GEMINI_API_BASE).replace(/\/$/, '');
      const url = `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const useUrlContext = isPublicHttpUrl(input.standUrl);
      const userPayload = {
        name: input.name,
        languages: input.languages,
        countries: input.countries,
        stand_url: input.standUrl,
        files: input.files,
      };
      const body: Record<string, unknown> = {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(userPayload) }] }],
        generationConfig: { responseMimeType: 'application/json' },
      };
      if (useUrlContext && input.standUrl) {
        body.tools = [{ urlContext: {} }];
      }
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.config.aiApiKey,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error('status');
      const payload = (await response.json()) as GeminiGenerateContentResponse;
      const content = extractGeminiText(payload);
      const parsed = parseFindings(content);
      const usage = payload.usageMetadata && typeof payload.usageMetadata === 'object' ? payload.usageMetadata : null;
      return { findings: parsed, usage };
    } catch {
      throw new Error('Сбой вызова ИИ');
    }
  }
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  usageMetadata?: Record<string, unknown>;
}

export function isPublicHttpUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host === '::1' || host === '0.0.0.0') return false;
    if (host.endsWith('.local') || host.endsWith('.internal')) return false;
    if (isPrivateOrLocalIpv4(host)) return false;
    return true;
  } catch {
    return false;
  }
}

function isPrivateOrLocalIpv4(host: string): boolean {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const a = Number(match[1]);
  const b = Number(match[2]);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function extractGeminiText(payload: GeminiGenerateContentResponse): string {
  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  return parts.map((part) => (typeof part.text === 'string' ? part.text : '')).join('');
}

function parseFindings(content: string): Array<Partial<AiFinding>> {
  const trimmed = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(trimmed) as { findings?: Array<Partial<AiFinding>> };
  return Array.isArray(parsed.findings) ? parsed.findings : [];
}

export function createAiClient(config: AppConfig): AiClient {
  if (config.aiMode === 'real' && config.aiApiKey) return new GeminiAiClient(config);
  return new StubAiClient();
}

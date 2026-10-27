import OpenAI from 'openai';
import { AppConfig } from '../config';
import { AiFinding } from '../reports/report.types';
import { DESKTOP_SHOT } from '../stand/capture';
import { MaterialImage, PersonClaim } from './materials';
import { LANDING_FOOTER_REF, OUTLET_FOOTER_REF, OUTLET_HEADER_REF } from './outlets';
import { ADDENDUM, QA_INSTRUCTION } from './qa-instruction';
import { QaReportFields, enforceImageCorrespondence, mapQaResponse } from './qa-response';

export const DEFAULT_DEEPSEEK_API_BASE = 'https://api.deepseek.com';
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-flash';
/** Thinking stays on, but the default high-effort budget is 64K tokens and outlives a Vercel function. */
export const DEEPSEEK_REASONING_EFFORT = 'low';
export const DEEPSEEK_MAX_OUTPUT_TOKENS = 12288;

export interface AiInput {
  /** Legacy file dump; no longer sent to the model (page_text replaces it). */
  files: Array<{ path: string; text: string }>;
  languages: string[];
  countries: string[];
  standUrl: string | null;
  name: string;
  screenshot?: Buffer | null;
  /** Visible landing text (instruction: text copied with Ctrl+A). */
  pageText?: string;
  /** Celebrity resolved from the land name and/or page text. */
  person?: PersonClaim;
  /** Landing images selected for the model, refs I1..I8. */
  images?: MaterialImage[];
  /** YYYY-MM-DD, the date of the check. */
  checkDate?: string;
  /** Header and footer of the official outlet homepage. Reference only: not a finding screenshot. */
  outlet?: { name: string; url: string; header: Buffer; footer: Buffer } | null;
  /** Bottom of the landing stand, when Chrome could capture it. */
  landingFooter?: Buffer | null;
}

export interface AiResult {
  findings: Array<Partial<AiFinding>>;
  usage?: Record<string, unknown> | null;
  skipped?: boolean;
  /** Instruction §13 report; absent for legacy / stub answers. */
  report?: QaReportFields;
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
    .map((finding) => {
      const out: AiFinding = { file: finding.file, quote: finding.quote, screenshot: finding.screenshot };
      if (typeof finding.category === 'number' && Number.isInteger(finding.category) && finding.category >= 1 && finding.category <= 11) {
        out.category = finding.category;
      }
      if (finding.priority === 'critical' || finding.priority === 'major' || finding.priority === 'minor') {
        out.priority = finding.priority;
      }
      for (const key of ['where', 'problem', 'expected'] as const) {
        const value = finding[key];
        if (typeof value === 'string' && value.trim()) out[key] = value;
      }
      return out;
    });
}

export function applyDesktopShot(raw: Array<Partial<AiFinding>>, dataUrl: string): Array<Partial<AiFinding>> {
  return raw.map((finding) => {
    if (!finding || finding.screenshot?.trim() !== DESKTOP_SHOT) return finding;
    return { ...finding, screenshot: dataUrl };
  });
}

export function desktopShotDataUrl(jpeg: Buffer): string {
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

export const SYSTEM_PROMPT = `${QA_INSTRUCTION}\n\n${ADDENDUM}`;

const EMPTY_PERSON: PersonClaim = { from_land_name: null, from_page_text: null, resolved: null, conflict: false };

function imageDataUrl(image: MaterialImage): string {
  return `data:${image.mime};base64,${image.buffer.toString('base64')}`;
}

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
      const shot = input.screenshot?.length ? input.screenshot : null;
      const images = input.images ?? [];
      const landingFooter = input.landingFooter?.length ? input.landingFooter : null;
      const outlet = input.outlet?.header.length && input.outlet.footer.length ? input.outlet : null;
      const attachmentsOrder = [
        ...(shot ? [DESKTOP_SHOT] : []),
        ...(landingFooter ? [LANDING_FOOTER_REF] : []),
        ...(outlet ? [OUTLET_HEADER_REF, OUTLET_FOOTER_REF] : []),
        ...images.map((image) => image.ref),
      ];
      const userPayload = {
        check_date: input.checkDate ?? new Date().toISOString().slice(0, 10),
        land_name: input.name,
        languages: input.languages,
        countries: input.countries,
        stand_url: input.standUrl,
        fx_rates: null,
        page_text: input.pageText ?? '',
        main_person_claim: input.person ?? EMPTY_PERSON,
        outlet: outlet
          ? { name: outlet.name, url: outlet.url, header_ref: OUTLET_HEADER_REF, footer_ref: OUTLET_FOOTER_REF }
          : null,
        landing_footer_ref: landingFooter ? LANDING_FOOTER_REF : null,
        images: images.map((image) => ({
          ref: image.ref,
          file: image.file,
          alt: image.alt,
          caption: image.caption,
          context: image.context,
          kind: image.kind,
          claims_person: image.claims_person,
        })),
        attachments_order: attachmentsOrder,
      };
      const attachmentNote = attachmentsOrder.length
        ? `Изображения приложены к сообщению в порядке attachments_order (${attachmentsOrder.join(', ')}). В screenshot_ref ставь только метку (${DESKTOP_SHOT}, ${LANDING_FOOTER_REF} или I1..I8), и только если она есть в attachments_order. ${OUTLET_HEADER_REF} и ${OUTLET_FOOTER_REF} в screenshot_ref не ставь, никогда не base64 и не описание.`
        : 'Изображения не приложены: не делай выводов об их содержимом, в screenshot_ref ставь короткую метку места на странице.';
      const outletNote = outlet
        ? `Категория 2: сравни шапку ленда (${shot ? DESKTOP_SHOT : 'скриншота шапки нет'}) с ${OUTLET_HEADER_REF} и футер ленда (${landingFooter ? LANDING_FOOTER_REF : 'текст page_text'}) с ${OUTLET_FOOTER_REF}. Это официальная главная ${outlet.name} (${outlet.url}).`
        : 'Категория 2: скриншотов оригинала издания нет, ставь N/A и не утверждай совпадение шапки и футера.';
      const claimedRefs = images.filter((image) => image.claims_person).map((image) => image.ref);
      const correspondenceNote = claimedRefs.length
        ? `Проверь соответствие изображений ${claimedRefs.join(', ')} персонажу claims_person и верни image_checks (match, mismatch или uncertain) по каждому.`
        : '';
      const userText = [JSON.stringify(userPayload), attachmentNote, outletNote, correspondenceNote, 'ПРОВЕРЯЙ'].filter(Boolean).join('\n');
      const screenshots: Record<string, string> = {};
      if (shot) screenshots[DESKTOP_SHOT] = desktopShotDataUrl(shot);
      if (landingFooter) screenshots[LANDING_FOOTER_REF] = desktopShotDataUrl(landingFooter);
      for (const image of images) screenshots[image.ref] = imageDataUrl(image);
      const modelShots: Record<string, string> = { ...screenshots };
      if (outlet) {
        modelShots[OUTLET_HEADER_REF] = desktopShotDataUrl(outlet.header);
        modelShots[OUTLET_FOOTER_REF] = desktopShotDataUrl(outlet.footer);
      }
      const request: DeepSeekChatRequest = {
        model,
        stream: false,
        thinking: { type: 'enabled' },
        reasoning_effort: DEEPSEEK_REASONING_EFFORT,
        max_tokens: DEEPSEEK_MAX_OUTPUT_TOKENS,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: attachmentsOrder.length
              ? [
                  { type: 'text', text: userText },
                  ...attachmentsOrder.map((label) => ({
                    type: 'image_url' as const,
                    image_url: { url: modelShots[label] },
                  })),
                ]
              : userText,
          },
        ],
      };
      const completion = await this.openai.chat.completions.create(request);
      const content = completion.choices[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) throw new AiCallError('empty');
      try {
        const parsed = parseModelAnswer(content, { pageText: input.pageText, screenshots, images });
        return {
          findings: shot ? applyDesktopShot(parsed.findings, desktopShotDataUrl(shot)) : parsed.findings,
          usage: plainUsage(completion.usage),
          ...(parsed.report ? { report: parsed.report } : {}),
        };
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

function parseModelAnswer(
  content: string,
  options: { pageText?: string; screenshots: Record<string, string>; images?: MaterialImage[] },
): ReturnType<typeof mapQaResponse> {
  const trimmed = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const parsed: unknown = JSON.parse(trimmed);
  const imageChecks =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).image_checks
      : undefined;
  return enforceImageCorrespondence(mapQaResponse(parsed, options), {
    pageText: options.pageText,
    screenshots: options.screenshots,
    images: options.images,
    imageChecks,
  });
}

export function createAiClient(config: AppConfig): AiClient {
  if (config.aiMode === 'real' && config.aiApiKey) return new DeepSeekAiClient(config);
  return new StubAiClient();
}

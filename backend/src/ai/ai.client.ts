import OpenAI from 'openai';
import { AppConfig } from '../config';
import { AiFinding } from '../reports/report.types';
import { DESKTOP_SHOT } from '../stand/capture';
import { previewShotLabel, previewShotLabels } from '../stand/preview-slices';
import { CommentAvatarOccurrence, MaterialImage, PersonClaim } from './materials';
import { FactSheet, FxRates } from './facts';
import { LANDING_FOOTER_REF, OUTLET_FOOTER_REF, OUTLET_HEADER_REF } from './outlets';
import {
  CategoryPart,
  QA_CATEGORY_COUNT,
  attachmentLabels,
  categorySystemPrompt,
  categoryUsesVision,
  mergeCategoryParts,
} from './qa-categories';
import { QaReportFields, mapCategoryResponse } from './qa-response';

export const DEFAULT_DEEPSEEK_API_BASE = 'https://api.deepseek.com';
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-flash';
/** Thinking stays on, but the default high-effort budget is 64K tokens and outlives a Vercel function. */
export const DEEPSEEK_REASONING_EFFORT = 'low';
export const DEEPSEEK_MAX_OUTPUT_TOKENS = 12288;
/** One checklist item is one completion. A second try covers a timeout, an empty body, or a missing status. */
export const CATEGORY_ATTEMPTS = 2;
export const CATEGORY_CONCURRENCY = 3;
export const CATEGORY_TIMEOUT_MS = 120_000;

export interface AiInput {
  /** Legacy file dump; no longer sent to the model (page_text replaces it). */
  files: Array<{ path: string; text: string }>;
  languages: string[];
  countries: string[];
  standUrl: string | null;
  /** AIO Landing Preview Link. Null when generation was skipped or failed. Not the local stand. */
  landingPreviewUrl?: string | null;
  /** JPEGs of landingPreviewUrl, top to bottom. Empty when Chrome capture did not run. */
  previewShots?: Buffer[] | null;
  /** True when pageText is document.body.innerText of the AIO preview page. */
  previewPageText?: boolean;
  name: string;
  screenshot?: Buffer | null;
  /** Visible landing text (instruction: text copied with Ctrl+A). */
  pageText?: string;
  /** True when pageText is document.body.innerText of the rendered stand. */
  pageTextRendered?: boolean;
  /** Celebrity resolved from the land name and/or page text. */
  person?: PersonClaim;
  /** Landing images selected for the model, refs I1..I8. */
  images?: MaterialImage[];
  /** Every comment avatar from the landing HTML, including byte-identical repeats. */
  commentAvatars?: CommentAvatarOccurrence[];
  /** YYYY-MM-DD, the date of the check. */
  checkDate?: string;
  /** Header and footer of the official outlet homepage. Reference only: not a finding screenshot. */
  outlet?: { name: string; url: string; header: Buffer; footer: Buffer } | null;
  /** Bottom of the landing stand, when Chrome could capture it. */
  landingFooter?: Buffer | null;
  /** Wikipedia card for the resolved person. Null when the lookup did not run. */
  factSheet?: FactSheet | null;
  /** ECB-derived units of currency per 1 USD. Null when the lookup did not run or failed. */
  fxRates?: FxRates | null;
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

const EMPTY_PERSON: PersonClaim = { from_land_name: null, from_page_text: null, resolved: null, conflict: false };
const CATEGORIES = Array.from({ length: QA_CATEGORY_COUNT }, (_, index) => index + 1);

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
      const bundle = buildBundle(input);
      const usage: Record<string, number> = {};
      const parts = await runPool(CATEGORIES, CATEGORY_CONCURRENCY, (category) => this.categoryPart(bundle, category, usage));
      const parsed = mergeCategoryParts(parts, {
        pageText: input.pageText,
        screenshots: bundle.screenshots,
        images: bundle.images,
        commentAvatars: input.commentAvatars,
        checkDate: bundle.checkDate,
      });
      const shotUrl = bundle.shot ? desktopShotDataUrl(bundle.shot) : '';
      return {
        findings: shotUrl ? applyDesktopShot(parsed.findings, shotUrl) : parsed.findings,
        usage: Object.keys(usage).length ? usage : null,
        ...(parsed.report ? { report: parsed.report } : {}),
      };
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

  private async categoryPart(bundle: ReviewBundle, category: number, usage: Record<string, number>): Promise<CategoryPart> {
    let lastDetail = 'empty';
    for (let attempt = 1; attempt <= CATEGORY_ATTEMPTS; attempt += 1) {
      try {
        const completion = await this.openai.chat.completions.create(buildCategoryRequest(bundle, category, this.model()), {
          timeout: CATEGORY_TIMEOUT_MS,
        });
        absorbUsage(usage, plainUsage(completion.usage));
        const content = completion.choices[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim()) {
          lastDetail = 'empty';
          continue;
        }
        const mapped = mapCategoryResponse(category, parseJsonContent(content), {
          pageText: bundle.input.pageText,
          screenshots: bundle.screenshots,
        });
        if (!mapped.accepted) {
          lastDetail = 'no_status';
          continue;
        }
        return { category, accepted: true, result: mapped.result, ...(mapped.imageChecks !== undefined ? { imageChecks: mapped.imageChecks } : {}) };
      } catch (error) {
        lastDetail = error instanceof SyntaxError ? 'invalid_json' : aiFailureLabel(error);
      }
    }
    logAiFailure(`category ${category}: ${lastDetail}`);
    return { category, accepted: false };
  }

  private model(): string {
    return this.config.aiModel || DEFAULT_DEEPSEEK_MODEL;
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

interface ReviewBundle {
  input: AiInput;
  checkDate: string;
  shot: Buffer | null;
  previewLabels: string[];
  images: MaterialImage[];
  contentRefs: string[];
  commentRefs: string[];
  landingFooter: Buffer | null;
  outlet: NonNullable<AiInput['outlet']> | null;
  landingPreviewUrl: string | null;
  available: string[];
  screenshots: Record<string, string>;
  modelShots: Record<string, string>;
}

function buildBundle(input: AiInput): ReviewBundle {
  const shot = input.screenshot?.length ? input.screenshot : null;
  const previewShots = (input.previewShots ?? []).filter((item) => item.length > 0);
  const previewLabels = previewShotLabels(previewShots.length);
  const images = input.images ?? [];
  const landingFooter = input.landingFooter?.length ? input.landingFooter : null;
  const outlet = input.outlet?.header.length && input.outlet.footer.length ? input.outlet : null;
  const screenshots: Record<string, string> = {};
  if (shot) screenshots[DESKTOP_SHOT] = desktopShotDataUrl(shot);
  previewShots.forEach((item, index) => {
    screenshots[previewShotLabel(index)] = desktopShotDataUrl(item);
  });
  if (landingFooter) screenshots[LANDING_FOOTER_REF] = desktopShotDataUrl(landingFooter);
  for (const image of images) screenshots[image.ref] = imageDataUrl(image);
  const modelShots: Record<string, string> = { ...screenshots };
  if (outlet) {
    modelShots[OUTLET_HEADER_REF] = desktopShotDataUrl(outlet.header);
    modelShots[OUTLET_FOOTER_REF] = desktopShotDataUrl(outlet.footer);
  }
  return {
    input,
    checkDate: input.checkDate ?? new Date().toISOString().slice(0, 10),
    shot,
    previewLabels,
    images,
    contentRefs: images.filter((image) => image.kind !== 'comment').map((image) => image.ref),
    commentRefs: images.filter((image) => image.kind === 'comment').map((image) => image.ref),
    landingFooter,
    outlet,
    landingPreviewUrl: input.landingPreviewUrl?.trim() ? input.landingPreviewUrl.trim() : null,
    available: [
      ...(shot ? [DESKTOP_SHOT] : []),
      ...previewLabels,
      ...(landingFooter ? [LANDING_FOOTER_REF] : []),
      ...(outlet ? [OUTLET_HEADER_REF, OUTLET_FOOTER_REF] : []),
      ...images.map((image) => image.ref),
    ],
    screenshots,
    modelShots,
  };
}

function buildCategoryRequest(bundle: ReviewBundle, category: number, model: string): DeepSeekChatRequest {
  // No web_search: chat completions accepts only function tools, and the model does not run them.
  // Responses API web_search is server-side for deepseek-v4-pro and ignored on deepseek-flash.
  const labels = attachmentLabels(category, bundle.available, { content: bundle.contentRefs, comment: bundle.commentRefs });
  const labelSet = new Set(labels);
  const images = bundle.images.filter((image) => labelSet.has(image.ref));
  const userPayload = {
    category,
    check_date: bundle.checkDate,
    land_name: bundle.input.name,
    languages: bundle.input.languages,
    countries: bundle.input.countries,
    stand_url: bundle.input.standUrl,
    landing_preview_url: bundle.landingPreviewUrl,
    fx_rates: category === 6 ? bundle.input.fxRates ?? null : null,
    fact_sheet: category === 3 || category === 4 ? bundle.input.factSheet ?? null : null,
    page_text: bundle.input.pageText ?? '',
    main_person_claim: bundle.input.person ?? EMPTY_PERSON,
    outlet:
      category === 2 && bundle.outlet
        ? { name: bundle.outlet.name, url: bundle.outlet.url, header_ref: OUTLET_HEADER_REF, footer_ref: OUTLET_FOOTER_REF }
        : null,
    landing_footer_ref: labelSet.has(LANDING_FOOTER_REF) ? LANDING_FOOTER_REF : null,
    images: images.map((image) => ({
      ref: image.ref,
      file: image.file,
      alt: image.alt,
      caption: image.caption,
      context: image.context,
      kind: image.kind,
      claims_person: image.claims_person,
    })),
    attachments_order: labels,
  };
  const userText = [JSON.stringify(userPayload), ...categoryNotes(bundle, category, labels), 'ПРОВЕРЯЙ'].filter(Boolean).join('\n');
  return {
    model,
    stream: false,
    thinking: { type: 'enabled' },
    reasoning_effort: DEEPSEEK_REASONING_EFFORT,
    max_tokens: DEEPSEEK_MAX_OUTPUT_TOKENS,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: categorySystemPrompt(category) },
      {
        role: 'user',
        content: labels.length
          ? [
              { type: 'text', text: userText },
              ...labels.map((label) => ({
                type: 'image_url' as const,
                image_url: { url: bundle.modelShots[label] },
              })),
            ]
          : userText,
      },
    ],
  };
}

function categoryNotes(bundle: ReviewBundle, category: number, labels: string[]): string[] {
  const notes = [attachmentNote(labels), previewNote(bundle, category), renderedNote(bundle.input)];
  if (category === 2) notes.push(outletNote(bundle));
  const facts = factNote(bundle, category);
  if (facts) notes.push(facts);
  if (category === 3) notes.push(correspondenceNote(bundle, labels));
  if (category === 9) notes.push(commentNote(bundle, labels));
  return notes.filter((note) => note.trim().length > 0);
}

function attachmentNote(labels: string[]): string {
  if (!labels.length) {
    return 'Изображения не приложены: не делай выводов об их содержимом, в screenshot_ref ставь короткую метку места на странице.';
  }
  return `Изображения приложены к сообщению в порядке attachments_order (${labels.join(', ')}). В screenshot_ref ставь только метку из этого списка. ${OUTLET_HEADER_REF} и ${OUTLET_FOOTER_REF} в screenshot_ref не ставь, никогда не base64 и не описание.`;
}

function previewNote(bundle: ReviewBundle, category: number): string {
  if (!categoryUsesVision(category)) return '';
  const labels = bundle.previewLabels;
  if (labels.length) {
    const first = labels[0];
    const last = labels[labels.length - 1];
    const base = `Кадры ${labels.join(', ')} — страница landing_preview_url, уже снятая нашим браузером сверху вниз. ${first} — верх и шапка, ${last} — низ и футер. Эти кадры уже вложены, повторно превью не скачивай.`;
    if (category === 2) return `${base} Шапка ленда — ${first}, футер ленда — ${last}. Сверяй их с вложенными кадрами издания.`;
    if (category === 3) {
      return `${base} Ссылку сам не открывай. Сверь лицо, имя на картинке и подпись с персонажем из названия ленда. Совпало — не ошибка. Другой человек — FAIL. Лица не видно — clarifications, не FAIL.`;
    }
    if (category === 9) {
      return `${base} Явный конфликт пола аватара и имени — minor. Одно реальное фото у разных имён или одно имя с разными фото — major. Заглушка и невидимый аватар — не FAIL.`;
    }
    return base;
  }
  if (bundle.landingPreviewUrl) {
    return 'landing_preview_url есть, но кадров страницы нет: ссылка сама по себе не картинка. Не ставь визуальный FAIL и не выдумывай кадр.';
  }
  return 'Кадров превью нет. Не ставь визуальный FAIL из-за отсутствующего кадра.';
}

function outletNote(bundle: ReviewBundle): string {
  if (!bundle.outlet) {
    return 'Категория 2: скриншотов оригинала издания нет, ставь N/A и не утверждай совпадение шапки и футера. Живой сайт отсюда не открывается.';
  }
  const header = bundle.previewLabels[0] ?? (bundle.shot ? DESKTOP_SHOT : 'скриншота шапки нет');
  const footer = bundle.previewLabels.length
    ? bundle.previewLabels[bundle.previewLabels.length - 1]
    : bundle.landingFooter
      ? LANDING_FOOTER_REF
      : 'текст page_text';
  return `Категория 2: сравни шапку ленда (${header}) с ${OUTLET_HEADER_REF} и футер ленда (${footer}) с ${OUTLET_FOOTER_REF}. Это уже снятые кадры официальной главной ${bundle.outlet.name} (${bundle.outlet.url}). Совпадение утверждай только по этим кадрам.`;
}

function factNote(bundle: ReviewBundle, category: number): string {
  const geo = (bundle.input.countries ?? []).filter(Boolean).join(', ') || 'страницы';
  if (category === 3 || category === 4) {
    const person = bundle.input.factSheet?.person;
    if (person) {
      const citizenship = (person.citizenship ?? []).join(', ') || 'не указано';
      return `Категория ${category}: знаменитость для GEO ${geo} сверяется с карточкой fact_sheet.person (${person.name}, гражданство: ${citizenship}).`;
    }
    return `Категория ${category}: карточки fact_sheet.person нет. Человека не объявляй несуществующим и не пиши «fact_sheet.person отсутствует». Пустая карточка не запрещает закрыть пункт по тексту и фото. Не ставь N/A только из-за пустой карточки. Сайт отсюда не открывается: возраст, должность и гражданство без карточки не выдумывай, это clarifications.`;
  }
  if (category === 5) return 'Валюту против GEO проверяй без курса. Сумму в USD не переводи.';
  if (category === 6) {
    const fx = bundle.input.fxRates;
    return fx
      ? `Депозит в USD считай по fx_rates на ${fx.date}: сумма / rates[код].`
      : 'fx_rates нет: сумму депозита в USD не переводи.';
  }
  return '';
}

function renderedNote(input: AiInput): string {
  const offerMacro = '{{aio.visit.fields.offer_name.for_visitors}}';
  if (input.previewPageText) return 'page_text — видимый текст страницы landing_preview_url, уже снятый нашим браузером.';
  if (input.pageTextRendered && !(input.pageText ?? '').includes(offerMacro)) {
    return 'page_text — видимый текст отрисованного стенда: оффер и форма подставлены, даты скриптов уже в тексте.';
  }
  return '';
}

function correspondenceNote(bundle: ReviewBundle, labels: string[]): string {
  const claimed = bundle.images.filter((image) => image.kind !== 'comment' && image.claims_person && labels.includes(image.ref));
  const bits: string[] = [];
  if (claimed.length) {
    bits.push(
      `Проверь соответствие изображений ${claimed.map((image) => image.ref).join(', ')} персонажу из названия ленда и верни image_checks (match, mismatch или uncertain) по каждому.`,
    );
  }
  const personName = bundle.input.person?.from_land_name?.trim() || bundle.input.person?.resolved?.trim() || '';
  if (personName) {
    const frames = bundle.previewLabels.length ? bundle.previewLabels.join(', ') : 'preview и фото';
    bits.push(`Персонаж из названия ленда — «${personName}». Это имя должно быть в page_text и на кадрах ${frames}. Сверь лицо, имя на картинке и подпись.`);
  }
  return bits.join('\n');
}

function commentNote(bundle: ReviewBundle, labels: string[]): string {
  const refs = bundle.commentRefs.filter((ref) => labels.includes(ref));
  if (!refs.length) return 'Аватар комментария — не главный персонаж. Фото не видно — текстовые критерии комментариев всё равно закрой.';
  return `Изображения ${refs.join(', ')} с kind comment — фото комментаторов, не главный персонаж. Сверь их по критерию 5.`;
}

function parseJsonContent(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(trimmed);
}

function absorbUsage(total: Record<string, number>, usage: Record<string, unknown> | null): void {
  if (!usage) return;
  let counted = false;
  for (const [key, value] of Object.entries(usage)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    total[key] = (total[key] ?? 0) + value;
    counted = true;
  }
  if (counted) total.category_calls = (total.category_calls ?? 0) + 1;
}

async function runPool<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await task(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export function createAiClient(config: AppConfig): AiClient {
  if (config.aiMode === 'real' && config.aiApiKey) return new DeepSeekAiClient(config);
  return new StubAiClient();
}

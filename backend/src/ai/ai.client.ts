import OpenAI from 'openai';
import { AppConfig } from '../config';
import { AiFinding } from '../reports/report.types';
import { DESKTOP_SHOT } from '../stand/capture';
import { previewShotLabel, previewShotLabels } from '../stand/preview-slices';
import { CommentAvatarOccurrence, LandingIndexFile, MaterialImage, PersonClaim } from './materials';
import { FactSheet, FxRates } from './facts';
import { LANDING_FOOTER_REF, OUTLET_FOOTER_REF, OUTLET_HEADER_REF } from './outlets';
import { categorySystemMessage } from './qa-category-instruction';
import {
  CategoryPart,
  QA_CATEGORY_COUNT,
  VISION_CATEGORIES,
  attachmentLabels,
  categoryReadsContentFrames,
  categoryUsesVision,
  mergeCategoryParts,
} from './qa-categories';
import {
  QaReportFields,
  VisualObservation,
  imageChecksFromObservations,
  mapCategoryResponse,
  parseVisualObservations,
  readGuestRefs,
} from './qa-response';

export const DEFAULT_DEEPSEEK_API_BASE = 'https://api.deepseek.com';
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-pro';
/** Reads frames. Also the checklist model for vision categories. deepseek-v4-pro accepts image_url and discards the pixels. */
export const DEFAULT_DEEPSEEK_VISION_MODEL = 'deepseek-flash';
/** The high 64K thinking budget is not used. Effort stays low. */
export const DEEPSEEK_REASONING_EFFORT = 'low';
export const DEEPSEEK_MAX_OUTPUT_TOKENS = 12288;
/** One checklist item is one completion. A second try covers a timeout, an empty body, or a missing status. */
export const CATEGORY_ATTEMPTS = 2;
export const CATEGORY_CONCURRENCY = 3;
export const CATEGORY_TIMEOUT_MS = 120_000;

const VISION_SYSTEM = [
  'Ты только глаза. Статус PASS, FAIL или N/A не ставь. Отчёт пункта не пиши.',
  'На каждый приложенный кадр — одна запись. ref обязателен и берётся только из labels. Порядок записей — как у кадров.',
  'visible_text — текст, который читается на кадре: шапка, плашка, форма, аватар. visible_name — имя, написанное на кадре. note — короткое наблюдение на русском, без вердикта.',
  'person_match — только про человека из main_person_name: match, mismatch или uncertain. Других людей не оценивай.',
  'Имени нет — person_match не ставь и лицо не узнавай.',
  'Лица не видно — face_visible false и person_match uncertain.',
  'Фразу «без визуального осмотра» не пиши.',
  'Ответ — один JSON и ничего больше: {"observations":[{"ref":"","visible_text":"","visible_name":"","face_visible":false,"person_match":"match|mismatch|uncertain","note":""}]}',
].join('\n');

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
  /** Landing index that was read. Absent stays index.html on an image-mismatch finding. */
  indexFile?: LandingIndexFile;
  /** YYYY-MM-DD, the date of the check. */
  checkDate?: string;
  /** Header and footer of the official outlet homepage. Reference only: not a finding screenshot. */
  outlet?: { name: string; url: string; header: Buffer; footer: Buffer } | null;
  /** Bottom of the landing stand, when Chrome could capture it. */
  landingFooter?: Buffer | null;
  /** Person card for the resolved celebrity. Null when the lookup did not run. */
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
      const observations = await this.visualPass(bundle, usage);
      const parts = await runPool(CATEGORIES, CATEGORY_CONCURRENCY, (category) =>
        this.categoryPart(bundle, category, usage, observations),
      );
      const parsed = mergeCategoryParts(parts, {
        pageText: input.pageText,
        screenshots: bundle.screenshots,
        images: bundle.images,
        commentAvatars: input.commentAvatars,
        checkDate: bundle.checkDate,
        indexFile: input.indexFile,
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

  private async categoryPart(
    bundle: ReviewBundle,
    category: number,
    usage: Record<string, number>,
    observations: readonly VisualObservation[],
  ): Promise<CategoryPart> {
    let lastDetail = 'empty';
    for (let attempt = 1; attempt <= CATEGORY_ATTEMPTS; attempt += 1) {
      try {
        const completion = await this.openai.chat.completions.create(
          buildCategoryRequest(
            bundle,
            category,
            categoryUsesVision(category) ? this.visionModel() : this.model(),
            observations,
          ),
          { timeout: CATEGORY_TIMEOUT_MS },
        );
        absorbUsage(usage, plainUsage(completion.usage));
        const content = completion.choices[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim()) {
          lastDetail = 'empty';
          continue;
        }
        const parsed = parseJsonContent(content);
        const labels = attachmentLabels(category, bundle.available, {
          content: bundle.contentRefs,
          comment: bundle.commentRefs,
        });
        const mapped = mapCategoryResponse(category, parsed, {
          pageText: bundle.input.pageText,
          screenshots: bundle.screenshots,
          attachmentLabels: labels,
        });
        if (!mapped.accepted) {
          lastDetail = 'no_status';
          continue;
        }
        // Correspondence is decided by the vision pass. Checklist image_checks are ignored.
        if (category === 3) return { category, accepted: true, result: mapped.result, imageChecks: imageChecksFor(bundle, parsed, observations) };
        return { category, accepted: true, result: mapped.result };
      } catch (error) {
        lastDetail = error instanceof SyntaxError ? 'invalid_json' : aiFailureLabel(error);
      }
    }
    logAiFailure(`category ${category}: ${lastDetail}`);
    return { category, accepted: false };
  }

  /** Eyes only. A failed pass leaves an empty note list and does not cancel the checklist. */
  private async visualPass(bundle: ReviewBundle, usage: Record<string, number>): Promise<VisualObservation[]> {
    const labels = visionLabels(bundle);
    if (!labels.length) return [];
    const personName = celebrityName(bundle.input.person);
    let lastDetail = 'empty';
    for (let attempt = 1; attempt <= CATEGORY_ATTEMPTS; attempt += 1) {
      try {
        const completion = await this.openai.chat.completions.create(buildVisionRequest(bundle, labels, this.visionModel()), {
          timeout: CATEGORY_TIMEOUT_MS,
        });
        absorbUsage(usage, plainUsage(completion.usage), false);
        const content = completion.choices[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim()) {
          lastDetail = 'empty';
          continue;
        }
        return parseVisualObservations(parseJsonContent(content), labels, personName);
      } catch (error) {
        lastDetail = error instanceof SyntaxError ? 'invalid_json' : aiFailureLabel(error);
      }
    }
    logAiFailure(`vision: ${lastDetail}`);
    return [];
  }

  private model(): string {
    return this.config.aiModel || DEFAULT_DEEPSEEK_MODEL;
  }

  private visionModel(): string {
    return this.config.aiVisionModel || DEFAULT_DEEPSEEK_VISION_MODEL;
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

function buildCategoryRequest(
  bundle: ReviewBundle,
  category: number,
  model: string,
  observations: readonly VisualObservation[],
): DeepSeekChatRequest {
  // No web_search: chat completions accepts only function tools, and the model does not run them.
  // Responses API web_search is a different API and is not used for this check.
  // Vision categories attach image_url parts for their own attachments_order.
  // Categories 5–7 stay on flash. With no content frames the user message is a plain string and image_url is not invented.
  // Categories 1, 4, 8 and 11 stay a string on the text model.
  const labels = attachmentLabels(category, bundle.available, { content: bundle.contentRefs, comment: bundle.commentRefs });
  const labelSet = new Set(labels);
  const images = bundle.images.filter((image) => labelSet.has(image.ref));
  const userPayload: Record<string, unknown> = {
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
  if (categoryUsesVision(category)) userPayload.visual_observations = observationsFor(labels, observations);
  const userText = [JSON.stringify(userPayload), ...categoryNotes(bundle, category, labels), 'ПРОВЕРЯЙ'].filter(Boolean).join('\n');
  const frames = frameParts(bundle, labels);
  const plainWithoutContentFrames = categoryReadsContentFrames(category) && frames.length === 0;
  const userContent =
    categoryUsesVision(category) && !plainWithoutContentFrames
      ? [{ type: 'text' as const, text: userText }, ...frames]
      : userText;
  return {
    model,
    stream: false,
    thinking: { type: 'enabled' },
    reasoning_effort: DEEPSEEK_REASONING_EFFORT,
    max_tokens: DEEPSEEK_MAX_OUTPUT_TOKENS,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: categorySystemMessage(category) },
      { role: 'user', content: userContent },
    ],
  };
}

function frameParts(
  bundle: ReviewBundle,
  labels: readonly string[],
): Array<{ type: 'image_url'; image_url: { url: string } }> {
  const parts: Array<{ type: 'image_url'; image_url: { url: string } }> = [];
  for (const label of labels) {
    const url = bundle.modelShots[label];
    if (!url) continue;
    parts.push({ type: 'image_url', image_url: { url } });
  }
  return parts;
}

function buildVisionRequest(bundle: ReviewBundle, labels: readonly string[], model: string): DeepSeekChatRequest {
  const personName = celebrityName(bundle.input.person);
  const userText = [
    JSON.stringify({ labels, main_person_name: personName || null }),
    'Кадры приложены в порядке labels. Верни observations только по этим меткам.',
  ].join('\n');
  return {
    model,
    stream: false,
    thinking: { type: 'enabled' },
    reasoning_effort: DEEPSEEK_REASONING_EFFORT,
    max_tokens: DEEPSEEK_MAX_OUTPUT_TOKENS,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: VISION_SYSTEM },
      {
        role: 'user',
        content: [
          { type: 'text', text: userText },
          ...labels.map((label) => ({
            type: 'image_url' as const,
            image_url: { url: bundle.modelShots[label] },
          })),
        ],
      },
    ],
  };
}

function celebrityName(person: AiInput['person']): string {
  return person?.from_land_name?.trim() || person?.resolved?.trim() || '';
}

function visionLabels(bundle: ReviewBundle): string[] {
  const kinds = { content: bundle.contentRefs, comment: bundle.commentRefs };
  const want = new Set<string>();
  for (const category of VISION_CATEGORIES) {
    for (const label of attachmentLabels(category, bundle.available, kinds)) want.add(label);
  }
  return bundle.available.filter((label) => want.has(label));
}

function observationsFor(labels: readonly string[], observations: readonly VisualObservation[]): VisualObservation[] {
  const byRef = new Map(observations.map((item) => [item.ref, item]));
  const picked: VisualObservation[] = [];
  for (const label of labels) {
    const found = byRef.get(label);
    if (found) picked.push(found);
  }
  return picked;
}

function isPreviewLabel(label: string): boolean {
  return label === 'preview' || /^preview_\d+$/.test(label);
}

function imageChecksFor(bundle: ReviewBundle, parsed: unknown, observations: readonly VisualObservation[]) {
  const labels = attachmentLabels(3, bundle.available, { content: bundle.contentRefs, comment: bundle.commentRefs });
  const claimed = new Set(
    bundle.images.filter((image) => image.kind !== 'comment' && image.claims_person).map((image) => image.ref),
  );
  return imageChecksFromObservations({
    observations,
    guestRefs: readGuestRefs(parsed),
    celebrityName: celebrityName(bundle.input.person),
    claimedRefs: labels.filter((label) => claimed.has(label)),
    previewRefs: labels.filter(isPreviewLabel),
  });
}

function categoryNotes(bundle: ReviewBundle, category: number, labels: string[]): string[] {
  const notes = [attachmentNote(category, labels), previewNote(bundle, category), renderedNote(bundle.input)];
  if (category === 2) notes.push(outletNote(bundle));
  const facts = factNote(bundle, category);
  if (facts) notes.push(facts);
  if (category === 3) notes.push(correspondenceNote(bundle, labels));
  if (category === 9) notes.push(commentNote(bundle, labels));
  return notes.filter((note) => note.trim().length > 0);
}

function attachmentNote(category: number, labels: string[]): string {
  if (!labels.length) {
    if (categoryReadsContentFrames(category)) {
      return 'Кадров контента нет. Суди только по page_text и не выдумывай содержимое изображений, в screenshot_ref ставь короткую метку места на странице.';
    }
    return 'Изображения не приложены: не делай выводов об их содержимом, в screenshot_ref ставь короткую метку места на странице.';
  }
  const refs = `В screenshot_ref ставь только метку из этого списка. ${OUTLET_HEADER_REF} и ${OUTLET_FOOTER_REF} в screenshot_ref не ставь, никогда не base64 и не описание.`;
  if (categoryUsesVision(category)) {
    return `Кадры следуют в порядке attachments_order (${labels.join(', ')}). ${refs}`;
  }
  return `Пикселей в этом сообщении нет. Видимое содержимое — visual_observations по меткам attachments_order (${labels.join(', ')}). ${refs}`;
}

function previewNote(bundle: ReviewBundle, category: number): string {
  if (category !== 2 && category !== 3 && category !== 9 && category !== 10) return '';
  const labels = bundle.previewLabels;
  if (labels.length) {
    const first = labels[0];
    const last = labels[labels.length - 1];
    const base = `Кадры ${labels.join(', ')} — страница landing_preview_url, уже снятая нашим браузером сверху вниз. ${first} — верх и шапка, ${last} — низ и футер. Кадры превью приложены в этом вызове. Повторно превью не скачивай.`;
    if (category === 2) {
      return `${base} Шапка ленда — ${first}, футер ленда — ${last}. Эталон издания — outlet_header и outlet_footer, только если эти метки есть в attachments_order. Если их нет — N/A, не FAIL.`;
    }
    if (category === 3) {
      return `${base} Ссылку сам не открывай. Сверь лицо, имя на картинке и подпись с персонажем из названия ленда только там, где страница подаёт кадр как этого человека. Совпало лицо, имя на картинке и подпись — не ошибка. Кадр подан как он, а лицо или имя другие — FAIL. Лица не видно — clarifications, не FAIL. Исключение гостю интервью: если page_text называет второго участника гостем, читателем или пользователем платформы, а в записи его имя, его история или его транзакции — не FAIL и метка кадра в guest_refs. Имя из названия ленда не обязано быть на каждом кадре. Имя в записи другое, чем у этого гостя в page_text, — FAIL.`;
    }
    if (category === 9) {
      return `${base} Аватар — картинка рядом с именем. Картинка внутри текста комментария — вложение: это не второе фото этого имени и не аватар другого комментатора. Иллюстрации статьи — не аватары. Одно и то же фото у одного имени в нескольких комментариях — нормально. Явный конфликт пола аватара и имени — minor. Одно реальное фото у разных имён или одно имя с разными фото — major. Заглушка и невидимый аватар — не FAIL.`;
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
      : 'скриншота футера нет';
  return `Категория 2: сравни шапку ленда (${header}) с ${OUTLET_HEADER_REF} и футер ленда (${footer}) с ${OUTLET_FOOTER_REF}. Это уже снятые кадры официальной главной ${bundle.outlet.name} (${bundle.outlet.url}). Совпадение утверждай только по visual_observations этих меток.`;
}

function factNote(bundle: ReviewBundle, category: number): string {
  const geo = (bundle.input.countries ?? []).filter(Boolean).join(', ') || 'страницы';
  const person = category === 3 || category === 4 ? bundle.input.factSheet?.person : undefined;
  if (category === 3) {
    if (person) {
      return `Категория 3: имя, возраст, должность и цитаты page_text сверь с fact_sheet.person.extract (${person.name}). Фото сверь с именем из названия ленда. Прямое противоречие extract — FAIL. Чего extract не говорит, не называй верным.`;
    }
    return 'Категория 3: карточки fact_sheet.person нет. Имя сверяй по page_text и по фото. Возраст, должность и цитаты без extract не подтверждай и не опровергай: это clarifications. Человека не объявляй несуществующим и не пиши «fact_sheet.person отсутствует». Пустая карточка не запрещает закрыть пункт по тексту и фото. Не ставь N/A только из-за пустой карточки.';
  }
  if (category === 4) {
    const picked =
      'Если fact_sheet.person есть, это ныне живущий человек этого GEO: карточку дали Википедия или поиск до вызова. Сверь гражданство, description и extract. Умершего тёзку и человека из другой страны в карточку не кладут.';
    if (person) {
      const citizenship = (person.citizenship ?? []).join(', ') || 'не указано';
      return `Категория 4: знаменитость для GEO ${geo} сверяется с карточкой fact_sheet.person (${person.name}, гражданство: ${citizenship}). ${picked}`;
    }
    return `Категория 4: карточки fact_sheet.person нет. Человека не объявляй несуществующим и не пиши «fact_sheet.person отсутствует». Пустая карточка не запрещает закрыть пункт. Не ставь N/A только из-за пустой карточки. Сайт отсюда не открывается: гражданство без карточки не выдумывай, это clarifications. ${picked}`;
  }
  if (category === 5) return 'Валюту против GEO проверяй без курса. Сумму в USD не переводи.';
  if (category === 6) {
    const fx = bundle.input.fxRates;
    return fx
      ? `Депозит в USD считай по fx_rates на ${fx.date}: сумма / rates[код]. Кода нет в rates — N/A.`
      : 'fx_rates нет: сумму депозита в USD не переводи, статус N/A.';
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
      `Проверь соответствие изображений ${claimed.map((image) => image.ref).join(', ')} персонажу из названия ленда по visual_observations. В guest_refs перечисли метки, которые page_text подаёт как гостя, читателя или пользователя платформы. Со знаменитостью сверяй только кадр, поданный как этот человек. Имя в записи другое, чем у этого гостя в page_text, — FAIL.`,
    );
  }
  const personName = bundle.input.person?.from_land_name?.trim() || bundle.input.person?.resolved?.trim() || '';
  if (personName) {
    const frames = bundle.previewLabels.length ? bundle.previewLabels.join(', ') : 'preview и фото';
    bits.push(
      `Персонаж из названия ленда — «${personName}». Это имя должно быть в page_text. На кадрах ${frames} оно не обязано быть на каждом кадре: креатив гостя не сверяй с «${personName}». Сверь лицо, имя на картинке и подпись там, где кадр подан как этот человек.`,
    );
  }
  return bits.join('\n');
}

function commentNote(bundle: ReviewBundle, labels: string[]): string {
  const refs = bundle.commentRefs.filter((ref) => labels.includes(ref));
  if (!refs.length) return 'Аватар комментария — не главный персонаж. Фото не видно — текстовые критерии комментариев всё равно закрой. Картинка внутри текста комментария — вложение, не аватар.';
  return `Изображения ${refs.join(', ')} с kind comment — аватары рядом с именем, не главный персонаж и не вложение внутри текста комментария. Сверь их по критерию 5.`;
}

function parseJsonContent(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(trimmed);
}

function absorbUsage(total: Record<string, number>, usage: Record<string, unknown> | null, countCategory = true): void {
  if (!usage) return;
  let counted = false;
  for (const [key, value] of Object.entries(usage)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    total[key] = (total[key] ?? 0) + value;
    counted = true;
  }
  if (counted && countCategory) total.category_calls = (total.category_calls ?? 0) + 1;
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
  if (config.aiMode === 'real' && !config.aiApiKey) {
    throw new Error('DEEPSEEK_API_KEY is required');
  }
  if (config.aiMode === 'real') return new DeepSeekAiClient(config);
  return new StubAiClient();
}

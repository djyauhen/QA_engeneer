import OpenAI from 'openai';
import { AppConfig } from '../config';
import { AiFinding, AiRequestCall, AiRequests } from '../reports/report.types';
import { DESKTOP_SHOT } from '../stand/capture';
import { previewShotLabel, previewShotLabels } from '../stand/preview-slices';
import { CommentAvatarOccurrence, LandingIndexFile, MaterialImage, PersonClaim } from './materials';
import { FactSheet, FxRates } from './facts';
import { LANDING_FOOTER_REF, LANDING_HEADER_REF, OUTLET_FOOTER_REF, OUTLET_HEADER_REF } from './outlets';
import { QA_INSTRUCTION } from './qa-instruction';
import {
  CategoryPart,
  QA_CATEGORY_COUNT,
  attachmentLabels,
  categorySystemPrompt,
  categoryUsesVision,
  FRAME_TOOLS_LINE,
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
export const CATEGORY_TIMEOUT_MS = 120_000;
/** Checklist points in flight at once. A point's own retries stay sequential. */
export const DEEPSEEK_CATEGORY_CONCURRENCY = 4;

const VISION_SYSTEM = [
  'Ты только глаза. Статус PASS, FAIL или N/A не ставь. Отчёт пункта не пиши.',
  'На каждый приложенный кадр — одна запись. ref обязателен и берётся только из labels. Порядок записей — как у кадров.',
  'visible_text — текст, который читается на кадре: шапка, плашка, форма, аватар. visible_name — имя, написанное на кадре. note — короткое наблюдение на русском, без вердикта.',
  'person_match — только про человека из main_person_name: match, mismatch или uncertain. Других людей не оценивай.',
  'Если main_person_name задано, на каждом кадре, где видно лицо, ставь person_match против этого имени (match, mismatch или uncertain), даже когда имя не написано на пикселях. Лица не видно — face_visible false и person_match uncertain. Если main_person_name null, person_match не ставь.',
  'Фразу «без визуального осмотра» не пиши.',
  'Ответ — один JSON и ничего больше: {"observations":[{"ref":"preview_0","visible_text":"","visible_name":"","face_visible":false,"person_match":"uncertain","note":"лица не видно"}]}',
  'Видимый ответ — ровно один JSON-объект. Первый символ «{», последний «}». Без фразы перед объектом, без markdown-ограждения, без второго сообщения и без «сейчас проверю».',
  FRAME_TOOLS_LINE,
].join('\n');

/** Grok system file for the eye pass. DeepSeek still sends VISION_SYSTEM inside the user text. */
export function grokVisionSystem(): string {
  return [
    'Ты только глаза. Статус PASS, FAIL или N/A не ставь. Отчёт пункта не пиши.',
    'На каждый приложенный кадр — одна запись. ref обязателен и берётся только из labels. Порядок записей — как у кадров.',
    'visible_text — текст, который читается на кадре: шапка, плашка, форма, аватар. visible_name — имя, написанное на кадре. note — короткое наблюдение на русском, без вердикта.',
    'person_match — только про человека из main_person_name: match, mismatch или uncertain. Других людей не оценивай.',
    'Если main_person_name задано, на каждом кадре, где видно лицо, ставь person_match против этого имени (match, mismatch или uncertain), даже когда имя не написано на пикселях. Лица не видно — face_visible false и person_match uncertain. Если main_person_name null, person_match не ставь.',
    'Фразу «без визуального осмотра» не пиши.',
    'Ответ — один JSON и ничего больше:',
    '{"observations":[{"ref":"preview_0","visible_text":"","visible_name":"","face_visible":false,"person_match":"uncertain","note":"лица не видно"}]}',
    'ref — только метка из labels. Если main_person_name null, поле person_match не включай.',
    'Видимый ответ — ровно один JSON-объект. Первый символ {, последний }. После } ничего нет.',
  ].join('\n');
}

const GROK_VISION_TOOLS_LINE =
  'Не вызывай grep, monitor, list_dir и search_tool. page_text уже в этом промпте. Кадры — только строки в конце промпта, которые начинаются с @ и кончаются на .jpg. Метка в JSON — имя этого файла без @ и без .jpg. Открой каждый такой файл один раз через read_file, все в одном сообщении, и смотри как изображение. Каталог не листай. Нет таких строк — пиксели не выдумывай. Пиксели не видны — кадр не выдумывай: face_visible false и эта фраза в note записи. Статус не ставь.';

const GROK_CATEGORY_TOOLS_LINE =
  'Не вызывай инструменты, в том числе read_file, list_dir, grep и monitor. page_text уже в этом промпте. Кадры глаз уже записаны в visual_observations. Пиксель, которого там нет, не выдумывай. quote — дословная подстрока page_text; нет такой подстроки — finding не пиши.';

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
  /** Header crop of the landing stand. A missing header element falls back to the top of the document. */
  landingHeader?: Buffer | null;
  /** Bottom crop of the landing stand, when Chrome could capture it. */
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
  /** Requests built for this DeepSeek review. Stub reviews omit it. */
  ai_requests?: AiRequests;
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

function isAiCallOrGrokSession(error: unknown): boolean {
  return error instanceof AiCallError || (error instanceof Error && error.name === 'GrokSessionError');
}

export class StubAiClient extends AiClient {
  async review(): Promise<AiResult> {
    return { findings: [], usage: null, skipped: true };
  }
}

/** Official OpenAI types include reasoning_effort and omit DeepSeek thinking. */
export type DeepSeekChatRequest = OpenAI.Chat.ChatCompletionCreateParamsNonStreaming & {
  thinking: { type: 'enabled' };
};

type ChatContent =
  | string
  | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: ChatContent };

function copyChatMessage(message: ChatMessage): ChatMessage {
  if (typeof message.content === 'string') return { role: message.role, content: message.content };
  return {
    role: message.role,
    content: message.content.map((part) =>
      part.type === 'text'
        ? { type: 'text', text: part.text }
        : { type: 'image_url', image_url: { url: part.image_url.url } },
    ),
  };
}

/** A few workers share the list. Results stay in input order. One item occupies one worker until it settles. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;
  const lanes = Math.max(1, Math.min(limit, items.length));
  const runLane = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  };
  await Promise.all(Array.from({ length: lanes }, () => runLane()));
  return results;
}

export class DeepSeekAiClient extends AiClient {
  private readonly openai: OpenAI;

  constructor(
    protected readonly config: AppConfig,
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
    const trace = emptyRequestTrace();
    try {
      const bundle = buildBundle(input);
      const usage: Record<string, number> = {};
      const messages: ChatMessage[] = [{ role: 'system', content: QA_INSTRUCTION }];
      const frames = conversationFrames(bundle);
      const modelFor = (category?: number): string => {
        if (frames.length) return this.visionModel();
        return category != null && categoryUsesVision(category) ? this.visionModel() : this.model();
      };
      let observations: VisualObservation[] = [];
      if (frames.length) {
        const user = visionUser(bundle, frames);
        const seen = await this.ask(messages, user, modelFor(), usage, trace, bundle.modelShots, 'vision', (content) => {
          const parsed = parseJsonContent(content);
          return { raw: content, observations: parseVisualObservations(parsed, frames, celebrityName(bundle.input.person)) };
        });
        if (seen) {
          messages.push(user, { role: 'assistant', content: seen.raw });
          observations = seen.observations;
        } else {
          messages.push(user);
        }
        this.afterTurn();
      }
      const parts = await mapWithConcurrency(CATEGORIES, this.categoryConcurrency(), async (category) => {
        const history = messages.map(copyChatMessage);
        const user = categoryUser(bundle, category, observations);
        try {
          const seen = await this.ask(history, user, modelFor(category), usage, trace, bundle.modelShots, 'category', (content) => {
            const parsed = parseJsonContent(content);
            const labels = attachmentLabels(category, bundle.available, shotKinds(bundle));
            const mapped = mapCategoryResponse(category, parsed, {
              pageText: bundle.input.pageText,
              screenshots: bundle.screenshots,
              attachmentLabels: labels,
            });
            if (!mapped.accepted) return null;
            const imageChecks =
              category === 3 ? imageChecksFor(bundle, parsed, observations) : undefined;
            return { raw: content, mapped, imageChecks };
          }, category);
          if (!seen) return { category, accepted: false };
          return {
            category,
            accepted: true,
            result: seen.mapped.result,
            ...(category === 3 ? { imageChecks: seen.imageChecks } : {}),
          };
        } catch (error) {
          if (!isAiCallOrGrokSession(error)) throw error;
          const detail = error instanceof AiCallError ? error.detail : aiFailureLabel(error);
          logAiFailure(`category ${category}: ${detail}`);
          return { category, accepted: false };
        } finally {
          this.afterTurn();
        }
      });
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
        ai_requests: finishRequestTrace(trace),
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

  /** Subclasses may observe a settled turn. Grok does not require a server session. */
  protected afterTurn(): void {}

  /** Checklist points in flight. Grok overrides this; a point's retries stay inside ask(). */
  protected categoryConcurrency(): number {
    return DEEPSEEK_CATEGORY_CONCURRENCY;
  }

  private async ask<T>(
    history: readonly ChatMessage[],
    user: ChatMessage,
    model: string,
    usage: Record<string, number>,
    trace: RequestTrace,
    modelShots: Record<string, string>,
    kind: 'vision' | 'category',
    accept: (content: string) => T | null,
    category?: number,
  ): Promise<T | null> {
    let lastDetail = 'empty';
    const countCategory = kind === 'category';
    for (let attempt = 1; attempt <= CATEGORY_ATTEMPTS; attempt += 1) {
      try {
        const request = chatRequest(model, pixelsOnlyOnLastUser([...history, user]));
        rememberSentRequest(trace, request, modelShots, kind, category);
        const completion = await this.complete(request);
        absorbUsage(usage, completion.usage, countCategory);
        const content = completion.content;
        if (typeof content !== 'string' || !content.trim()) {
          lastDetail = 'empty';
          continue;
        }
        const accepted = accept(content);
        if (!accepted) {
          lastDetail = 'no_status';
          continue;
        }
        return accepted;
      } catch (error) {
        if (isAiCallOrGrokSession(error)) throw error;
        lastDetail = error instanceof SyntaxError ? 'invalid_json' : aiFailureLabel(error);
      }
    }
    logAiFailure(kind === 'vision' ? `vision: ${lastDetail}` : `category ${category}: ${lastDetail}`);
    return null;
  }

  /** Chat completion. Grok Build replaces this with one self-contained CLI call. */
  protected async complete(
    request: DeepSeekChatRequest,
  ): Promise<{ content: string; usage: Record<string, unknown> | null }> {
    const completion = await this.openai.chat.completions.create(request, { timeout: CATEGORY_TIMEOUT_MS });
    const content = completion.choices[0]?.message?.content;
    return {
      content: typeof content === 'string' ? content : '',
      usage: plainUsage(completion.usage),
    };
  }

  protected model(): string {
    return this.config.aiModel || DEFAULT_DEEPSEEK_MODEL;
  }

  protected visionModel(): string {
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
  return `${name}${status}${safeCode(error)}${safeLogHint(error)}`;
}

/** Exit code and one already-sanitized stderr line. Anything else stays out of the log. */
function safeLogHint(error: object): string {
  if (!('logHint' in error) || typeof error.logHint !== 'string') return '';
  const hint = error.logHint.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!hint || hint.length > 220) return '';
  if (/(?:^|\s)(?:-p|--system-prompt|--disallowed-tools|--cwd)\b/.test(hint)) return '';
  if (/\b(?:sk|xai)-[A-Za-z0-9_-]{8,}\b|\bBearer\s+\S+/i.test(hint)) return '';
  if (!/^(?:exit \d{1,3}|timeout)(?:: .+)?$/.test(hint)) return '';
  return ` ${hint}`;
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
  proofRefs: string[];
  heroRef: string | null;
  landingHeader: Buffer | null;
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
  const heroRef = images.find((image) => image.kind !== 'comment' && image.claims_person)?.ref ?? null;
  const landingHeader = input.landingHeader?.length ? input.landingHeader : null;
  const landingFooter = input.landingFooter?.length ? input.landingFooter : null;
  const outlet = input.outlet?.header.length && input.outlet.footer.length ? input.outlet : null;
  const screenshots: Record<string, string> = {};
  if (shot) screenshots[DESKTOP_SHOT] = desktopShotDataUrl(shot);
  previewShots.forEach((item, index) => {
    screenshots[previewShotLabel(index)] = desktopShotDataUrl(item);
  });
  if (landingHeader) screenshots[LANDING_HEADER_REF] = desktopShotDataUrl(landingHeader);
  if (landingFooter) screenshots[LANDING_FOOTER_REF] = desktopShotDataUrl(landingFooter);
  for (const image of images) screenshots[image.ref] = imageDataUrl(image);
  const modelShots: Record<string, string> = {};
  if (previewLabels.length) {
    for (const label of previewLabels) modelShots[label] = screenshots[label];
  } else if (shot) {
    modelShots[DESKTOP_SHOT] = screenshots[DESKTOP_SHOT];
  }
  for (const image of images) {
    if (screenshots[image.ref]) modelShots[image.ref] = screenshots[image.ref];
  }
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
    commentRefs: images.filter((image) => image.kind === 'comment' && !image.proof).map((image) => image.ref),
    proofRefs: images.filter((image) => image.proof).map((image) => image.ref),
    heroRef,
    landingHeader,
    landingFooter,
    outlet,
    landingPreviewUrl: input.landingPreviewUrl?.trim() ? input.landingPreviewUrl.trim() : null,
    available: [
      ...(shot ? [DESKTOP_SHOT] : []),
      ...previewLabels,
      ...(landingHeader ? [LANDING_HEADER_REF] : []),
      ...(landingFooter ? [LANDING_FOOTER_REF] : []),
      ...(outlet ? [OUTLET_HEADER_REF, OUTLET_FOOTER_REF] : []),
      ...images.map((image) => image.ref),
    ],
    screenshots,
    modelShots,
  };
}

function chatRequest(model: string, messages: ChatMessage[]): DeepSeekChatRequest {
  return {
    model,
    stream: false,
    thinking: { type: 'enabled' },
    reasoning_effort: DEEPSEEK_REASONING_EFFORT,
    temperature: 0,
    max_tokens: DEEPSEEK_MAX_OUTPUT_TOKENS,
    response_format: { type: 'json_object' },
    messages: messages as DeepSeekChatRequest['messages'],
  };
}

function imageMeta(bundle: ReviewBundle): Array<Record<string, unknown>> {
  return bundle.images.map((image) => ({
    ref: image.ref,
    file: image.file,
    alt: image.alt,
    caption: image.caption,
    context: image.context,
    kind: image.kind,
    claims_person: image.claims_person,
  }));
}

function conversationFrames(bundle: ReviewBundle): string[] {
  const labels: string[] = [];
  if (bundle.previewLabels.length) {
    for (const label of bundle.previewLabels) {
      if (bundle.modelShots[label]) labels.push(label);
    }
  } else if (bundle.shot && bundle.modelShots[DESKTOP_SHOT]) {
    labels.push(DESKTOP_SHOT);
  }
  for (const image of bundle.images) {
    if (bundle.modelShots[image.ref]) labels.push(image.ref);
  }
  if (bundle.outlet && bundle.modelShots[OUTLET_HEADER_REF] && bundle.modelShots[OUTLET_FOOTER_REF]) {
    labels.push(OUTLET_HEADER_REF, OUTLET_FOOTER_REF);
  }
  return labels;
}

function visionUser(bundle: ReviewBundle, labels: readonly string[]): ChatMessage {
  const personName = celebrityName(bundle.input.person);
  const text = [
    JSON.stringify({
      page_text: bundle.input.pageText ?? '',
      labels,
      main_person_name: personName || null,
      land_name: bundle.input.name,
      languages: bundle.input.languages,
      countries: bundle.input.countries,
      check_date: bundle.checkDate,
      landing_preview_url: bundle.landingPreviewUrl,
      images: imageMeta(bundle),
    }),
    VISION_SYSTEM,
    visionFrameLine(labels),
  ].join('\n');
  return {
    role: 'user',
    content: [
      { type: 'text', text },
      ...labels.map((label) => ({
        type: 'image_url' as const,
        image_url: { url: bundle.modelShots[label] },
      })),
    ],
  };
}

function visionFrameLine(labels: readonly string[]): string {
  const page = labels.filter((label) => label !== OUTLET_HEADER_REF && label !== OUTLET_FOOTER_REF);
  const outlet = `outlet_header и outlet_footer — чужой сайт, только если эти метки есть. Верни observations только по этим меткам.`;
  if (page.length > 0 && page.every(isPreviewLabel)) {
    return `Кадры приложены в порядке labels и покрывают всю высоту страницы сверху вниз. ${outlet}`;
  }
  const slices = page.filter(isPreviewLabel);
  if (slices.length > 0) {
    const rest = page.filter((label) => !isPreviewLabel(label));
    return `Кадры приложены в порядке labels. Срезы ${slices.join(', ')} покрывают всю высоту страницы сверху вниз. ${rest.join(', ')} — фото, приложенное следом. ${outlet}`;
  }
  return `Приложенные файлы — метки этого сообщения, по порядку (${labels.join(', ')}). ${outlet}`;
}

function categoryUser(
  bundle: ReviewBundle,
  category: number,
  observations: readonly VisualObservation[],
): ChatMessage {
  const text = categoryUserText(bundle, category, observations);
  const labels = attachmentLabels(category, bundle.available, shotKinds(bundle));
  if (!categoryUsesVision(category) || !labels.length) return { role: 'user', content: text };
  return {
    role: 'user',
    content: [
      { type: 'text', text },
      ...labels.flatMap((label) => {
        const url = bundle.modelShots[label];
        if (!url) return [];
        return [{ type: 'image_url' as const, image_url: { url } }];
      }),
    ],
  };
}

function categoryUserText(
  bundle: ReviewBundle,
  category: number,
  observations: readonly VisualObservation[],
): string {
  const labels = attachmentLabels(category, bundle.available, shotKinds(bundle));
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
    landing_header_ref: null,
    landing_footer_ref: null,
    images: imageMeta(bundle),
    attachments_order: labels,
  };
  if (categoryUsesVision(category)) userPayload.visual_observations = observationsFor(labels, observations);
  return [JSON.stringify(userPayload), categorySystemPrompt(category), ...categoryNotes(bundle, category, labels), 'ПРОВЕРЯЙ']
    .filter(Boolean)
    .join('\n');
}

function celebrityName(person: AiInput['person']): string {
  return person?.from_land_name?.trim() || person?.resolved?.trim() || '';
}

function shotKinds(bundle: ReviewBundle): { content: string[]; comment: string[]; proof: string[]; hero: string | null } {
  return { content: bundle.contentRefs, comment: bundle.commentRefs, proof: bundle.proofRefs, hero: bundle.heroRef };
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
  const labels = attachmentLabels(3, bundle.available, shotKinds(bundle));
  const content = new Set(bundle.contentRefs);
  const checks = imageChecksFromObservations({
    observations,
    guestRefs: readGuestRefs(parsed),
    celebrityName: celebrityName(bundle.input.person),
    claimedRefs: labels.filter((label) => content.has(label)),
    previewRefs: labels.filter(isPreviewLabel),
  });
  const hero = bundle.images.find((image) => image.kind !== 'comment' && image.claims_person);
  if (!hero || checks.some((check) => check.ref === hero.ref)) return checks;
  const rank = (match: string): number => (match === 'mismatch' ? 2 : match === 'uncertain' ? 1 : 0);
  const face = [...checks].sort((left, right) => rank(right.match) - rank(left.match))[0];
  if (!face) return checks;
  return [...checks, face.note ? { ref: hero.ref, match: face.match, note: face.note } : { ref: hero.ref, match: face.match }];
}

function categoryNotes(bundle: ReviewBundle, category: number, labels: string[]): string[] {
  const notes = [attachmentNote(category, labels), previewNote(bundle, category, labels), renderedNote(bundle.input)];
  if (category === 2) notes.push(outletNote(bundle, labels));
  const facts = factNote(bundle, category);
  if (facts) notes.push(facts);
  if (category === 3) notes.push(correspondenceNote(bundle, labels));
  if (category === 9) notes.push(commentNote(bundle, labels));
  return notes.filter((note) => note.trim().length > 0);
}

function attachmentNote(category: number, labels: string[]): string {
  if (!categoryUsesVision(category)) {
    return `Пункт ${category} судит page_text. Кадры к этому пункту не приложены. Визуальный FAIL не ставь и не пиши, что изображения не были предоставлены.`;
  }
  if (!labels.length) {
    return `Пункт ${category}. У этого вызова кадров нет. Суди page_text и не выдумывай содержимое изображений, в screenshot_ref ставь короткую метку места на странице.`;
  }
  const refs = `В screenshot_ref ставь только метку из этого списка. ${OUTLET_HEADER_REF} и ${OUTLET_FOOTER_REF} в screenshot_ref не ставь, никогда не base64 и не описание.`;
  return `Кадры этого сообщения приложены сразу после текста, attachments_order (${labels.join(', ')}). ${refs}`;
}

function pageLabels(labels: readonly string[]): string[] {
  return labels.filter((label) => label !== OUTLET_HEADER_REF && label !== OUTLET_FOOTER_REF);
}

function previewNote(bundle: ReviewBundle, category: number, labels: string[]): string {
  if (category === 2) {
    const slices = bundle.previewLabels.length ? bundle.previewLabels : pageLabels(labels);
    const tail =
      'Рядом outlet_header и outlet_footer, только если эти метки есть в attachments_order. Отдельных кропов шапки ленда нет. Повторно сайт издания не открывай.';
    if (slices.length >= 2) {
      return `Пункт 2. Шапка ленда — ${slices[0]}, футер ленда — ${slices[slices.length - 1]}. ${tail}`;
    }
    if (slices.length === 1) {
      return `Пункт 2. Шапка ленда — ${slices[0]}. Футер ленда в этом вызове отсутствует. ${tail}`;
    }
    return `Пункт 2. Шапка ленда — среза страницы нет, футер ленда — среза страницы нет. ${tail}`;
  }
  if (category === 3) {
    if (!labels.length) {
      return 'Пункт 3. Вложения нет: лицо не выдумывай, guest_refs оставь пустым. Ссылку сам не открывай.';
    }
    return `Пункт 3. ${labels.join(', ')} — фото, приложенные сразу после этого сообщения (срезы preview, desktop или файлы картинок вроде I1). Сверь лицо и подпись. Совпало лицо и подпись — не ошибка. Кадр подан как он, а лицо другое — FAIL. Лица не видно — clarifications, не FAIL. Ссылку сам не открывай.`;
  }
  if (category === 9) {
    const avatarRules =
      'Аватар — картинка рядом с именем. Картинка внутри текста комментария — вложение: это не второе фото этого имени и не аватар другого комментатора. Иллюстрации статьи — не аватары. Одно и то же фото у одного имени в нескольких комментариях — нормально. Явный конфликт пола аватара и имени — minor. Одно реальное фото у разных имён или одно имя с разными фото — major. Заглушка и невидимый аватар — не FAIL.';
    const files = labels.filter((label) => bundle.commentRefs.includes(label));
    const pages = labels.filter((label) => isPreviewLabel(label) || label === DESKTOP_SHOT);
    if (files.length && pages.length) {
      return `Пункт 9 смотрит аватары на срезах ${pages.join(', ')} и на файлах комментариев ${files.join(', ')}, приложенных сразу после текста этого сообщения. ${avatarRules}`;
    }
    if (files.length) {
      return `Пункт 9 смотрит аватары на приложенных файлах ${files.join(', ')}, сразу после текста этого сообщения. ${avatarRules}`;
    }
    if (pages.length) {
      return `Пункт 9 смотрит аватары на срезах страницы, приложенных сразу после текста этого сообщения, отдельных файлов аватаров нет. ${avatarRules}`;
    }
    return `Пункт 9. Кадров аватаров в этом вызове нет. Пять критериев текста закрой по page_text. ${avatarRules}`;
  }
  if (category !== 10) return '';
  const slices = bundle.previewLabels;
  if (slices.length) {
    const first = slices[0];
    const last = slices[slices.length - 1];
    const files = labels.filter((label) => bundle.contentRefs.includes(label) || bundle.proofRefs.includes(label));
    const native = files.length
      ? ` Файлы ${files.join(', ')} — сами картинки: текст на них сверяй с подписью, не только со срезом.`
      : '';
    return `Кадры ${slices.join(', ')} — страница landing_preview_url, уже снятая нашим браузером сверху вниз без пропусков. ${first} — верх и шапка, ${last} — низ и футер. Эти кадры приложены сразу после текста этого сообщения.${native} Повторно превью не скачивай.`;
  }
  if (labels.length) {
    return `Приложенные файлы ${labels.join(', ')} — метки этого сообщения, по порядку. По ним и суди. Повторно превью не скачивай.`;
  }
  if (bundle.landingPreviewUrl) {
    return 'landing_preview_url есть, но кадров страницы нет: ссылка сама по себе не картинка. Не ставь визуальный FAIL и не выдумывай кадр.';
  }
  return 'Кадров превью нет. Не ставь визуальный FAIL из-за отсутствующего кадра.';
}

function outletNote(bundle: ReviewBundle, labels: string[]): string {
  if (!bundle.outlet) {
    return 'Категория 2: скриншотов оригинала издания нет, ставь N/A и не утверждай совпадение шапки и футера. Живой сайт отсюда не открывается.';
  }
  const slices = bundle.previewLabels.length ? bundle.previewLabels : pageLabels(labels);
  const tail = `Это уже снятые кадры официальной главной ${bundle.outlet.name} (${bundle.outlet.url}). Совпадение утверждай только по visual_observations этих меток.`;
  if (slices.length === 1) {
    const header = slices[0];
    return `Категория 2: сравни шапку (${header}) с ${OUTLET_HEADER_REF}. Футер ленда в этом вызове отсутствует: ${header} футером не называй и низ с ${OUTLET_FOOTER_REF} не сравнивай. ${tail}`;
  }
  const header = slices[0] ?? 'среза шапки нет';
  const footer = slices[slices.length - 1] ?? 'среза футера нет';
  return `Категория 2: сравни верх страницы (${header}) с ${OUTLET_HEADER_REF} и низ страницы (${footer}) с ${OUTLET_FOOTER_REF}. ${tail}`;
}

function factNote(bundle: ReviewBundle, category: number): string {
  const geo = (bundle.input.countries ?? []).filter(Boolean).join(', ') || 'страницы';
  const person = category === 3 || category === 4 ? bundle.input.factSheet?.person : undefined;
  if (category === 3) {
    if (person) {
      return `Категория 3: имя, возраст, должность и цитаты page_text сверь с fact_sheet.person.extract (${person.name}). extract — уже полученная поиском биография. Фото сверь с именем из названия ленда. Прямое противоречие extract — FAIL. Чего extract не говорит, не называй верным и не делай FAIL: это clarifications.`;
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
  const personName = bundle.input.person?.from_land_name?.trim() || bundle.input.person?.resolved?.trim() || '';
  if (personName && labels.length) {
    return `Персонаж из названия ленда — «${personName}». Это имя должно быть в page_text. ${labels.join(', ')} — фото, приложенные сразу после этого сообщения (срезы preview, desktop или файлы картинок вроде I1). Сверь лицо и подпись. Если page_text подаёт человека как гостя, читателя или пользователя платформы, не FAIL и верни метку в guest_refs.`;
  }
  if (personName) {
    return `Персонаж из названия ленда — «${personName}». Это имя должно быть в page_text. Вложения нет, лицо не выдумывай, guest_refs оставь пустым.`;
  }
  return '';
}

function commentNote(bundle: ReviewBundle, labels: string[]): string {
  if (!labels.length) return 'Аватар комментария — не главный персонаж. Фото не видно — текстовые критерии комментариев всё равно закрой. Картинка внутри текста комментария — вложение, не аватар.';
  const files = labels.filter((label) => bundle.commentRefs.includes(label));
  const pages = labels.filter((label) => isPreviewLabel(label) || label === DESKTOP_SHOT);
  const where = [
    pages.length ? `срезах ${pages.join(', ')}` : '',
    files.length ? `файлах комментариев ${files.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' и на ');
  return `Аватары смотри на ${where || labels.join(', ')}, приложенных сразу после текста этого сообщения. Аватар — картинка рядом с именем, не главный персонаж и не вложение внутри текста комментария.`;
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

interface RequestTrace {
  shots: Record<string, string>;
  vision?: AiRequestCall;
  categories: Array<AiRequestCall | undefined>;
}

function emptyRequestTrace(): RequestTrace {
  return { shots: {}, categories: Array.from({ length: QA_CATEGORY_COUNT }) };
}

function finishRequestTrace(trace: RequestTrace): AiRequests {
  const calls: AiRequestCall[] = [];
  if (trace.vision) calls.push(trace.vision);
  for (let category = 1; category <= QA_CATEGORY_COUNT; category += 1) {
    const call = trace.categories[category - 1];
    if (call) calls.push(call);
  }
  return { shots: trace.shots, calls };
}

/** Reads the request object passed to the API. A retry keeps the first built call. */
function rememberSentRequest(
  trace: RequestTrace,
  request: DeepSeekChatRequest,
  modelShots: Record<string, string>,
  kind: 'vision' | 'category',
  category?: number,
): void {
  if (kind === 'vision') {
    if (trace.vision) return;
  } else if (category == null || category < 1 || category > QA_CATEGORY_COUNT || trace.categories[category - 1]) {
    return;
  }
  const userContent = lastUserContent(request);
  const urls = imageUrlsOf(userContent);
  const labels = declaredLabels(textOf(userContent), kind);
  const read = framesFromSentRequest(urls, labels, modelShots);
  if (!read.attachments.length) read.attachments = labels;
  const call: AiRequestCall = {
    kind,
    model: typeof request.model === 'string' ? request.model : '',
    system: systemText(messageContent(request, 0)),
    pixels: urls.length > 0,
    attachments: read.attachments,
  };
  if (kind === 'category') call.category = category;
  for (const frame of read.frames) {
    if (!trace.shots[frame.label]) trace.shots[frame.label] = frame.url;
  }
  if (kind === 'vision') trace.vision = call;
  else trace.categories[category! - 1] = call;
}

function messageContent(request: DeepSeekChatRequest, index: number): unknown {
  const message = request.messages[index] as { content?: unknown } | undefined;
  return message?.content;
}

function lastUserContent(request: DeepSeekChatRequest): unknown {
  const messages = request.messages;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as { role?: string; content?: unknown };
    if (message?.role === 'user') return message.content;
  }
  return undefined;
}

function systemText(content: unknown): string {
  return typeof content === 'string' ? content : '';
}

/** Earlier user turns keep their text. Pixels stay on the latest user message only. */
function pixelsOnlyOnLastUser(messages: ChatMessage[]): ChatMessage[] {
  let lastUser = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      lastUser = index;
      break;
    }
  }
  return messages.map((message, index) => {
    if (message.role !== 'user' || index === lastUser || typeof message.content === 'string') return message;
    return { role: 'user', content: textOf(message.content) };
  });
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const typed = part as { type?: unknown; text?: unknown };
    if (typed.type === 'text' && typeof typed.text === 'string') return typed.text;
  }
  return '';
}

function imageUrlsOf(content: unknown): Array<string | undefined> {
  if (!Array.isArray(content)) return [];
  const urls: Array<string | undefined> = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const typed = part as { type?: unknown; image_url?: { url?: unknown } };
    if (typed.type !== 'image_url') continue;
    const url = typed.image_url?.url;
    urls.push(typeof url === 'string' ? url : undefined);
  }
  return urls;
}

function declaredLabels(text: string, kind: 'vision' | 'category'): string[] {
  const line = text.split('\n', 1)[0]?.trim() ?? '';
  if (!line.startsWith('{')) return [];
  try {
    const parsed = JSON.parse(line) as { labels?: unknown; attachments_order?: unknown };
    const raw = kind === 'vision' ? parsed.labels : parsed.attachments_order;
    if (!Array.isArray(raw)) return [];
    return raw.filter((item): item is string => typeof item === 'string' && item.length > 0);
  } catch {
    return [];
  }
}

function framesFromSentRequest(
  urls: ReadonlyArray<string | undefined>,
  order: readonly string[],
  modelShots: Record<string, string>,
): { attachments: string[]; frames: Array<{ label: string; url: string }> } {
  const consumed = new Set<string>();
  const attachments: string[] = [];
  const frames: Array<{ label: string; url: string }> = [];
  const pool = Object.keys(modelShots);
  for (const url of urls) {
    const label = takeLabel(order, modelShots, url, consumed) ?? takeLabel(pool, modelShots, url, consumed);
    if (!label) continue;
    consumed.add(label);
    attachments.push(label);
    if (typeof url === 'string' && isDataImage(url)) frames.push({ label, url });
  }
  return { attachments, frames };
}

function takeLabel(
  candidates: readonly string[],
  modelShots: Record<string, string>,
  url: string | undefined,
  consumed: Set<string>,
): string | undefined {
  if (typeof url === 'string' && url.length > 0) {
    return candidates.find((label) => !consumed.has(label) && modelShots[label] === url);
  }
  return candidates.find((label) => !consumed.has(label) && !modelShots[label]);
}

function isDataImage(url: string): boolean {
  return /^data:image\/[^;,]+;base64,/i.test(url);
}

/**
 * One self-contained Grok Build prompt. System stays out of -p.
 * The prompt file is only the current user turn. Vision notes travel inside that turn's JSON.
 * JPEG bytes are only for the current user. The CLI prompt gets @names, not base64.
 */
export function grokPromptParts(request: DeepSeekChatRequest): {
  system: string;
  text: string;
  kind: 'vision' | 'category';
  category: number | null;
  frames: Array<{ name: string; bytes: Buffer }>;
} {
  const messages = request.messages as Array<{ role?: string; content?: unknown }>;
  const system = systemText(messageContent(request, 0));
  let lastUser = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      lastUser = index;
      break;
    }
  }
  const userContent = lastUser >= 0 ? messages[lastUser]?.content : undefined;
  const userText = textOf(userContent);
  const kind: 'vision' | 'category' =
    userText.trimStart().startsWith('{') && /"labels"\s*:/.test(userText) && !/"category"\s*:/.test(userText) ? 'vision' : 'category';
  const category = categoryField(userText);
  let text = userText.replace(DATA_IMAGE_IN_TEXT, '');
  if (text.endsWith('\nПРОВЕРЯЙ')) text = text.slice(0, -'\nПРОВЕРЯЙ'.length);
  if (kind === 'vision') text = text.replace(VISION_SYSTEM, '');
  text = text.replaceAll(FRAME_TOOLS_LINE, kind === 'vision' ? GROK_VISION_TOOLS_LINE : GROK_CATEGORY_TOOLS_LINE);
  const labels = declaredLabels(userText, kind);
  const urls = imageUrlsOf(userContent);
  const frames: Array<{ name: string; bytes: Buffer }> = [];
  const count = Math.min(labels.length, urls.length);
  for (let index = 0; index < count; index += 1) {
    const bytes = decodeDataImage(urls[index]);
    if (!bytes?.length) continue;
    frames.push({ name: frameFileName(labels[index], index), bytes });
  }
  return { system, text, kind, category, frames };
}

function categoryField(userText: string): number | null {
  const line = userText.split('\n', 1)[0]?.trim() ?? '';
  if (!line.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(line) as { category?: unknown };
    return typeof parsed.category === 'number' && Number.isInteger(parsed.category) ? parsed.category : null;
  } catch {
    return null;
  }
}

const DATA_IMAGE_IN_TEXT = /data:image\/[^;,]+;base64,[A-Za-z0-9+/=]+/gi;

function decodeDataImage(url: string | undefined): Buffer | null {
  if (!url) return null;
  const match = /^data:image\/[^;,]+;base64,([A-Za-z0-9+/=]+)$/i.exec(url);
  if (!match) return null;
  return Buffer.from(match[1], 'base64');
}

function frameFileName(label: string, index: number): string {
  const safe = label.replace(/[^A-Za-z0-9_-]+/g, '').slice(0, 40);
  return `${safe || `frame_${index + 1}`}.jpg`;
}

export function createAiClient(config: AppConfig): AiClient {
  if (config.aiMode === 'real' && !config.aiApiKey) {
    throw new Error('DEEPSEEK_API_KEY is required');
  }
  if (config.aiMode === 'real') return new DeepSeekAiClient(config);
  return new StubAiClient();
}

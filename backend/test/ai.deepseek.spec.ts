import {
  DeepSeekAiClient,
  StubAiClient,
  applyDesktopShot,
  completeFindings,
  createAiClient,
  desktopShotDataUrl,
  DEFAULT_DEEPSEEK_API_BASE,
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_DEEPSEEK_VISION_MODEL,
  DEEPSEEK_MAX_OUTPUT_TOKENS,
  DEEPSEEK_REASONING_EFFORT,
} from '../src/ai/ai.client';
import { MaterialImage } from '../src/ai/materials';
import { categorySystemMessage } from '../src/ai/qa-category-instruction';
import { GAP_NOTE, QA_CATEGORY_COUNT, categorySystemPrompt } from '../src/ai/qa-categories';
import { QA_INSTRUCTION } from '../src/ai/qa-instruction';
import { PREVIEW_SHOT, captureStandJpeg, wantsVisualCapture } from '../src/stand/capture';
import { resolveChromeExecutable } from '../src/stand/chrome-path';
import { standFormHtml } from '../src/stand/form-html';
import { AppConfig, loadConfig } from '../src/config';

function deepseekConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    storage: 'memory',
    databaseUrl: '',
    aioToken: 'test-aio-token-value',
    aioBaseUrl: 'https://app.aio.tech',
    aioStorageHosts: [],
    tlLogin: 'env-tl',
    tlPassword: 'env-tl-pass',
    workDir: '.',
    port: 0,
    publicBaseUrl: 'http://127.0.0.1',
    standFormHtml: '',
    standBrandName: 'Brand',
    standCdnBase: '',
    catalogAutoRefresh: false,
    frontendOrigin: [],
    aioNotifyPollMs: 1,
    aioNotifyPollsPerAttempt: 2,
    aiMode: 'real',
    aiBaseUrl: DEFAULT_DEEPSEEK_API_BASE,
    aiApiKey: 'test-deepseek-placeholder',
    aiModel: DEFAULT_DEEPSEEK_MODEL,
    aiVisionModel: DEFAULT_DEEPSEEK_VISION_MODEL,
    lighthouseMode: 'stub',
    lighthouseChromePath: '',
    lighthouseNoSandbox: false,
    visualMode: 'stub',
    visualChromePath: '',
    bcryptRounds: 4,
    poolMax: 10,
    fingerprintKey: 'test-fingerprint-key',
    aioPreviewCampaignUuid: '',
    aioPreviewSourceUuid: '',
    aioPreviewDomainUuid: '',
    aioTenantId: '',
    ...overrides,
  };
}

const sampleInput = {
  name: 'Lander',
  languages: ['en'],
  countries: ['CA'],
  standUrl: 'https://example.invalid/stand',
  files: [{ path: 'index.html', text: '<html>Hello</html>' }],
  checkDate: '2026-10-26',
};

const userPayload = {
  check_date: '2026-10-26',
  land_name: 'Lander',
  languages: ['en'],
  countries: ['CA'],
  stand_url: 'https://example.invalid/stand',
  landing_preview_url: null,
  fx_rates: null,
  fact_sheet: null,
  page_text: '',
  main_person_claim: { from_land_name: null, from_page_text: null, resolved: null, conflict: false },
  outlet: null,
  landing_footer_ref: null,
  images: [],
  attachments_order: [],
};

function userJson(text: string): Record<string, unknown> {
  return JSON.parse(text.split('\n')[0]) as Record<string, unknown>;
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const text = content.find((part) => part && typeof part === 'object' && (part as { type?: string }).type === 'text') as
    | { text?: string }
    | undefined;
  return typeof text?.text === 'string' ? text.text : '';
}

function categoryOf(init?: RequestInit): number {
  const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: unknown }> };
  const category = userJson(messageText(body.messages[1].content)).category;
  return typeof category === 'number' && Number.isInteger(category) ? category : Number.NaN;
}

function isVisionCall(init?: RequestInit): boolean {
  return !Number.isInteger(categoryOf(init));
}

function callFor(calls: Array<{ init?: RequestInit }>, category: number): { init?: RequestInit } {
  const found = calls.filter((call) => categoryOf(call.init) === category);
  if (!found.length) throw new Error(`no call for category ${category}`);
  return found[found.length - 1];
}

function labelsFromImages(init: RequestInit | undefined, known: Map<string, string>): string[] {
  const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: unknown }> };
  const content = body.messages[1].content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) => {
    if (!part || typeof part !== 'object' || (part as { type?: string }).type !== 'image_url') return [];
    const url = (part as { image_url?: { url?: string } }).image_url?.url ?? '';
    const label = known.get(url);
    if (!label) throw new Error(`unmapped frame ${url.slice(0, 40)}`);
    return [label];
  });
}

function urlForLabel(known: Map<string, string>, label: string): string {
  for (const [url, name] of known) if (name === label) return url;
  throw new Error(label);
}

function callText(calls: Array<{ init?: RequestInit }>, category: number): string {
  const body = JSON.parse(String(callFor(calls, category).init?.body)) as { messages: Array<{ content: unknown }> };
  return messageText(body.messages[1].content);
}

function passAnswer(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { status: 'PASS', note: 'ок', findings: [], clarifications: [], ...extra };
}

const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(16, 1)]);
const heroImage: MaterialImage = {
  ref: 'I1',
  file: 'images/hero.png',
  alt: 'photo',
  caption: '',
  context: 'Andrzej Duda speaks',
  kind: 'content',
  claims_person: 'Andrzej Duda',
  mime: 'image/png',
  buffer: PNG_BYTES,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function completionBody(content: string, usage: unknown = { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 }) {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content,
          reasoning_content: '{"findings":[{"file":"ignored.html","quote":"no","screenshot":"no"}]}',
        },
        finish_reason: 'stop',
      },
    ],
    usage,
  };
}

function headerValue(headers: HeadersInit | undefined, name: string): string | null {
  return new Headers(headers).get(name);
}

describe('DeepSeek chat completions client', () => {
  it('posts one chat completion per checklist category, with thinking and no live network', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      const category = categoryOf(init);
      const answer =
        category === 1
          ? { status: 'FAIL', findings: [{ file: 'index.html', quote: 'Hello', screenshot: 'hero' }] }
          : passAnswer();
      return jsonResponse(completionBody(JSON.stringify(answer)));
    };
    const client = new DeepSeekAiClient(deepseekConfig(), fetchImpl);
    const result = await client.review(sampleInput);
    expect(calls).toHaveLength(QA_CATEGORY_COUNT);
    expect(calls.map((call) => categoryOf(call.init)).sort((a, b) => a - b)).toEqual(
      Array.from({ length: QA_CATEGORY_COUNT }, (_, index) => index + 1),
    );
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].url).toBe(`${DEFAULT_DEEPSEEK_API_BASE}/chat/completions`);
    expect(calls[0].url).not.toContain('test-deepseek-placeholder');
    expect(calls[0].url).not.toMatch(/[?&]key=/);
    expect(headerValue(calls[0].init?.headers, 'authorization')).toBe('Bearer test-deepseek-placeholder');
    const body = JSON.parse(String(callFor(calls, 1).init?.body)) as Record<string, unknown>;
    expect(body.model).toBe('deepseek-v4-pro');
    for (const call of calls) {
      const category = categoryOf(call.init);
      const categoryBody = JSON.parse(String(call.init?.body)) as {
        model?: string;
        messages: Array<{ content: unknown }>;
      };
      const flash = [2, 3, 5, 6, 7, 9, 10].includes(category);
      const multipart = [2, 3, 9, 10].includes(category);
      expect(categoryBody.model).toBe(flash ? 'deepseek-flash' : 'deepseek-v4-pro');
      expect(String(call.init?.body)).not.toContain('image_url');
      if (multipart) expect(Array.isArray(categoryBody.messages[1].content)).toBe(true);
      else expect(typeof categoryBody.messages[1].content).toBe('string');
    }
    for (const category of [5, 6, 7]) {
      const text = callText(calls, category);
      expect(text).toContain('Кадров контента нет. Суди только по page_text');
      expect(text).toContain('не выдумывай содержимое изображений');
      expect(text).toContain('в screenshot_ref ставь короткую метку места на странице');
      expect(text).not.toContain('Пикселей в этом сообщении нет');
      expect(userJson(text).attachments_order).toEqual([]);
      expect(userJson(text).visual_observations).toEqual([]);
    }
    expect(body.stream).toBe(false);
    expect(body.thinking).toEqual({ type: 'enabled' });
    expect(body.reasoning_effort).toBe(DEEPSEEK_REASONING_EFFORT);
    expect(body.max_tokens).toBe(DEEPSEEK_MAX_OUTPUT_TOKENS);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.tools).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('web_search');
    for (const category of [2, 3, 4]) {
      const categoryBody = JSON.parse(String(callFor(calls, category).init?.body)) as {
        tools?: unknown;
        messages: Array<{ role: string; content: string }>;
      };
      expect(categoryBody.tools).toBeUndefined();
      expect(JSON.stringify(categoryBody)).not.toContain('web_search');
      const offlinePhrase = {
        2: 'Сайт издания этот вызов не открывает',
        3: 'Биографию в сети не ищи',
        4: 'Гражданство и известность в сети не ищи',
      }[category];
      expect(categorySystemPrompt(category)).toContain(offlinePhrase);
      expect(categorySystemPrompt(category)).not.toContain('Этот вызов страницу не загружает');
      expect(categorySystemPrompt(category)).not.toContain('Интернет не открывай');
      const system = categoryBody.messages[0].content;
      expect(categoryBody.messages[0].role).toBe('system');
      expect(system).toBe(categorySystemMessage(category));
      expect(system).toContain('ИНСТРУКЦИЯ');
      expect(system).toContain(offlinePhrase);
      expect(system).toContain(categorySystemPrompt(category));
      expect(system).not.toContain('web_search');
      expect(system).not.toContain('открой сайт');
      expect(system).not.toContain('найди официальный сайт');
      expect(system).not.toContain('используй интернет');
      expect(system).not.toContain('Если доступен интернет');
      expect(system).not.toContain('по надёжным открытым источникам');
    }
    const messages = body.messages as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toBe(categorySystemMessage(1));
    expect(messages[0].content).toContain('ИНСТРУКЦИЯ');
    expect(messages[0].content).toContain('\n\nПРОМПТ\n\n');
    expect(messages[0].content).toContain(categorySystemPrompt(1));
    expect(messages[0].content).not.toContain('ровно 11');
    expect(messages[0].content).not.toContain('11. Телефонный код формы');
    expect(messages[1].role).toBe('user');
    expect(typeof messages[1].content).toBe('string');
    expect(userJson(messages[1].content)).toEqual({ ...userPayload, category: 1 });
    expect(messages[1].content.trimEnd().split('\n').pop()).toBe('ПРОВЕРЯЙ');
    expect(messages[1].content).not.toContain('<html>Hello</html>');
    expect(String(callFor(calls, 1).init?.body)).not.toContain('test-deepseek-placeholder');
    expect(result.findings).toEqual([{ file: 'index.html', quote: 'Hello', screenshot: 'hero', category: 1 }]);
    expect(result.usage).toEqual({ prompt_tokens: 99, completion_tokens: 33, total_tokens: 132, category_calls: 11 });
    expect(result.report?.checks).toHaveLength(11);
    expect(result.report?.checks?.find((check) => check.category === 1)?.status).toBe('FAIL');
  });

  it('reads frames with flash and attaches those frames on vision checklist calls', async () => {
    const calls: Array<{ init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      calls.push({ init });
      if (isVisionCall(init)) {
        return jsonResponse(
          completionBody(
            JSON.stringify({
              observations: [{ ref: 'desktop', visible_text: 'Hello', visible_name: '', face_visible: false, note: 'шапка' }],
            }),
          ),
        );
      }
      const category = categoryOf(init);
      const answer =
        category === 2
          ? { status: 'FAIL', findings: [{ file: 'index.html', quote: 'Hello', screenshot: 'desktop' }] }
          : passAnswer();
      return jsonResponse(completionBody(JSON.stringify(answer)));
    };
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const client = new DeepSeekAiClient(deepseekConfig(), fetchImpl);
    const result = await client.review({ ...sampleInput, screenshot: jpeg });
    expect(calls).toHaveLength(QA_CATEGORY_COUNT + 1);
    const vision = JSON.parse(String(calls[0].init?.body)) as {
      model?: string;
      messages: Array<{ content: unknown }>;
    };
    expect(vision.model).toBe('deepseek-flash');
    const visionParts = vision.messages[1].content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    expect(visionParts.map((part) => part.type)).toEqual(['text', 'image_url']);
    expect(userJson(visionParts[0].text as string)).not.toHaveProperty('category');
    expect(visionParts[1].image_url?.url).toBe(desktopShotDataUrl(jpeg));
    const seen = userJson(callText(calls, 2)).visual_observations;
    expect(seen).toEqual([{ ref: 'desktop', visible_text: 'Hello', visible_name: '', face_visible: false, note: 'шапка' }]);
    const desktopUrl = desktopShotDataUrl(jpeg);
    for (const category of [1, 4, 8, 11]) {
      const parsed = JSON.parse(String(callFor(calls, category).init?.body)) as {
        model?: string;
        messages: Array<{ content: unknown }>;
      };
      expect(parsed.model).toBe('deepseek-v4-pro');
      expect(JSON.stringify(parsed)).not.toContain('image_url');
      expect(typeof parsed.messages[1].content).toBe('string');
      expect(callText(calls, category)).not.toContain('visual_observations');
    }
    for (const category of [5, 6, 7]) {
      const parsed = JSON.parse(String(callFor(calls, category).init?.body)) as {
        model?: string;
        messages: Array<{ content: unknown }>;
      };
      expect(parsed.model).toBe('deepseek-flash');
      expect(JSON.stringify(parsed)).not.toContain('image_url');
      expect(typeof parsed.messages[1].content).toBe('string');
      const text = callText(calls, category);
      expect(text).toContain('Кадров контента нет. Суди только по page_text');
      expect(text).toContain('не выдумывай содержимое изображений');
      expect(text).toContain('в screenshot_ref ставь короткую метку места на странице');
      expect(text).not.toContain('Пикселей в этом сообщении нет');
      expect(userJson(text).attachments_order).toEqual([]);
      expect(userJson(text).visual_observations).toEqual([]);
    }
    for (const category of [2, 3, 9, 10]) {
      const parsed = JSON.parse(String(callFor(calls, category).init?.body)) as {
        model?: string;
        messages: Array<{ content: unknown }>;
      };
      expect(parsed.model).toBe('deepseek-flash');
      const parts = parsed.messages[1].content as Array<{ type: string; image_url?: { url: string } }>;
      expect(parts.map((part) => part.type)).toEqual(['text', 'image_url']);
      expect(parts[1].image_url?.url).toBe(desktopUrl);
      expect(userJson(callText(calls, category)).attachments_order).toEqual(['desktop']);
      expect(callText(calls, category)).toContain('visual_observations');
      expect(callText(calls, category)).not.toContain('Пикселей в этом сообщении нет');
      expect(callText(calls, category)).toContain('Кадры следуют в порядке attachments_order (desktop)');
    }
    const categoryTwo = callText(calls, 2);
    expect(userJson(categoryTwo).attachments_order).toEqual(['desktop']);
    expect(categoryTwo).toContain('никогда не base64');
    expect(categoryTwo.trimEnd().endsWith('ПРОВЕРЯЙ')).toBe(true);
    expect(typeof JSON.parse(String(callFor(calls, 1).init?.body)).messages[1].content).toBe('string');
    expect(result.findings).toEqual([
      { file: 'index.html', quote: 'Hello', screenshot: desktopShotDataUrl(jpeg), category: 2 },
    ]);
    expect(applyDesktopShot([{ file: 'a.html', quote: 'q', screenshot: 'hero' }], desktopShotDataUrl(jpeg))).toEqual([
      { file: 'a.html', quote: 'q', screenshot: 'hero' },
    ]);
  });

  it('sends page_text, the person claim and landing images after the desktop shot, and maps I-refs to data URLs', async () => {
    const calls: Array<{ init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      calls.push({ init });
      if (isVisionCall(init)) {
        return jsonResponse(
          completionBody(
            JSON.stringify({
              observations: [
                { ref: 'desktop', visible_text: 'Andrzej Duda', visible_name: 'Andrzej Duda', face_visible: true, person_match: 'match', note: 'шапка' },
                { ref: 'I1', visible_text: '', visible_name: 'Andrzej Duda', face_visible: true, person_match: 'match', note: 'герой' },
              ],
            }),
          ),
        );
      }
      const category = categoryOf(init);
      const byCategory: Record<number, unknown> = {
        1: { status: 'PASS', general: { geo: 'Польша' }, findings: [], clarifications: [] },
        3: { status: 'PASS', general: { main_person: 'Andrzej Duda' }, findings: [], clarifications: ['Возраст не проверен'] },
        5: { status: 'FAIL', findings: [{ file: 'index.html', quote: 'invented quote', screenshot_ref: 'desktop', category: 5 }] },
        10: {
          status: 'FAIL',
          note: 'фото другого человека',
          findings: [
            {
              file: 'index.html',
              quote: 'Andrzej Duda speaks',
              screenshot_ref: 'I1',
              category: 10,
              priority: 'major',
              where: 'hero',
              problem: 'На фото другой человек',
              expected: 'Фото Andrzej Duda',
            },
          ],
        },
      };
      return jsonResponse(completionBody(JSON.stringify(byCategory[category] ?? passAnswer())));
    };
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const person = { from_land_name: 'Andrzej Duda', from_page_text: 'Andrzej Duda', resolved: 'Andrzej Duda', conflict: false };
    const result = await new DeepSeekAiClient(deepseekConfig(), fetchImpl).review({
      ...sampleInput,
      screenshot: jpeg,
      pageText: 'Andrzej Duda speaks today',
      person,
      images: [heroImage],
    });
    const categoryText = callText(calls, 3);
    const payload = userJson(categoryText);
    expect(payload.page_text).toBe('Andrzej Duda speaks today');
    expect(payload.main_person_claim).toEqual(person);
    expect(payload.attachments_order).toEqual(['desktop', 'I1']);
    const desktopNote = {
      ref: 'desktop',
      visible_text: 'Andrzej Duda',
      visible_name: 'Andrzej Duda',
      face_visible: true,
      person_match: 'match',
      note: 'шапка',
    };
    const heroNote = { ref: 'I1', visible_text: '', visible_name: 'Andrzej Duda', face_visible: true, person_match: 'match', note: 'герой' };
    expect(payload.visual_observations).toEqual([desktopNote, heroNote]);
    expect(userJson(callText(calls, 2)).visual_observations).toEqual([desktopNote]);
    expect(userJson(callText(calls, 9)).visual_observations).toEqual([desktopNote]);
    expect(userJson(callText(calls, 10)).visual_observations).toEqual([desktopNote, heroNote]);
    expect(userJson(callText(calls, 5)).visual_observations).toEqual([heroNote]);
    expect(userJson(callText(calls, 6)).visual_observations).toEqual([heroNote]);
    expect(userJson(callText(calls, 7)).visual_observations).toEqual([heroNote]);
    expect(userJson(callText(calls, 5)).attachments_order).toEqual(['I1']);
    expect(callText(calls, 5)).toContain('Кадры следуют в порядке attachments_order (I1)');
    expect(callText(calls, 5)).not.toContain('Пикселей в этом сообщении нет');
    expect(callText(calls, 5)).not.toContain('Кадров контента нет');
    expect(userJson(callText(calls, 1))).not.toHaveProperty('visual_observations');
    expect(payload.images).toEqual([
      {
        ref: 'I1',
        file: 'images/hero.png',
        alt: 'photo',
        caption: '',
        context: 'Andrzej Duda speaks',
        kind: 'content',
        claims_person: 'Andrzej Duda',
      },
    ]);
    expect(categoryText).not.toContain(PNG_BYTES.toString('base64'));
    const heroUrl = `data:image/png;base64,${PNG_BYTES.toString('base64')}`;
    const vision = JSON.parse(String(calls[0].init?.body)) as {
      model?: string;
      messages: Array<{ content: unknown }>;
    };
    expect(vision.model).toBe('deepseek-flash');
    const parts = vision.messages[1].content as Array<{ type: string; image_url?: { url: string } }>;
    expect(parts.map((part) => part.type)).toEqual(['text', 'image_url', 'image_url']);
    expect(parts[1].image_url?.url).toBe(desktopShotDataUrl(jpeg));
    expect(parts[2].image_url?.url).toBe(heroUrl);
    const desktopUrl = desktopShotDataUrl(jpeg);
    const checklistFrames: Record<number, string[]> = {
      2: [desktopUrl],
      3: [desktopUrl, heroUrl],
      5: [heroUrl],
      6: [heroUrl],
      7: [heroUrl],
      9: [desktopUrl],
      10: [desktopUrl, heroUrl],
    };
    for (const [category, urls] of Object.entries(checklistFrames)) {
      const parsed = JSON.parse(String(callFor(calls, Number(category)).init?.body)) as {
        model?: string;
        messages: Array<{ content: unknown }>;
      };
      expect(parsed.model).toBe('deepseek-flash');
      const checklistParts = parsed.messages[1].content as Array<{ type: string; image_url?: { url: string } }>;
      expect(checklistParts.map((part) => part.type)).toEqual(['text', ...urls.map(() => 'image_url')]);
      urls.forEach((url, index) => expect(checklistParts[index + 1].image_url?.url).toBe(url));
    }
    for (const category of [1, 4, 8, 11]) {
      expect(JSON.parse(String(callFor(calls, category).init?.body)).model).toBe('deepseek-v4-pro');
      expect(String(callFor(calls, category).init?.body)).not.toContain('image_url');
    }
    expect(result.findings).toEqual([
      {
        file: 'index.html',
        quote: 'Andrzej Duda speaks',
        screenshot: heroUrl,
        category: 10,
        priority: 'major',
        where: 'hero',
        problem: 'На фото другой человек',
        expected: 'Фото Andrzej Duda',
      },
    ]);
    expect(result.report?.report_markdown).not.toMatch(/Общий результат/);
    expect(result.report?.general).toEqual({ geo: 'Польша', main_person: 'Andrzej Duda' });
    expect(result.report?.checks).toHaveLength(11);
    expect(result.report?.checks?.map((check) => [check.category, check.status])).toEqual(
      Array.from({ length: 11 }, (_, index) => {
        const category = index + 1;
        if (category === 5) return [5, 'N/A'];
        if (category === 10) return [10, 'FAIL'];
        return [category, 'PASS'];
      }),
    );
    expect(result.report?.clarifications).toEqual(['Возраст не проверен']);
    expect(JSON.stringify(result)).not.toMatch(/verdict|overall_status/);
    expect(categoryText).toContain('Проверь соответствие изображений I1');
    expect(String(callFor(calls, 1).init?.body)).not.toContain('image_url');
    expect(String(callFor(calls, 3).init?.body)).not.toContain('test-deepseek-placeholder');
  });

  it('builds a category 3 finding from the flash observation even when pro disagrees', async () => {
    const person = { from_land_name: 'Andrzej Duda', from_page_text: 'Andrzej Duda', resolved: 'Andrzej Duda', conflict: false };
    const fetchImpl: typeof fetch = async (_url, init) => {
      if (isVisionCall(init)) {
        return jsonResponse(
          completionBody(
            JSON.stringify({
              observations: [
                {
                  ref: 'I1',
                  visible_text: '',
                  visible_name: 'Другой человек',
                  face_visible: true,
                  person_match: 'mismatch',
                  note: 'На фото другой человек',
                },
              ],
            }),
          ),
        );
      }
      const category = categoryOf(init);
      const answer =
        category === 3
          ? { status: 'PASS', findings: [], guest_refs: [], image_checks: [{ ref: 'I1', match: 'match', note: 'Pro сказал match' }] }
          : category === 10
            ? { status: 'PASS', note: 'ок', findings: [] }
            : passAnswer();
      return jsonResponse(completionBody(JSON.stringify(answer)));
    };
    const result = await new DeepSeekAiClient(deepseekConfig(), fetchImpl).review({
      ...sampleInput,
      pageText: 'Andrzej Duda speaks today',
      person,
      images: [heroImage],
    });
    const heroUrl = `data:image/png;base64,${PNG_BYTES.toString('base64')}`;
    expect(result.findings).toEqual([
      {
        file: 'index.html',
        quote: 'Andrzej Duda',
        screenshot: heroUrl,
        category: 3,
        priority: 'major',
        where: 'images/hero.png',
        problem: 'На фото другой человек',
        expected: 'Изображение Andrzej Duda',
      },
    ]);
    expect(JSON.stringify(result.findings)).not.toContain('Pro сказал match');
    expect(result.report?.checks?.find((check) => check.category === 3)).toEqual({
      category: 3,
      status: 'FAIL',
      note: 'Изображение I1 не соответствует «Andrzej Duda»',
    });
    expect(result.report?.checks?.find((check) => check.category === 10)).toEqual({ category: 10, status: 'PASS', note: 'ок' });
    expect(result.report?.checks).toHaveLength(11);
    expect(result.usage).toEqual({ prompt_tokens: 108, completion_tokens: 36, total_tokens: 144, category_calls: 11 });
  });

  it('lets guest_refs soften a flash mismatch unless the visible name is the celebrity', async () => {
    const person = { from_land_name: 'Andrzej Duda', from_page_text: null, resolved: null, conflict: false };
    const review = async (visibleName: string) => {
      const fetchImpl: typeof fetch = async (_url, init) => {
        if (isVisionCall(init)) {
          return jsonResponse(
            completionBody(
              JSON.stringify({
                observations: [
                  {
                    ref: 'I1',
                    visible_text: '',
                    visible_name: visibleName,
                    face_visible: true,
                    person_match: 'mismatch',
                    note: 'лицо не сходится',
                  },
                ],
              }),
            ),
          );
        }
        const category = categoryOf(init);
        const answer =
          category === 3
            ? {
                status: 'PASS',
                note: 'ок',
                findings: [],
                guest_refs: ['I1'],
                image_checks: [{ ref: 'I1', match: 'mismatch', note: 'Pro усилил' }],
              }
            : passAnswer();
        return jsonResponse(completionBody(JSON.stringify(answer)));
      };
      return new DeepSeekAiClient(deepseekConfig(), fetchImpl).review({
        ...sampleInput,
        pageText: 'Andrzej Duda speaks today',
        person,
        images: [heroImage],
      });
    };
    const guest = await review('Марта Гость');
    expect(guest.findings).toEqual([]);
    expect(guest.report?.checks?.find((check) => check.category === 3)).toEqual({ category: 3, status: 'PASS', note: 'ок' });
    const heroUrl = `data:image/png;base64,${PNG_BYTES.toString('base64')}`;
    const locked = await review('  andrzej   duda ');
    expect(locked.findings).toEqual([
      {
        file: 'index.html',
        quote: 'Andrzej Duda',
        screenshot: heroUrl,
        category: 3,
        priority: 'major',
        where: 'images/hero.png',
        problem: 'лицо не сходится',
        expected: 'Изображение Andrzej Duda',
      },
    ]);
    expect(JSON.stringify(locked.findings)).not.toContain('Pro усилил');
    expect(locked.report?.checks?.find((check) => check.category === 3)?.status).toBe('FAIL');
  });

  it('keeps the eleven checklist calls when the vision pass fails', async () => {
    const person = { from_land_name: 'Andrzej Duda', from_page_text: null, resolved: null, conflict: false };
    const input = { ...sampleInput, pageText: 'Andrzej Duda', person, images: [heroImage] };
    const run = async (vision: () => Promise<Response>) => {
      const calls: Array<{ init?: RequestInit }> = [];
      const fetchImpl: typeof fetch = async (_url, init) => {
        calls.push({ init });
        if (isVisionCall(init)) return vision();
        return jsonResponse(completionBody(JSON.stringify(passAnswer())));
      };
      const result = await new DeepSeekAiClient(deepseekConfig(), fetchImpl).review(input);
      return { calls, result };
    };
    const thrown = await run(async () => {
      throw new Error('vision down');
    });
    expect(thrown.calls.filter((call) => isVisionCall(call.init))).toHaveLength(2);
    expect(thrown.calls.filter((call) => Number.isInteger(categoryOf(call.init)))).toHaveLength(QA_CATEGORY_COUNT);
    expect(thrown.result.report?.checks).toHaveLength(11);
    expect(thrown.result.report?.checks?.every((check) => check.status === 'PASS')).toBe(true);

    const broken = await run(async () => jsonResponse(completionBody('{"observations":')));
    expect(broken.calls.filter((call) => isVisionCall(call.init))).toHaveLength(2);
    expect(broken.calls.filter((call) => Number.isInteger(categoryOf(call.init)))).toHaveLength(QA_CATEGORY_COUNT);
    expect(callText(broken.calls, 3)).toContain('"visual_observations":[]');
    const heroUrl = `data:image/png;base64,${PNG_BYTES.toString('base64')}`;
    const expectCategoryThreePixels = (reviewed: Array<{ init?: RequestInit }>) => {
      const parsed = JSON.parse(String(callFor(reviewed, 3).init?.body)) as {
        model?: string;
        messages: Array<{ content: unknown }>;
      };
      expect(parsed.model).toBe('deepseek-flash');
      const parts = parsed.messages[1].content as Array<{ type: string; image_url?: { url: string } }>;
      expect(parts.map((part) => part.type)).toEqual(['text', 'image_url']);
      expect(parts[1].image_url?.url).toBe(heroUrl);
    };
    expectCategoryThreePixels(thrown.calls);
    expectCategoryThreePixels(broken.calls);
    for (const category of [1, 4, 8, 11]) {
      expect(JSON.parse(String(callFor(broken.calls, category).init?.body)).model).toBe('deepseek-v4-pro');
      expect(String(callFor(broken.calls, category).init?.body)).not.toContain('image_url');
    }
    for (const category of [5, 6, 7]) {
      const parsed = JSON.parse(String(callFor(broken.calls, category).init?.body)) as {
        model?: string;
        messages: Array<{ content: unknown }>;
      };
      expect(parsed.model).toBe('deepseek-flash');
      const parts = parsed.messages[1].content as Array<{ type: string; image_url?: { url: string } }>;
      expect(parts.map((part) => part.type)).toEqual(['text', 'image_url']);
      expect(parts[1].image_url?.url).toBe(heroUrl);
      expect(userJson(callText(broken.calls, category)).attachments_order).toEqual(['I1']);
    }

    const empty = await run(async () => jsonResponse(completionBody('   ')));
    expect(empty.calls.filter((call) => isVisionCall(call.init))).toHaveLength(2);
    expect(empty.calls.filter((call) => Number.isInteger(categoryOf(call.init)))).toHaveLength(QA_CATEGORY_COUNT);
    expect(empty.result.report?.checks).toHaveLength(11);
    expectCategoryThreePixels(empty.calls);
  });

  it('sends a landing image to flash and to the category 3 checklist call', async () => {
    const calls: Array<{ init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      calls.push({ init });
      if (isVisionCall(init)) return jsonResponse(completionBody(JSON.stringify({ observations: [] })));
      return jsonResponse(completionBody('{"findings":[]}'));
    };
    await new DeepSeekAiClient(deepseekConfig(), fetchImpl).review({ ...sampleInput, images: [heroImage] });
    const heroUrl = `data:image/png;base64,${PNG_BYTES.toString('base64')}`;
    const vision = JSON.parse(String(calls[0].init?.body)) as { model?: string; messages: Array<{ content: unknown }> };
    expect(vision.model).toBe('deepseek-flash');
    const parts = vision.messages[1].content as Array<{ type: string; image_url?: { url: string } }>;
    expect(parts.map((part) => part.type)).toEqual(['text', 'image_url']);
    expect(parts[1].image_url?.url).toBe(heroUrl);
    const categoryThree = callText(calls, 3);
    expect(userJson(categoryThree).attachments_order).toEqual(['I1']);
    expect(categoryThree).toContain('visual_observations');
    const categoryThreeBody = JSON.parse(String(callFor(calls, 3).init?.body)) as {
      model?: string;
      messages: Array<{ content: unknown }>;
    };
    expect(categoryThreeBody.model).toBe('deepseek-flash');
    const threeParts = categoryThreeBody.messages[1].content as Array<{ type: string; image_url?: { url: string } }>;
    expect(threeParts.map((part) => part.type)).toEqual(['text', 'image_url']);
    expect(threeParts[1].image_url?.url).toBe(heroUrl);
    const categoryTenBody = JSON.parse(String(callFor(calls, 10).init?.body)) as {
      model?: string;
      messages: Array<{ content: unknown }>;
    };
    expect(categoryTenBody.model).toBe('deepseek-flash');
    const tenParts = categoryTenBody.messages[1].content as Array<{ type: string; image_url?: { url: string } }>;
    expect(tenParts.map((part) => part.type)).toEqual(['text', 'image_url']);
    expect(tenParts[1].image_url?.url).toBe(heroUrl);
    expect(JSON.parse(String(callFor(calls, 2).init?.body)).model).toBe('deepseek-flash');
    expect(String(callFor(calls, 2).init?.body)).not.toContain('image_url');
    expect(JSON.parse(String(callFor(calls, 9).init?.body)).model).toBe('deepseek-flash');
    expect(String(callFor(calls, 9).init?.body)).not.toContain('image_url');
    for (const category of [5, 6, 7]) {
      const parsed = JSON.parse(String(callFor(calls, category).init?.body)) as {
        model?: string;
        messages: Array<{ content: unknown }>;
      };
      expect(parsed.model).toBe('deepseek-flash');
      const parts = parsed.messages[1].content as Array<{ type: string; image_url?: { url: string } }>;
      expect(parts.map((part) => part.type)).toEqual(['text', 'image_url']);
      expect(parts[1].image_url?.url).toBe(heroUrl);
      expect(userJson(callText(calls, category)).attachments_order).toEqual(['I1']);
      expect(callText(calls, category)).not.toContain('Пикселей в этом сообщении нет');
    }
    for (const category of [1, 4, 8, 11]) {
      const textOnly = JSON.parse(String(callFor(calls, category).init?.body)) as {
        model?: string;
        messages: Array<{ content: unknown }>;
      };
      expect(textOnly.model).toBe('deepseek-v4-pro');
      expect(typeof textOnly.messages[1].content).toBe('string');
      expect(String(callFor(calls, category).init?.body)).not.toContain('image_url');
    }
  });

  it('gives deposit and offer checks content frames on flash and leaves the other frame sets unchanged', async () => {
    const calls: Array<{ init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      calls.push({ init });
      if (isVisionCall(init)) {
        return jsonResponse(
          completionBody(
            JSON.stringify({
              observations: [
                { ref: 'desktop', visible_text: 'шапка', visible_name: '', face_visible: false, note: 'шапка' },
                { ref: 'preview', visible_text: 'EUR 250', visible_name: '', face_visible: false, note: 'превью' },
                { ref: 'landing_footer', visible_text: 'низ', visible_name: '', face_visible: false, note: 'футер' },
                { ref: 'outlet_header', visible_text: 'логотип', visible_name: '', face_visible: false, note: 'издание' },
                { ref: 'outlet_footer', visible_text: 'копирайт', visible_name: '', face_visible: false, note: 'издание' },
                { ref: 'I1', visible_text: '250 EUR Quifix', visible_name: '', face_visible: false, note: 'креатив' },
                { ref: 'I2', visible_text: '', visible_name: 'Анна', face_visible: true, note: 'аватар' },
              ],
            }),
          ),
        );
      }
      return jsonResponse(completionBody(JSON.stringify(passAnswer())));
    };
    const desktop = Buffer.from([0xff, 0xd8, 0xff, 0x21]);
    const preview = Buffer.from([0xff, 0xd8, 0xff, 0x22]);
    const landingFooter = Buffer.from([0xff, 0xd8, 0xff, 0x23]);
    const header = Buffer.from([0xff, 0xd8, 0xff, 0x24]);
    const footer = Buffer.from([0xff, 0xd8, 0xff, 0x25]);
    const commentBytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(16, 2)]);
    const commentImage: MaterialImage = {
      ...heroImage,
      ref: 'I2',
      file: 'images/avatar.png',
      alt: 'avatar',
      caption: '',
      context: 'Анна',
      kind: 'comment',
      claims_person: null,
      buffer: commentBytes,
    };
    await new DeepSeekAiClient(deepseekConfig(), fetchImpl).review({
      ...sampleInput,
      pageText: 'депозит 250 EUR на Quifix',
      screenshot: desktop,
      previewShots: [preview],
      landingFooter,
      outlet: { name: 'NOS', url: 'https://nos.nl', header, footer },
      images: [heroImage, commentImage],
    });
    expect(calls.filter((call) => isVisionCall(call.init))).toHaveLength(1);
    const heroUrl = `data:image/png;base64,${PNG_BYTES.toString('base64')}`;
    const commentUrl = `data:image/png;base64,${commentBytes.toString('base64')}`;
    const vision = JSON.parse(String(calls[0].init?.body)) as {
      model?: string;
      messages: Array<{ content: unknown }>;
    };
    expect(vision.model).toBe('deepseek-flash');
    const visionParts = vision.messages[1].content as Array<{ type: string; image_url?: { url: string } }>;
    expect(visionParts.slice(1).map((part) => part.image_url?.url)).toEqual([
      desktopShotDataUrl(desktop),
      desktopShotDataUrl(preview),
      desktopShotDataUrl(landingFooter),
      desktopShotDataUrl(header),
      desktopShotDataUrl(footer),
      heroUrl,
      commentUrl,
    ]);
    const contentNote = {
      ref: 'I1',
      visible_text: '250 EUR Quifix',
      visible_name: '',
      face_visible: false,
      note: 'креатив',
    };
    for (const category of [5, 6, 7]) {
      const parsed = JSON.parse(String(callFor(calls, category).init?.body)) as {
        model?: string;
        messages: Array<{ content: unknown }>;
      };
      expect(parsed.model).toBe('deepseek-flash');
      const parts = parsed.messages[1].content as Array<{ type: string; image_url?: { url: string } }>;
      expect(parts.map((part) => part.type)).toEqual(['text', 'image_url']);
      expect(parts[1].image_url?.url).toBe(heroUrl);
      const body = JSON.stringify(parsed);
      expect(body).not.toContain(commentUrl);
      expect(body).not.toContain(desktopShotDataUrl(desktop));
      expect(body).not.toContain(desktopShotDataUrl(preview));
      expect(body).not.toContain(desktopShotDataUrl(landingFooter));
      expect(body).not.toContain(desktopShotDataUrl(header));
      expect(body).not.toContain(desktopShotDataUrl(footer));
      const text = callText(calls, category);
      expect(userJson(text).attachments_order).toEqual(['I1']);
      expect(userJson(text).visual_observations).toEqual([contentNote]);
      expect(userJson(text).outlet).toBeNull();
      expect(userJson(text).landing_footer_ref).toBeNull();
      expect(userJson(text).images).toEqual([expect.objectContaining({ ref: 'I1', kind: 'content' })]);
      expect(text).toContain('Кадры следуют в порядке attachments_order (I1)');
      expect(text).not.toContain('Пикселей в этом сообщении нет');
      expect(text).not.toContain('Кадров контента нет');
    }
    for (const category of [1, 4, 8, 11]) {
      const textOnly = JSON.parse(String(callFor(calls, category).init?.body)) as {
        model?: string;
        messages: Array<{ content: unknown }>;
      };
      expect(textOnly.model).toBe('deepseek-v4-pro');
      expect(typeof textOnly.messages[1].content).toBe('string');
      expect(String(callFor(calls, category).init?.body)).not.toContain('image_url');
    }
    expect(userJson(callText(calls, 2)).attachments_order).toEqual(['preview', 'outlet_header', 'outlet_footer']);
    expect(userJson(callText(calls, 3)).attachments_order).toEqual(['preview', 'I1']);
    expect(userJson(callText(calls, 9)).attachments_order).toEqual(['desktop', 'preview', 'landing_footer', 'I2']);
    expect(userJson(callText(calls, 10)).attachments_order).toEqual(['desktop', 'preview', 'landing_footer', 'I1', 'I2']);
    const framesOf = (category: number): string[] => {
      const parsed = JSON.parse(String(callFor(calls, category).init?.body)) as {
        model?: string;
        messages: Array<{ content: unknown }>;
      };
      expect(parsed.model).toBe('deepseek-flash');
      const parts = parsed.messages[1].content as Array<{ type: string; image_url?: { url: string } }>;
      return parts.slice(1).map((part) => part.image_url?.url ?? '');
    };
    expect(framesOf(2)).toEqual([desktopShotDataUrl(preview), desktopShotDataUrl(header), desktopShotDataUrl(footer)]);
    expect(framesOf(3)).toEqual([desktopShotDataUrl(preview), heroUrl]);
    expect(framesOf(9)).toEqual([
      desktopShotDataUrl(desktop),
      desktopShotDataUrl(preview),
      desktopShotDataUrl(landingFooter),
      commentUrl,
    ]);
    expect(callText(calls, 9)).toContain(
      'Аватар — картинка рядом с именем. Картинка внутри текста комментария — вложение: это не второе фото этого имени и не аватар другого комментатора. Иллюстрации статьи — не аватары. Одно и то же фото у одного имени в нескольких комментариях — нормально. Явный конфликт пола аватара и имени — minor. Одно реальное фото у разных имён или одно имя с разными фото — major. Заглушка и невидимый аватар — не FAIL.',
    );
    expect(callText(calls, 3)).not.toContain('Иллюстрации статьи — не аватары.');
    expect(callText(calls, 10)).not.toContain('Иллюстрации статьи — не аватары.');
    expect(framesOf(10)).toEqual([
      desktopShotDataUrl(desktop),
      desktopShotDataUrl(preview),
      desktopShotDataUrl(landingFooter),
      heroUrl,
      commentUrl,
    ]);
  });

  it('attaches the official header and footer and refuses them as finding screenshots', async () => {
    const calls: Array<{ init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      calls.push({ init });
      if (isVisionCall(init)) return jsonResponse(completionBody(JSON.stringify({ observations: [] })));
      const category = categoryOf(init);
      const answer =
        category === 2
          ? {
              status: 'FAIL',
              findings: [
                { file: 'index.html', quote: 'NOS', screenshot_ref: 'outlet_header', category: 2 },
                { file: 'index.html', quote: 'NOS', screenshot_ref: 'landing_footer', category: 2 },
              ],
            }
          : passAnswer();
      return jsonResponse(completionBody(JSON.stringify(answer)));
    };
    const header = Buffer.from([0xff, 0xd8, 0xff, 0x01]);
    const footer = Buffer.from([0xff, 0xd8, 0xff, 0x02]);
    const landingFooter = Buffer.from([0xff, 0xd8, 0xff, 0x03]);
    const result = await new DeepSeekAiClient(deepseekConfig(), fetchImpl).review({
      ...sampleInput,
      pageText: 'NOS Nieuws Sport',
      outlet: { name: 'NOS', url: 'https://nos.nl', header, footer },
      landingFooter,
    });
    const categoryText = callText(calls, 2);
    const payload = userJson(categoryText);
    expect(payload.attachments_order).toEqual(['landing_footer', 'outlet_header', 'outlet_footer']);
    expect(payload.outlet).toEqual({
      name: 'NOS',
      url: 'https://nos.nl',
      header_ref: 'outlet_header',
      footer_ref: 'outlet_footer',
    });
    expect(payload.landing_footer_ref).toBe('landing_footer');
    expect(payload.visual_observations).toEqual([]);
    expect(categoryText).toContain('Категория 2: сравни');
    expect(categoryText).not.toContain('скриншотов оригинала издания нет');
    const categoryTwoBody = JSON.parse(String(callFor(calls, 2).init?.body)) as {
      model?: string;
      messages: Array<{ content: unknown }>;
    };
    expect(categoryTwoBody.model).toBe('deepseek-flash');
    const categoryTwoParts = categoryTwoBody.messages[1].content as Array<{ type: string; image_url?: { url: string } }>;
    expect(categoryTwoParts.map((part) => part.type)).toEqual(['text', 'image_url', 'image_url', 'image_url']);
    expect(categoryTwoParts[1].image_url?.url).toBe(desktopShotDataUrl(landingFooter));
    expect(categoryTwoParts[2].image_url?.url).toBe(desktopShotDataUrl(header));
    expect(categoryTwoParts[3].image_url?.url).toBe(desktopShotDataUrl(footer));
    const categoryTenOnlyFooter = JSON.parse(String(callFor(calls, 10).init?.body)) as {
      model?: string;
      messages: Array<{ content: unknown }>;
    };
    expect(categoryTenOnlyFooter.model).toBe('deepseek-flash');
    const categoryTenParts = categoryTenOnlyFooter.messages[1].content as Array<{ type: string; image_url?: { url: string } }>;
    expect(categoryTenParts.map((part) => part.type)).toEqual(['text', 'image_url']);
    expect(categoryTenParts[1].image_url?.url).toBe(desktopShotDataUrl(landingFooter));
    expect(JSON.parse(String(callFor(calls, 1).init?.body)).model).toBe('deepseek-v4-pro');
    expect(String(callFor(calls, 1).init?.body)).not.toContain('image_url');
    const vision = JSON.parse(String(calls[0].init?.body)) as {
      model?: string;
      messages: Array<{ content: unknown }>;
    };
    expect(vision.model).toBe('deepseek-flash');
    const parts = vision.messages[1].content as Array<{ type: string; image_url?: { url: string } }>;
    expect(parts.map((part) => part.type)).toEqual(['text', 'image_url', 'image_url', 'image_url']);
    expect(parts[1].image_url?.url).toBe(desktopShotDataUrl(landingFooter));
    expect(parts[2].image_url?.url).toBe(desktopShotDataUrl(header));
    expect(parts[3].image_url?.url).toBe(desktopShotDataUrl(footer));
    expect(result.findings).toEqual([
      { file: 'index.html', quote: 'NOS', screenshot: desktopShotDataUrl(landingFooter), category: 2 },
    ]);
    expect(result.report?.checks?.find((check) => check.category === 2)?.status).toBe('FAIL');
  });

  it('tells category 2 to use N/A only when outlet shots are missing', async () => {
    const calls: string[] = [];
    const marks = [0];
    const fetchImpl: typeof fetch = async (_url, init) => {
      calls.push(String(init?.body));
      const parsed = JSON.parse(String(init?.body)) as { messages: Array<{ content: unknown }> };
      if (typeof userJson(messageText(parsed.messages[1].content)).category !== 'number') {
        return jsonResponse(completionBody(JSON.stringify({ observations: [] })));
      }
      return jsonResponse(completionBody(JSON.stringify(passAnswer())));
    };
    const textAt = (review: number, category: number): string => {
      const batch = calls.slice(marks[review], marks[review + 1]);
      const raw = batch.find((body) => {
        const parsed = JSON.parse(body) as { messages: Array<{ content: unknown }> };
        return userJson(messageText(parsed.messages[1].content)).category === category;
      });
      if (!raw) throw new Error(`missing category ${category} in review ${review}`);
      return messageText((JSON.parse(raw) as { messages: Array<{ content: unknown }> }).messages[1].content);
    };
    const client = new DeepSeekAiClient(deepseekConfig(), fetchImpl);
    await client.review({ ...sampleInput, pageText: 'NOS Nieuws' });
    marks.push(calls.length);
    const absentHeader = textAt(0, 2);
    const absentAmount = textAt(0, 6);
    expect(absentHeader).toContain('Категория 2: скриншотов оригинала издания нет, ставь N/A');
    expect(absentAmount).toContain('fx_rates нет: сумму депозита в USD не переводи, статус N/A.');
    expect(absentAmount).not.toContain('fx_rates нет: сумму депозита в USD не переводи.');
    expect(textAt(0, 3)).toContain('Пустая карточка не запрещает закрыть пункт по тексту и фото.');
    expect(textAt(0, 4)).toContain('Пустая карточка не запрещает закрыть пункт.');
    expect(textAt(0, 4)).not.toContain('по тексту и фото');
    expect(textAt(0, 4)).toContain('Сайт отсюда не открывается: гражданство без карточки не выдумывай, это clarifications.');
    expect(textAt(0, 4)).not.toContain('возраст, должность и гражданство');
    expect(userJson(absentAmount).fx_rates).toBeNull();
    expect(userJson(absentHeader).fact_sheet).toBeNull();
    expect(textAt(0, 1)).not.toContain('видимый текст отрисованного стенда');

    const header = Buffer.from([0xff, 0xd8, 0xff, 0x11]);
    const footer = Buffer.from([0xff, 0xd8, 0xff, 0x12]);
    await client.review({
      ...sampleInput,
      pageText: 'Ben Woldring Brand 220 EUR Tel +31 12 oktober 2026',
      pageTextRendered: true,
      outlet: { name: 'NOS', url: 'https://nos.nl', header, footer },
      factSheet: {
        person: {
          name: 'Ben Woldring',
          source: 'https://nl.wikipedia.org/wiki/Ben_Woldring',
          description: 'Nederlands ondernemer',
          extract: 'Ben Woldring is een Nederlands ondernemer.',
          born: '1990-06-15',
          age_on_check_date: 36,
          citizenship: ['Nederland'],
          positions: ['ondernemer'],
        },
      },
      fxRates: { date: '2026-10-27', base: 'USD', rates: { EUR: 0.92 } },
    });
    marks.push(calls.length);
    const presentHeader = textAt(1, 2);
    const presentPerson = textAt(1, 4);
    const presentAmount = textAt(1, 6);
    expect(presentHeader).toContain('Категория 2: сравни');
    expect(presentHeader).toContain('футер ленда (скриншота футера нет)');
    expect(presentHeader).not.toContain('текст page_text');
    expect(presentHeader).not.toContain('скриншотов оригинала издания нет');
    expect(presentHeader).not.toContain('ставь N/A');
    expect(presentPerson).toContain('fact_sheet.person (Ben Woldring');
    expect(presentPerson).toContain('Википедия или поиск до вызова');
    expect(presentPerson).toContain('description и extract');
    expect(presentPerson).toContain('человек этого GEO');
    expect(presentPerson).toContain('Умершего тёзку');
    expect(presentPerson).not.toContain('web_search');
    expect(presentPerson).not.toContain('открой сайт');
    const categoryThree = textAt(1, 3);
    expect(categoryThree).toContain('fact_sheet.person.extract (Ben Woldring)');
    expect(categoryThree).toContain('имя, возраст, должность и цитаты');
    expect(categoryThree).toContain('Фото сверь с именем из названия ленда');
    expect(categoryThree).not.toContain('человек этого GEO');
    expect(categoryThree).not.toContain('Умершего тёзку');
    expect(presentAmount).toContain('Депозит в USD считай по fx_rates на 2026-10-27: сумма / rates[код]. Кода нет в rates — N/A.');
    expect(textAt(1, 1)).toContain('видимый текст отрисованного стенда');
    expect(textAt(1, 7)).not.toContain('offer_name');
    expect(textAt(1, 7)).not.toContain('название оффера не');
    expect(userJson(presentPerson).page_text).toBe('Ben Woldring Brand 220 EUR Tel +31 12 oktober 2026');
    expect(userJson(presentPerson).fact_sheet).toMatchObject({
      person: { citizenship: ['Nederland'], positions: ['ondernemer'] },
    });
    expect(userJson(presentAmount).fx_rates).toEqual({ date: '2026-10-27', base: 'USD', rates: { EUR: 0.92 } });
    expect(userJson(textAt(1, 1)).fx_rates).toBeNull();

    await client.review({
      ...sampleInput,
      pageText: 'Offer {{aio.visit.fields.offer_name.for_visitors}}',
      pageTextRendered: true,
    });
    marks.push(calls.length);
    const stillRaw = textAt(2, 7);
    expect(stillRaw).not.toContain('оффер и форма подставлены');
    expect(stillRaw).not.toContain('название оффера не');
  });

  it('exposes the raised output token budget', () => {
    expect(DEEPSEEK_MAX_OUTPUT_TOKENS).toBe(12288);
  });

  it('keeps optional finding fields and drops invalid ones in completeFindings', () => {
    expect(
      completeFindings([
        { file: 'a.html', quote: 'q', screenshot: 's', category: 3, priority: 'minor', where: 'w', problem: 'p', expected: 'e' },
        { file: 'b.html', quote: 'q', screenshot: 's', category: 99, priority: 'urgent' as never, where: '  ' },
      ]),
    ).toEqual([
      { file: 'a.html', quote: 'q', screenshot: 's', category: 3, priority: 'minor', where: 'w', problem: 'p', expected: 'e' },
      { file: 'b.html', quote: 'q', screenshot: 's' },
    ]);
  });

  it('strips markdown fences from model text', async () => {
    const fetchImpl: typeof fetch = async (_url, init) => {
      const category = categoryOf(init);
      const content =
        category === 1
          ? '```json\n{"status":"FAIL","findings":[{"file":"a.html","quote":"q","screenshot":"s"}]}\n```'
          : JSON.stringify(passAnswer());
      return jsonResponse(completionBody(content, null));
    };
    const client = new DeepSeekAiClient(deepseekConfig(), fetchImpl);
    const result = await client.review({ ...sampleInput, standUrl: null });
    expect(result.findings).toEqual([{ file: 'a.html', quote: 'q', screenshot: 's', category: 1 }]);
    expect(result.usage).toBeNull();
  });

  it('keeps a failed category as GAP and does not leak the key or response body', async () => {
    let networkHits = 0;
    const network: typeof fetch = async () => {
      networkHits += 1;
      throw new Error('network down test-deepseek-placeholder');
    };
    const networkResult = await new DeepSeekAiClient(deepseekConfig(), network).review(sampleInput);
    expect(networkHits).toBe(QA_CATEGORY_COUNT * 2);
    expect(networkResult.report?.checks).toHaveLength(11);
    expect(networkResult.report?.checks?.every((check) => check.status === 'GAP' && check.note === GAP_NOTE)).toBe(true);
    expect(networkResult.report?.clarifications).toHaveLength(11);
    expect(networkResult.report?.report_markdown).toContain('НЕ ВЫПОЛНЕНО');
    expect(networkResult.report?.report_markdown).toContain('Не выполнено: 11.');
    expect(JSON.stringify(networkResult)).not.toContain('test-deepseek-placeholder');
    expect(JSON.stringify(networkResult)).not.toContain('network down');
    expect(networkResult.report?.checks?.some((check) => check.status === 'PASS')).toBe(false);

    let httpHits = 0;
    const http: typeof fetch = async (_url, init) => {
      httpHits += 1;
      if (categoryOf(init) === 11) return jsonResponse({ error: 'test-deepseek-placeholder leaked' }, 502);
      return jsonResponse(completionBody(JSON.stringify(passAnswer())));
    };
    const partial = await new DeepSeekAiClient(deepseekConfig(), http).review(sampleInput);
    expect(httpHits).toBe(QA_CATEGORY_COUNT + 1);
    expect(partial.report?.checks?.find((check) => check.category === 11)).toEqual({ category: 11, status: 'GAP', note: GAP_NOTE });
    expect(partial.report?.checks?.find((check) => check.category === 1)?.status).toBe('PASS');
    expect(partial.report?.clarifications).toEqual([
      'Категория 11. Телефонный код формы: проверка не выполнена, пункт не закрыт.',
    ]);
    expect(JSON.stringify(partial)).not.toContain('test-deepseek-placeholder');
    expect(JSON.stringify(partial)).not.toContain('leaked');
    expect(JSON.stringify(partial)).not.toContain('HTTP 502');
  });

  it('retries a category that returns no status and then keeps the second verdict', async () => {
    const attempts = new Map<number, number>();
    const fetchImpl: typeof fetch = async (_url, init) => {
      const category = categoryOf(init);
      const attempt = (attempts.get(category) ?? 0) + 1;
      attempts.set(category, attempt);
      if (category === 4 && attempt === 1) return jsonResponse(completionBody('{"note":"без статуса"}'));
      if (category === 4) return jsonResponse(completionBody(JSON.stringify({ status: 'PASS', note: 'закрыто' })));
      if (category === 8) return jsonResponse(completionBody('{"clarifications":["не статус"]}'));
      return jsonResponse(completionBody(JSON.stringify(passAnswer())));
    };
    const result = await new DeepSeekAiClient(deepseekConfig(), fetchImpl).review(sampleInput);
    expect(attempts.get(4)).toBe(2);
    expect(attempts.get(8)).toBe(2);
    expect(attempts.get(1)).toBe(1);
    expect(result.report?.checks?.find((check) => check.category === 4)).toEqual({ category: 4, status: 'PASS', note: 'закрыто' });
    expect(result.report?.checks?.find((check) => check.category === 8)).toEqual({ category: 8, status: 'GAP', note: GAP_NOTE });
    expect(result.report?.report_markdown).toContain('8. Актуальность дат: НЕ ВЫПОЛНЕНО.');
    expect(result.report?.report_markdown).not.toContain('8. Актуальность дат: PASS');
    expect(result.report?.clarifications).toContain('Категория 8. Актуальность дат: проверка не выполнена, пункт не закрыт.');
  });

  it('records the requests that were built, including frames and a category whose later attempt fails', async () => {
    const attempts = new Map<number, number>();
    const calls: Array<{ init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      calls.push({ init });
      if (isVisionCall(init)) return jsonResponse(completionBody(JSON.stringify({ observations: [] })));
      const category = categoryOf(init);
      const attempt = (attempts.get(category) ?? 0) + 1;
      attempts.set(category, attempt);
      if (category === 11) throw new Error('category 11 down');
      return jsonResponse(completionBody(JSON.stringify(passAnswer())));
    };
    const header = Buffer.from([0xff, 0xd8, 0xff, 0x11]);
    const footer = Buffer.from([0xff, 0xd8, 0xff, 0x22]);
    const landingFooter = Buffer.from([0xff, 0xd8, 0xff, 0x33]);
    const preview = Buffer.from([0xff, 0xd8, 0xff, 0x44]);
    const known = new Map<string, string>([
      [desktopShotDataUrl(preview), 'preview'],
      [desktopShotDataUrl(landingFooter), 'landing_footer'],
      [desktopShotDataUrl(header), 'outlet_header'],
      [desktopShotDataUrl(footer), 'outlet_footer'],
    ]);
    const result = await new DeepSeekAiClient(deepseekConfig(), fetchImpl).review({
      ...sampleInput,
      pageText: 'marker-page-text-9f3a',
      previewShots: [preview],
      landingFooter,
      outlet: { name: 'NOS', url: 'https://nos.nl', header, footer },
    });
    const trace = result.ai_requests;
    if (!trace) throw new Error('missing ai_requests');
    expect(trace.calls.map((call) => (call.kind === 'vision' ? 'vision' : call.category))).toEqual([
      'vision',
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      10,
      11,
    ]);
    expect(attempts.get(11)).toBe(2);
    expect(trace.calls.filter((call) => call.category === 11)).toHaveLength(1);

    const categoryOne = trace.calls.find((call) => call.category === 1);
    expect(categoryOne).toMatchObject({ kind: 'category', category: 1, pixels: false, attachments: [] });

    const sentCategory = (category: number) =>
      JSON.parse(String(callFor(calls, category).init?.body)) as { model?: string; messages: Array<{ content: unknown }> };
    for (let category = 1; category <= QA_CATEGORY_COUNT; category += 1) {
      const call = trace.calls.find((item) => item.category === category);
      const sent = sentCategory(category);
      expect(call?.model).toBe(sent.model);
      expect(call?.system).toBe(sent.messages[0].content);
      expect(call?.system).toContain(categorySystemPrompt(category));
      const pixels = Array.isArray(sent.messages[1].content)
        && (sent.messages[1].content as Array<{ type?: string }>).some((part) => part?.type === 'image_url');
      expect(call?.pixels).toBe(pixels);
    }

    const categoryTwo = trace.calls.find((call) => call.category === 2);
    const sentTwoLabels = labelsFromImages(callFor(calls, 2).init, known);
    expect(categoryTwo?.pixels).toBe(true);
    expect(categoryTwo?.attachments).toEqual(['preview', 'outlet_header', 'outlet_footer']);
    expect(categoryTwo?.attachments).toEqual(sentTwoLabels);
    for (const label of categoryTwo?.attachments ?? []) {
      expect(trace.shots[label]).toBe(urlForLabel(known, label));
      expect(trace.shots[label]).toMatch(/^data:image\/jpeg;base64,/);
    }
    expect(trace.shots.outlet_header).toBe(desktopShotDataUrl(header));
    expect(trace.shots.outlet_footer).toBe(desktopShotDataUrl(footer));

    const visionSent = calls.find((call) => isVisionCall(call.init));
    const vision = trace.calls[0];
    const visionBody = JSON.parse(String(visionSent?.init?.body)) as { model?: string; messages: Array<{ content: unknown }> };
    expect(vision.kind).toBe('vision');
    expect(vision.category).toBeUndefined();
    expect(vision.pixels).toBe(true);
    expect(vision.model).toBe(visionBody.model);
    expect(vision.system).toBe(visionBody.messages[0].content);
    expect(vision.attachments).toEqual(labelsFromImages(visionSent?.init, known));
    expect(vision.attachments).toEqual(['preview', 'landing_footer', 'outlet_header', 'outlet_footer']);
    for (const label of vision.attachments) expect(trace.shots[label]).toBe(urlForLabel(known, label));

    const callsJson = JSON.stringify(trace.calls);
    expect(callsJson).not.toContain('data:image');
    expect(callsJson).not.toContain(desktopShotDataUrl(header));
    const traceJson = JSON.stringify(trace);
    expect(traceJson).not.toContain('marker-page-text-9f3a');
    expect(traceJson).not.toContain('test-deepseek-placeholder');
    expect(traceJson).not.toContain('category 11 down');

    let visionBuilt = false;
    const bare = await new DeepSeekAiClient(deepseekConfig(), async (_url, init) => {
      if (isVisionCall(init)) visionBuilt = true;
      return jsonResponse(completionBody(JSON.stringify(passAnswer())));
    }).review(sampleInput);
    expect(visionBuilt).toBe(false);
    expect(bare.ai_requests?.calls.map((call) => (call.kind === 'vision' ? 'vision' : call.category))).toEqual(
      Array.from({ length: QA_CATEGORY_COUNT }, (_, index) => index + 1),
    );
    expect(bare.ai_requests?.shots).toEqual({});
  });

  it('leaves the request trace unset for a stub review', async () => {
    const result = await new StubAiClient().review();
    expect(result).toEqual({ findings: [], usage: null, skipped: true });
    expect(result.ai_requests).toBeUndefined();
  });

  it('createAiClient stays stub when AI_MODE is not real and refuses real without a key', () => {
    expect(createAiClient(deepseekConfig({ aiMode: 'stub', aiApiKey: 'test-deepseek-placeholder' }))).toBeInstanceOf(
      StubAiClient,
    );
    expect(() => createAiClient(deepseekConfig({ aiMode: 'real', aiApiKey: '' }))).toThrow(/DEEPSEEK_API_KEY is required/);
  });

  it('createAiClient uses DeepSeek when real and a key is set', () => {
    expect(createAiClient(deepseekConfig({ aiMode: 'real', aiBaseUrl: '' }))).toBeInstanceOf(DeepSeekAiClient);
  });

  it('sends landing_preview_url and labels the preview jpeg as preview', async () => {
    const previewUrl = 'https://preview-track.invalid/?options=new-session&lp=card-1&launcher=L&suuid=S&cuuid=C';
    const desktop = Buffer.from([0xff, 0xd8, 0xff, 0x01]);
    const preview = Buffer.from([0xff, 0xd8, 0xff, 0x02]);
    const calls: Array<{ init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      calls.push({ init });
      if (isVisionCall(init)) return jsonResponse(completionBody(JSON.stringify({ observations: [] })));
      const category = categoryOf(init);
      const answer =
        category === 10
          ? { status: 'FAIL', findings: [{ file: 'index.html', quote: 'Hello', screenshot_ref: 'preview' }] }
          : passAnswer();
      return jsonResponse(completionBody(JSON.stringify(answer)));
    };
    const client = new DeepSeekAiClient(deepseekConfig(), fetchImpl);
    const result = await client.review({
      ...sampleInput,
      pageText: 'Hello',
      screenshot: desktop,
      landingPreviewUrl: previewUrl,
      previewShots: [preview],
      previewPageText: true,
    });
    const flash = JSON.parse(String(calls[0].init?.body)) as { model?: string; messages: Array<{ content: unknown }> };
    expect(flash.model).toBe('deepseek-flash');
    const parts = flash.messages[1].content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    expect(parts.map((part) => part.type)).toEqual(['text', 'image_url', 'image_url']);
    expect(userJson(parts[0].text as string)).not.toHaveProperty('category');
    expect(parts[1].image_url?.url).toBe(desktopShotDataUrl(desktop));
    expect(parts[2].image_url?.url).toBe(desktopShotDataUrl(preview));
    const categoryTen = callText(calls, 10);
    const payload = userJson(categoryTen);
    expect(payload.landing_preview_url).toBe(previewUrl);
    expect(payload.stand_url).toBe('https://example.invalid/stand');
    expect(payload.attachments_order).toEqual(['desktop', PREVIEW_SHOT]);
    expect(categoryTen).toContain('visual_observations');
    const categoryTenBody = JSON.parse(String(callFor(calls, 10).init?.body)) as {
      model?: string;
      messages: Array<{ content: unknown }>;
    };
    expect(categoryTenBody.model).toBe('deepseek-flash');
    const categoryTenParts = categoryTenBody.messages[1].content as Array<{ type: string; image_url?: { url: string } }>;
    expect(categoryTenParts.map((part) => part.type)).toEqual(['text', 'image_url', 'image_url']);
    expect(categoryTenParts[1].image_url?.url).toBe(desktopShotDataUrl(desktop));
    expect(categoryTenParts[2].image_url?.url).toBe(desktopShotDataUrl(preview));
    const categoryThreeBody = JSON.parse(String(callFor(calls, 3).init?.body)) as {
      model?: string;
      messages: Array<{ content: unknown }>;
    };
    expect(categoryThreeBody.model).toBe('deepseek-flash');
    const categoryThreeParts = categoryThreeBody.messages[1].content as Array<{ type: string; image_url?: { url: string } }>;
    expect(categoryThreeParts.map((part) => part.type)).toEqual(['text', 'image_url']);
    expect(categoryThreeParts[1].image_url?.url).toBe(desktopShotDataUrl(preview));
    expect(callText(calls, 3)).toContain('Кадры preview');
    expect(callText(calls, 3)).toContain('Кадры превью приложены в этом вызове');
    expect(callText(calls, 3)).not.toContain('Пикселей в этом вызове нет');
    expect(callText(calls, 3)).toContain('Сверь лицо');
    expect(callText(calls, 3)).toContain('гостю интервью');
    expect(callText(calls, 3)).toContain('Ссылку сам не открывай');
    expect(result.findings).toEqual([
      { file: 'index.html', quote: 'Hello', screenshot: desktopShotDataUrl(preview), category: 10 },
    ]);
    expect(QA_INSTRUCTION).not.toContain('landing_preview_url');

    const before = calls.length;
    await client.review({ ...sampleInput, landingPreviewUrl: previewUrl });
    const second = calls.slice(before);
    const textOnly = callText(second, 3);
    expect(userJson(textOnly).landing_preview_url).toBe(previewUrl);
    expect(userJson(textOnly).stand_url).toBe('https://example.invalid/stand');
    expect(userJson(textOnly).attachments_order).toEqual([]);
    expect(textOnly).toContain('кадров страницы нет');
    expect(textOnly).toContain('Не ставь визуальный FAIL');
    expect(JSON.parse(String(callFor(second, 3).init?.body)).model).toBe('deepseek-flash');
    expect(String(callFor(second, 3).init?.body)).not.toContain('image_url');
    const plain = JSON.parse(String(callFor(second, 1).init?.body)) as {
      model?: string;
      messages: Array<{ content: unknown }>;
    };
    expect(plain.model).toBe('deepseek-v4-pro');
    expect(typeof plain.messages[1].content).toBe('string');
    expect(String(callFor(second, 1).init?.body)).not.toContain('image_url');
  });

  it('drops incomplete findings', () => {
    expect(
      completeFindings([
        { file: 'a.html', quote: 'q', screenshot: 's' },
        { file: 'b.html', quote: 'q' },
        { file: '', quote: 'q', screenshot: 's' },
      ]),
    ).toEqual([{ file: 'a.html', quote: 'q', screenshot: 's' }]);
  });
});

describe('AI config defaults', () => {
  const required = {
    TL_LOGIN: 'env-tl',
    TL_PASSWORD: 'env-tl-pass',
    AIO_TOKEN: 'test-aio-token-value',
    FINGERPRINT_KEY: 'test-fingerprint-key',
    STORAGE: 'memory',
  };

  it('defaults to stub DeepSeek model without requiring a live key', () => {
    const config = loadConfig(required);
    expect(config.aiMode).toBe('stub');
    expect(config.aiModel).toBe('deepseek-v4-pro');
    expect(config.aiVisionModel).toBe('deepseek-flash');
    expect(config.aiBaseUrl).toBe(DEFAULT_DEEPSEEK_API_BASE);
    expect(config.aiApiKey).toBe('');
    expect(config.visualMode).toBe('stub');
    expect(config.visualChromePath).toBe('');
    expect(config.aioPreviewCampaignUuid).toBe('');
    expect(config.aioPreviewSourceUuid).toBe('');
    expect(config.aioPreviewDomainUuid).toBe('');
    expect(config.aioTenantId).toBe('');
    const preview = loadConfig({
      ...required,
      AIO_PREVIEW_CAMPAIGN_UUID: ' camp-uuid ',
      AIO_PREVIEW_SOURCE_UUID: 'source-uuid',
      AIO_PREVIEW_DOMAIN_UUID: '"domain-uuid"',
      AIO_TENANT_ID: " 'tenant-id-value' ",
    });
    expect(preview.aioPreviewCampaignUuid).toBe('camp-uuid');
    expect(preview.aioPreviewSourceUuid).toBe('source-uuid');
    expect(preview.aioPreviewDomainUuid).toBe('domain-uuid');
    expect(preview.aioTenantId).toBe('tenant-id-value');
    expect(config.lighthouseMode).toBe('stub');
    expect(config.standFormHtml).toBe(standFormHtml([]));
    expect(config.standFormHtml).toContain('type="tel"');
    expect(loadConfig({ ...required, STAND_FORM_HTML: '<div data-stand-form="1"></div>' }).standFormHtml).toBe(standFormHtml([]));
    expect(loadConfig({ ...required, STAND_FORM_HTML: '<b>CUSTOM</b>' }).standFormHtml).toBe('<b>CUSTOM</b>');
  });

  it('keeps a configured Chrome path and discovers a Windows browser only when the path is empty', () => {
    expect(resolveChromeExecutable('D:\\browser\\chrome.exe', () => false)).toBe('D:\\browser\\chrome.exe');
    if (process.platform !== 'win32') {
      expect(resolveChromeExecutable('', () => true)).toBe('');
      return;
    }
    const seen: string[] = [];
    const resolved = resolveChromeExecutable('  ', (candidate) => {
      seen.push(candidate);
      return /msedge\.exe$/i.test(candidate);
    });
    expect(resolved.toLowerCase()).toContain('msedge.exe');
    expect(seen[0].toLowerCase()).toContain('chrome.exe');
  });

  it('enables visual capture only for VISUAL_MODE=real and falls back to the lighthouse chrome path', () => {
    expect(loadConfig({ ...required, VISUAL_MODE: 'yes' }).visualMode).toBe('stub');
    const real = loadConfig({
      ...required,
      VISUAL_MODE: 'real',
      LIGHTHOUSE_CHROME_PATH: 'C:\\chrome\\chrome.exe',
    });
    expect(real.visualMode).toBe('real');
    expect(real.visualChromePath).toBe('C:\\chrome\\chrome.exe');
    const own = loadConfig({
      ...required,
      VISUAL_MODE: 'real',
      VISUAL_CHROME_PATH: 'D:\\browser\\chrome.exe',
      LIGHTHOUSE_CHROME_PATH: 'C:\\chrome\\chrome.exe',
    });
    expect(own.visualChromePath).toBe('D:\\browser\\chrome.exe');
    expect(wantsVisualCapture('stub', 'http://127.0.0.1/preview')).toBe(false);
    expect(wantsVisualCapture('real', null)).toBe(false);
    expect(wantsVisualCapture('real', 'http://127.0.0.1/preview')).toBe(true);
  });

  it('uses the visual chrome path when the lighthouse path is empty and stays stub unless mode is real', () => {
    const shared = loadConfig({
      ...required,
      VISUAL_CHROME_PATH: 'D:\\browser\\chrome.exe',
      LIGHTHOUSE_CHROME_PATH: '   ',
      LIGHTHOUSE_MODE: 'real',
    });
    expect(shared.lighthouseMode).toBe('real');
    expect(shared.lighthouseChromePath).toBe('D:\\browser\\chrome.exe');
    expect(shared.visualChromePath).toBe('D:\\browser\\chrome.exe');
    expect(shared.lighthouseNoSandbox).toBe(false);

    const own = loadConfig({
      ...required,
      VISUAL_CHROME_PATH: '"D:\\browser\\chrome.exe"',
      LIGHTHOUSE_CHROME_PATH: 'C:\\chrome\\chrome.exe',
      LIGHTHOUSE_MODE: 'yes',
    });
    expect(own.lighthouseMode).toBe('stub');
    expect(own.lighthouseChromePath).toBe('C:\\chrome\\chrome.exe');
    expect(own.visualChromePath).toBe('D:\\browser\\chrome.exe');
  });

  it('unwraps quotes and spaces around the DeepSeek key and the AIO token', () => {
    const config = loadConfig({
      ...required,
      AIO_TOKEN: ' "test-aio-token-value" ',
      DEEPSEEK_API_KEY: ' "test-deepseek-preferred" ',
    });
    expect(config.aiApiKey).toBe('test-deepseek-preferred');
    expect(config.aioToken).toBe('test-aio-token-value');
  });

  it('prefers DEEPSEEK_API_KEY over AI_API_KEY', () => {
    const config = loadConfig({
      ...required,
      DEEPSEEK_API_KEY: 'test-deepseek-preferred',
      AI_API_KEY: 'test-openai-style-fallback',
      GEMINI_API_KEY: 'test-gemini-ignored',
    });
    expect(config.aiApiKey).toBe('test-deepseek-preferred');
  });

  it('ignores GEMINI_API_KEY and GEMINI_API_BASE', () => {
    const ignored = loadConfig({
      ...required,
      GEMINI_API_KEY: 'test-gemini-ignored',
      GEMINI_API_BASE: 'https://generativelanguage.googleapis.com',
    });
    expect(ignored.aiApiKey).toBe('');
    expect(ignored.aiBaseUrl).toBe(DEFAULT_DEEPSEEK_API_BASE);
    expect(ignored.aiModel).toBe('deepseek-v4-pro');

    const fallback = loadConfig({
      ...required,
      GEMINI_API_KEY: 'test-gemini-ignored',
      GEMINI_API_BASE: 'https://generativelanguage.googleapis.com',
      AI_API_KEY: 'test-openai-style-fallback',
      AI_BASE_URL: 'https://api.deepseek.com/',
      AI_MODEL: 'deepseek-flash',
    });
    expect(fallback.aiApiKey).toBe('test-openai-style-fallback');
    expect(fallback.aiBaseUrl).toBe('https://api.deepseek.com');
    expect(fallback.aiModel).toBe('deepseek-flash');
    expect(fallback.aiVisionModel).toBe('deepseek-flash');
    expect(loadConfig({ ...required, AI_VISION_MODEL: ' custom-eyes ' }).aiVisionModel).toBe('custom-eyes');
    expect(loadConfig({ ...required, AI_MODEL: 'deepseek-v4-pro', AI_VISION_MODEL: 'deepseek-flash' }).aiModel).toBe(
      'deepseek-v4-pro',
    );
  });
});

describe('stand screenshot capture', () => {
  it('does not launch a browser when the chrome path is empty', async () => {
    await expect(captureStandJpeg('http://127.0.0.1/preview/1/index.html?t=secret', '  ')).rejects.toThrow('no-chrome');
  });
});

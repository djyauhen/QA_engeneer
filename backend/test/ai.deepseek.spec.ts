import {
  DeepSeekAiClient,
  StubAiClient,
  applyDesktopShot,
  completeFindings,
  createAiClient,
  desktopShotDataUrl,
  DEFAULT_DEEPSEEK_API_BASE,
  DEFAULT_DEEPSEEK_MODEL,
  DEEPSEEK_MAX_OUTPUT_TOKENS,
  DEEPSEEK_REASONING_EFFORT,
} from '../src/ai/ai.client';
import { MaterialImage } from '../src/ai/materials';
import { GAP_NOTE, QA_CATEGORY_COUNT, categorySystemPrompt } from '../src/ai/qa-categories';
import { ADDENDUM, QA_INSTRUCTION } from '../src/ai/qa-instruction';
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
    lighthouseMode: 'stub',
    lighthouseChromePath: '',
    lighthouseNoSandbox: false,
    visualMode: 'stub',
    visualChromePath: '',
    bcryptRounds: 4,
    poolMax: 10,
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
  return Number(userJson(messageText(body.messages[1].content)).category);
}

function callFor(calls: Array<{ init?: RequestInit }>, category: number): { init?: RequestInit } {
  const found = calls.filter((call) => categoryOf(call.init) === category);
  if (!found.length) throw new Error(`no call for category ${category}`);
  return found[found.length - 1];
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
    expect(body.model).toBe('deepseek-flash');
    expect(body.stream).toBe(false);
    expect(body.thinking).toEqual({ type: 'enabled' });
    expect(body.reasoning_effort).toBe(DEEPSEEK_REASONING_EFFORT);
    expect(body.max_tokens).toBe(DEEPSEEK_MAX_OUTPUT_TOKENS);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.tools).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('web_search');
    for (const category of [2, 3, 4]) {
      const categoryBody = JSON.parse(String(callFor(calls, category).init?.body)) as Record<string, unknown>;
      expect(categoryBody.tools).toBeUndefined();
      expect(JSON.stringify(categoryBody)).not.toContain('web_search');
      expect(categorySystemPrompt(category)).toContain('Этот вызов страницу не загружает');
      expect(categorySystemPrompt(category)).not.toContain('Интернет не открывай');
    }
    const messages = body.messages as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toBe(categorySystemPrompt(1));
    expect(messages[0].content).not.toContain('ровно 11');
    expect(messages[0].content).not.toContain('11. Телефонный код формы');
    expect(ADDENDUM).toContain('"report_markdown","general","checks","findings","clarifications","image_checks"');
    expect(ADDENDUM).toContain('screenshot_ref');
    expect(QA_INSTRUCTION).not.toContain(ADDENDUM);
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

  it('attaches a jpeg only to vision categories and replaces the desktop label', async () => {
    const calls: Array<{ init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      calls.push({ init });
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
    const textBody = JSON.parse(String(callFor(calls, 1).init?.body)) as { messages: Array<{ content: unknown }> };
    expect(typeof textBody.messages[1].content).toBe('string');
    const body = JSON.parse(String(callFor(calls, 2).init?.body)) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(typeof body.messages[0].content).toBe('string');
    const parts = body.messages[1].content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    expect(parts.map((part) => part.type)).toEqual(['text', 'image_url']);
    expect(userJson(parts[0].text as string).attachments_order).toEqual(['desktop']);
    expect(parts[0].text).toContain('никогда не base64');
    expect((parts[0].text as string).trimEnd().endsWith('ПРОВЕРЯЙ')).toBe(true);
    expect(parts[1].image_url?.url).toBe(desktopShotDataUrl(jpeg));
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
    const body = JSON.parse(String(callFor(calls, 3).init?.body)) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    const parts = body.messages[1].content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    expect(parts.map((part) => part.type)).toEqual(['text', 'image_url', 'image_url']);
    const payload = userJson(parts[0].text as string);
    expect(payload.page_text).toBe('Andrzej Duda speaks today');
    expect(payload.main_person_claim).toEqual(person);
    expect(payload.attachments_order).toEqual(['desktop', 'I1']);
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
    expect(parts[0].text).not.toContain(PNG_BYTES.toString('base64'));
    expect(parts[1].image_url?.url).toBe(desktopShotDataUrl(jpeg));
    const heroUrl = `data:image/png;base64,${PNG_BYTES.toString('base64')}`;
    expect(parts[2].image_url?.url).toBe(heroUrl);
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
    expect(parts[0].text).toContain('Проверь соответствие изображений I1');
    expect(String(callFor(calls, 1).init?.body)).not.toContain('image_url');
    expect(String(callFor(calls, 3).init?.body)).not.toContain('test-deepseek-placeholder');
  });

  it('builds a category 3 finding from image_checks mismatch', async () => {
    const fetchImpl: typeof fetch = async (_url, init) => {
      const category = categoryOf(init);
      const answer =
        category === 3
          ? { status: 'PASS', findings: [], image_checks: [{ ref: 'I1', match: 'mismatch', note: 'На фото другой человек' }] }
          : category === 10
            ? { status: 'PASS', note: 'ок', findings: [] }
            : passAnswer();
      return jsonResponse(completionBody(JSON.stringify(answer)));
    };
    const result = await new DeepSeekAiClient(deepseekConfig(), fetchImpl).review({
      ...sampleInput,
      pageText: 'Andrzej Duda speaks today',
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
    expect(result.report?.checks?.find((check) => check.category === 3)).toEqual({
      category: 3,
      status: 'FAIL',
      note: 'Изображение I1 не соответствует «Andrzej Duda»',
    });
    expect(result.report?.checks?.find((check) => check.category === 10)).toEqual({ category: 10, status: 'PASS', note: 'ок' });
    expect(result.report?.checks).toHaveLength(11);
  });

  it('attaches only landing images when there is no desktop shot', async () => {
    const calls: Array<{ init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      calls.push({ init });
      return jsonResponse(completionBody('{"findings":[]}'));
    };
    await new DeepSeekAiClient(deepseekConfig(), fetchImpl).review({ ...sampleInput, images: [heroImage] });
    const body = JSON.parse(String(callFor(calls, 3).init?.body)) as { messages: Array<{ content: unknown }> };
    const parts = body.messages[1].content as Array<{ type: string; text?: string }>;
    expect(parts.map((part) => part.type)).toEqual(['text', 'image_url']);
    expect(userJson(parts[0].text as string).attachments_order).toEqual(['I1']);
    const textOnly = JSON.parse(String(callFor(calls, 1).init?.body)) as { messages: Array<{ content: unknown }> };
    expect(typeof textOnly.messages[1].content).toBe('string');
  });

  it('attaches the official header and footer and refuses them as finding screenshots', async () => {
    const calls: Array<{ init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      calls.push({ init });
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
    const body = JSON.parse(String(callFor(calls, 2).init?.body)) as { messages: Array<{ content: unknown }> };
    const parts = body.messages[1].content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    expect(parts.map((part) => part.type)).toEqual(['text', 'image_url', 'image_url', 'image_url']);
    const payload = userJson(parts[0].text as string);
    expect(payload.attachments_order).toEqual(['landing_footer', 'outlet_header', 'outlet_footer']);
    expect(payload.outlet).toEqual({
      name: 'NOS',
      url: 'https://nos.nl',
      header_ref: 'outlet_header',
      footer_ref: 'outlet_footer',
    });
    expect(payload.landing_footer_ref).toBe('landing_footer');
    expect(parts[0].text).toContain('Категория 2: сравни');
    expect(parts[0].text).not.toContain('скриншотов оригинала издания нет');
    expect(parts[1].image_url?.url).toBe(desktopShotDataUrl(landingFooter));
    expect(parts[2].image_url?.url).toBe(desktopShotDataUrl(header));
    expect(result.findings).toEqual([
      { file: 'index.html', quote: 'NOS', screenshot: desktopShotDataUrl(landingFooter), category: 2 },
    ]);
    expect(result.report?.checks?.find((check) => check.category === 2)?.status).toBe('FAIL');
  });

  it('tells category 2 to use N/A only when outlet shots are missing', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      calls.push(String(init?.body));
      return jsonResponse(completionBody(JSON.stringify(passAnswer())));
    };
    const textAt = (index: number, category: number): string => {
      const batch = calls.slice(index * QA_CATEGORY_COUNT, (index + 1) * QA_CATEGORY_COUNT);
      const raw = batch.find((body) => {
        const parsed = JSON.parse(body) as { messages: Array<{ content: unknown }> };
        return Number(userJson(messageText(parsed.messages[1].content)).category) === category;
      });
      if (!raw) throw new Error(`missing category ${category} in review ${index}`);
      return messageText((JSON.parse(raw) as { messages: Array<{ content: unknown }> }).messages[1].content);
    };
    const client = new DeepSeekAiClient(deepseekConfig(), fetchImpl);
    await client.review({ ...sampleInput, pageText: 'NOS Nieuws' });
    const absentHeader = textAt(0, 2);
    const absentAmount = textAt(0, 6);
    expect(absentHeader).toContain('Категория 2: скриншотов оригинала издания нет, ставь N/A');
    expect(absentAmount).toContain('сумму депозита в USD не переводи');
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
    const presentHeader = textAt(1, 2);
    const presentPerson = textAt(1, 4);
    const presentAmount = textAt(1, 6);
    expect(presentHeader).toContain('Категория 2: сравни');
    expect(presentHeader).not.toContain('скриншотов оригинала издания нет');
    expect(presentHeader).not.toContain('ставь N/A');
    expect(presentPerson).toContain('fact_sheet.person (Ben Woldring');
    expect(presentAmount).toContain('Депозит в USD считай по fx_rates на 2026-10-27');
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

  it('createAiClient stays stub when AI_MODE is not real or the key is empty', () => {
    expect(createAiClient(deepseekConfig({ aiMode: 'stub', aiApiKey: 'test-deepseek-placeholder' }))).toBeInstanceOf(
      StubAiClient,
    );
    expect(createAiClient(deepseekConfig({ aiMode: 'real', aiApiKey: '' }))).toBeInstanceOf(StubAiClient);
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
    const vision = JSON.parse(String(callFor(calls, 10).init?.body)) as { messages: Array<{ content: unknown }> };
    const parts = vision.messages[1].content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    expect(parts.map((part) => part.type)).toEqual(['text', 'image_url', 'image_url']);
    const payload = userJson(parts[0].text as string);
    expect(payload.landing_preview_url).toBe(previewUrl);
    expect(payload.stand_url).toBe('https://example.invalid/stand');
    expect(payload.attachments_order).toEqual(['desktop', PREVIEW_SHOT]);
    expect(callText(calls, 3)).toContain('Кадры preview');
    expect(callText(calls, 3)).toContain('Сверь лицо');
    expect(callText(calls, 3)).toContain('Ссылку сам не открывай');
    expect(parts[1].image_url?.url).toBe(desktopShotDataUrl(desktop));
    expect(parts[2].image_url?.url).toBe(desktopShotDataUrl(preview));
    expect(result.findings).toEqual([
      { file: 'index.html', quote: 'Hello', screenshot: desktopShotDataUrl(preview), category: 10 },
    ]);
    expect(ADDENDUM).toContain('landing_preview_url');
    expect(ADDENDUM).toContain('"preview"');
    expect(ADDENDUM).toContain('не ставь визуальный FAIL');
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
    const plain = JSON.parse(String(callFor(second, 1).init?.body)) as { messages: Array<{ content: unknown }> };
    expect(typeof plain.messages[1].content).toBe('string');
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
    STORAGE: 'memory',
  };

  it('defaults to stub DeepSeek model without requiring a live key', () => {
    const config = loadConfig(required);
    expect(config.aiMode).toBe('stub');
    expect(config.aiModel).toBe('deepseek-flash');
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
      VERCEL: '1',
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
    expect(ignored.aiModel).toBe('deepseek-flash');

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
  });
});

describe('stand screenshot capture', () => {
  it('does not launch a browser when the chrome path is empty', async () => {
    await expect(captureStandJpeg('http://127.0.0.1/preview/1/index.html?t=secret', '  ')).rejects.toThrow('no-chrome');
  });
});

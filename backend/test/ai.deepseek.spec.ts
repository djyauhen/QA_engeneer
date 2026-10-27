import {
  AiCallError,
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
import { ADDENDUM, QA_INSTRUCTION } from '../src/ai/qa-instruction';
import { captureStandJpeg, wantsVisualCapture } from '../src/stand/capture';
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
  fx_rates: null,
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
  it('posts one chat completion with thinking, reasoning effort, and no live network', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse(
        completionBody(
          JSON.stringify({
            findings: [{ file: 'index.html', quote: 'Hello', screenshot: 'hero' }],
          }),
        ),
      );
    };
    const client = new DeepSeekAiClient(deepseekConfig(), fetchImpl);
    const result = await client.review(sampleInput);
    expect(calls).toHaveLength(1);
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].url).toBe(`${DEFAULT_DEEPSEEK_API_BASE}/chat/completions`);
    expect(calls[0].url).not.toContain('test-deepseek-placeholder');
    expect(calls[0].url).not.toMatch(/[?&]key=/);
    expect(headerValue(calls[0].init?.headers, 'authorization')).toBe('Bearer test-deepseek-placeholder');
    const body = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
    expect(body.model).toBe('deepseek-flash');
    expect(body.stream).toBe(false);
    expect(body.thinking).toEqual({ type: 'enabled' });
    expect(body.reasoning_effort).toBe(DEEPSEEK_REASONING_EFFORT);
    expect(body.max_tokens).toBe(DEEPSEEK_MAX_OUTPUT_TOKENS);
    expect(body.response_format).toEqual({ type: 'json_object' });
    const messages = body.messages as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content.startsWith(QA_INSTRUCTION)).toBe(true);
    expect(messages[0].content).toContain(ADDENDUM);
    expect(messages[0].content).toBe(`${QA_INSTRUCTION}\n\n${ADDENDUM}`);
    expect(ADDENDUM).toContain('"report_markdown","general","checks","findings","clarifications","image_checks"');
    expect(ADDENDUM).toContain('screenshot_ref');
    expect(QA_INSTRUCTION).not.toContain(ADDENDUM);
    expect(messages[1].role).toBe('user');
    expect(typeof messages[1].content).toBe('string');
    expect(userJson(messages[1].content)).toEqual(userPayload);
    expect(messages[1].content.trimEnd().split('\n').pop()).toBe('ПРОВЕРЯЙ');
    expect(messages[1].content).not.toContain('<html>Hello</html>');
    expect(String(calls[0].init?.body)).not.toContain('test-deepseek-placeholder');
    expect(result.findings).toEqual([{ file: 'index.html', quote: 'Hello', screenshot: 'hero' }]);
    expect(result.usage).toEqual({ prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 });
  });

  it('attaches a jpeg as image_url and replaces the desktop label', async () => {
    const calls: Array<{ init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      calls.push({ init });
      return jsonResponse(
        completionBody(
          JSON.stringify({
            findings: [{ file: 'index.html', quote: 'Hello', screenshot: 'desktop' }],
          }),
        ),
      );
    };
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const client = new DeepSeekAiClient(deepseekConfig(), fetchImpl);
    const result = await client.review({ ...sampleInput, screenshot: jpeg });
    const body = JSON.parse(String(calls[0].init?.body)) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(typeof body.messages[0].content).toBe('string');
    const parts = body.messages[1].content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    expect(parts.map((part) => part.type)).toEqual(['text', 'image_url']);
    expect(userJson(parts[0].text as string).attachments_order).toEqual(['desktop']);
    expect(parts[0].text).toContain('никогда не base64');
    expect((parts[0].text as string).trimEnd().endsWith('ПРОВЕРЯЙ')).toBe(true);
    expect(parts[1].image_url?.url).toBe(desktopShotDataUrl(jpeg));
    expect(result.findings).toEqual([{ file: 'index.html', quote: 'Hello', screenshot: desktopShotDataUrl(jpeg) }]);
    expect(applyDesktopShot([{ file: 'a.html', quote: 'q', screenshot: 'hero' }], desktopShotDataUrl(jpeg))).toEqual([
      { file: 'a.html', quote: 'q', screenshot: 'hero' },
    ]);
  });

  it('sends page_text, the person claim and landing images after the desktop shot, and maps I-refs to data URLs', async () => {
    const calls: Array<{ init?: RequestInit }> = [];
    const answer = {
      report_markdown: 'ОБЩАЯ ИНФОРМАЦИЯ\nGEO: Польша\n\nИТОГ\nОбщий результат: FAIL',
      general: { geo: 'Польша', main_person: 'Andrzej Duda' },
      checks: [
        { category: 10, status: 'FAIL', note: 'фото другого человека' },
        { category: 5, status: 'FAIL' },
        { category: 1, status: 'PASS' },
      ],
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
        { file: 'index.html', quote: 'invented quote', screenshot_ref: 'desktop', category: 5 },
      ],
      clarifications: ['Возраст не проверен'],
    };
    const fetchImpl: typeof fetch = async (_url, init) => {
      calls.push({ init });
      return jsonResponse(completionBody(JSON.stringify(answer)));
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
    const body = JSON.parse(String(calls[0].init?.body)) as {
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
    expect(result.report?.checks?.map((check) => [check.category, check.status])).toEqual([
      [1, 'PASS'],
      [5, 'N/A'],
      [10, 'FAIL'],
    ]);
    expect(result.report?.clarifications).toEqual(['Возраст не проверен']);
    expect(JSON.stringify(result)).not.toMatch(/verdict|overall_status/);
    expect(parts[0].text).toContain('Проверь соответствие изображений I1');
    expect(String(calls[0].init?.body)).not.toContain('test-deepseek-placeholder');
  });

  it('builds a category 10 finding from image_checks mismatch', async () => {
    const answer = {
      report_markdown: 'ИТОГ',
      checks: [{ category: 10, status: 'PASS' }],
      findings: [],
      image_checks: [{ ref: 'I1', match: 'mismatch', note: 'На фото другой человек' }],
    };
    const fetchImpl: typeof fetch = async () => jsonResponse(completionBody(JSON.stringify(answer)));
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
        category: 10,
        priority: 'major',
        where: 'images/hero.png',
        problem: 'На фото другой человек',
        expected: 'Изображение Andrzej Duda',
      },
    ]);
    expect(result.report?.checks).toEqual([
      { category: 10, status: 'FAIL', note: 'Изображение I1 не соответствует «Andrzej Duda»' },
    ]);
  });

  it('attaches only landing images when there is no desktop shot', async () => {
    const calls: Array<{ init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      calls.push({ init });
      return jsonResponse(completionBody('{"findings":[]}'));
    };
    await new DeepSeekAiClient(deepseekConfig(), fetchImpl).review({ ...sampleInput, images: [heroImage] });
    const body = JSON.parse(String(calls[0].init?.body)) as { messages: Array<{ content: unknown }> };
    const parts = body.messages[1].content as Array<{ type: string; text?: string }>;
    expect(parts.map((part) => part.type)).toEqual(['text', 'image_url']);
    expect(userJson(parts[0].text as string).attachments_order).toEqual(['I1']);
  });

  it('attaches the official header and footer and refuses them as finding screenshots', async () => {
    const calls: Array<{ init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      calls.push({ init });
      return jsonResponse(
        completionBody(
          JSON.stringify({
            findings: [
              { file: 'index.html', quote: 'NOS', screenshot_ref: 'outlet_header', category: 2 },
              { file: 'index.html', quote: 'NOS', screenshot_ref: 'landing_footer', category: 2 },
            ],
          }),
        ),
      );
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
    const body = JSON.parse(String(calls[0].init?.body)) as { messages: Array<{ content: unknown }> };
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
    expect(parts[0].text).toContain('Категория 2');
    expect(parts[1].image_url?.url).toBe(desktopShotDataUrl(landingFooter));
    expect(parts[2].image_url?.url).toBe(desktopShotDataUrl(header));
    expect(result.findings).toEqual([
      { file: 'index.html', quote: 'NOS', screenshot: desktopShotDataUrl(landingFooter), category: 2 },
    ]);
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
    const fetchImpl: typeof fetch = async () =>
      jsonResponse(
        completionBody('```json\n{"findings":[{"file":"a.html","quote":"q","screenshot":"s"}]}\n```', null),
      );
    const client = new DeepSeekAiClient(deepseekConfig(), fetchImpl);
    const result = await client.review({ ...sampleInput, standUrl: null });
    expect(result.findings).toEqual([{ file: 'a.html', quote: 'q', screenshot: 's' }]);
    expect(result.usage).toBeNull();
  });

  it('keeps the generic AI error and does not include the key or response body', async () => {
    const network: typeof fetch = async () => {
      throw new Error('network down test-deepseek-placeholder');
    };
    const http: typeof fetch = async () => jsonResponse({ error: 'test-deepseek-placeholder leaked' }, 502);
    const networkError = await new DeepSeekAiClient(deepseekConfig(), network).review(sampleInput).then(
      () => null,
      (error: unknown) => error,
    );
    const httpError = await new DeepSeekAiClient(deepseekConfig(), http).review(sampleInput).then(
      () => null,
      (error: unknown) => error,
    );
    expect(networkError).toBeInstanceOf(AiCallError);
    expect(httpError).toBeInstanceOf(AiCallError);
    expect((networkError as AiCallError).message).toBe('Сбой вызова ИИ');
    expect((httpError as AiCallError).message).toBe('Сбой вызова ИИ');
    expect((networkError as AiCallError).detail).not.toContain('test-deepseek-placeholder');
    expect((httpError as AiCallError).detail).toMatch(/HTTP 502/);
    expect((httpError as AiCallError).detail).not.toContain('test-deepseek-placeholder');
    expect((httpError as AiCallError).detail).not.toContain('leaked');
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
    expect(config.lighthouseMode).toBe('stub');
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

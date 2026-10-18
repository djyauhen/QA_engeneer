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
};

const userPayload = {
  name: 'Lander',
  languages: ['en'],
  countries: ['CA'],
  stand_url: 'https://example.invalid/stand',
  files: [{ path: 'index.html', text: '<html>Hello</html>' }],
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
    expect(messages[0].content).toContain('Ты проверяешь лендинг и только перечисляешь дефекты.');
    expect(messages[0].content).toContain('Верни JSON {"findings"');
    expect(messages[1]).toEqual({ role: 'user', content: JSON.stringify(userPayload) });
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
    expect(parts[0].text).toContain('"shot":"desktop"');
    expect(parts[0].text).toContain('поставь ровно desktop');
    expect(parts[1].image_url?.url).toBe(desktopShotDataUrl(jpeg));
    expect(result.findings).toEqual([{ file: 'index.html', quote: 'Hello', screenshot: desktopShotDataUrl(jpeg) }]);
    expect(applyDesktopShot([{ file: 'a.html', quote: 'q', screenshot: 'hero' }], desktopShotDataUrl(jpeg))).toEqual([
      { file: 'a.html', quote: 'q', screenshot: 'hero' },
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

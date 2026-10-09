import {
  GeminiAiClient,
  StubAiClient,
  completeFindings,
  createAiClient,
  DEFAULT_GEMINI_API_BASE,
  DEFAULT_GEMINI_MODEL,
} from '../src/ai/ai.client';
import { AppConfig, loadConfig } from '../src/config';

function geminiConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    storage: 'memory',
    databaseUrl: '',
    aioToken: 'test-aio-token-value',
    aioBaseUrl: 'https://app.aio.tech',
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
    aiBaseUrl: DEFAULT_GEMINI_API_BASE,
    aiApiKey: 'test-gemini-placeholder',
    aiModel: DEFAULT_GEMINI_MODEL,
    lighthouseMode: 'stub',
    lighthouseChromePath: '',
    bcryptRounds: 4,
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('Gemini generateContent client', () => {
  it('posts generateContent with model id, contents, generationConfig, and no live network', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    findings: [{ file: 'index.html', quote: 'Hello', screenshot: 'hero' }],
                  }),
                },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 3 },
      });
    };
    const client = new GeminiAiClient(geminiConfig(), fetchImpl);
    const result = await client.review(sampleInput);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('generateContent');
    expect(calls[0].url).toContain(DEFAULT_GEMINI_MODEL);
    expect(calls[0].url).toMatch(/\/v1beta\/models\/gemini-3\.5-flash-lite:generateContent$/);
    expect(calls[0].url).not.toContain('test-gemini-placeholder');
    expect(calls[0].url).not.toMatch(/[?&]key=/);
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe('test-gemini-placeholder');
    expect(headers.authorization).toBeUndefined();
    const body = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: JSON.stringify({
        name: 'Lander',
        languages: ['en'],
        countries: ['CA'],
        stand_url: 'https://example.invalid/stand',
        files: [{ path: 'index.html', text: '<html>Hello</html>' }],
      }) }] },
    ]);
    expect(body.generationConfig).toEqual({ responseMimeType: 'application/json' });
    expect(body.tools).toEqual([{ urlContext: {} }]);
    expect(result.findings).toEqual([{ file: 'index.html', quote: 'Hello', screenshot: 'hero' }]);
    expect(result.usage).toEqual({ promptTokenCount: 9, candidatesTokenCount: 3 });
  });

  it('omits urlContext for localhost stand URLs', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ candidates: [{ content: { parts: [{ text: '{"findings":[]}' }] } }] });
    };
    const client = new GeminiAiClient(geminiConfig(), fetchImpl);
    await client.review({ ...sampleInput, standUrl: 'http://127.0.0.1:3000/preview/check' });
    const body = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
    expect(body.tools).toBeUndefined();
  });

  it('strips markdown fences from model text', async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '```json\n{"findings":[{"file":"a.html","quote":"q","screenshot":"s"}]}\n```',
                },
              ],
            },
          },
        ],
      });
    const client = new GeminiAiClient(geminiConfig(), fetchImpl);
    const result = await client.review({ ...sampleInput, standUrl: null });
    expect(result.findings).toEqual([{ file: 'a.html', quote: 'q', screenshot: 's' }]);
  });

  it('keeps the generic AI error and does not include the key', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error('network');
    };
    const client = new GeminiAiClient(geminiConfig(), fetchImpl);
    await expect(client.review(sampleInput)).rejects.toThrow('Сбой вызова ИИ');
  });

  it('createAiClient stays stub when AI_MODE is not real', () => {
    expect(createAiClient(geminiConfig({ aiMode: 'stub', aiApiKey: 'test-gemini-placeholder' }))).toBeInstanceOf(
      StubAiClient,
    );
  });

  it('createAiClient uses Gemini when real and a key is set', () => {
    expect(createAiClient(geminiConfig({ aiMode: 'real', aiBaseUrl: '' }))).toBeInstanceOf(GeminiAiClient);
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

  it('defaults to stub Gemini model without requiring a live key', () => {
    const config = loadConfig(required);
    expect(config.aiMode).toBe('stub');
    expect(config.aiModel).toBe('gemini-3.5-flash-lite');
    expect(config.aiBaseUrl).toBe(DEFAULT_GEMINI_API_BASE);
    expect(config.aiApiKey).toBe('');
  });

  it('prefers GEMINI_API_KEY over AI_API_KEY', () => {
    const config = loadConfig({
      ...required,
      GEMINI_API_KEY: 'test-gemini-preferred',
      AI_API_KEY: 'test-openai-style-fallback',
    });
    expect(config.aiApiKey).toBe('test-gemini-preferred');
  });
});

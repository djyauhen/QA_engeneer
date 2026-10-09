import { HttpAioClient, buildTablesBody, collectCatalogRows } from '../src/aio/aio.client';
import { AppConfig } from '../src/config';
import { METRIC_STUB } from '../src/tokens';

function config(): AppConfig {
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
    aiMode: 'stub',
    aiBaseUrl: '',
    aiApiKey: '',
    aiModel: 'gemini-3.5-flash-lite',
    lighthouseMode: 'stub',
    lighthouseChromePath: '',
    bcryptRounds: 4,
  };
}

describe('AIO client', () => {
  it('pages until 300 rows or the list ends, with token query and without auth headers', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (String(url).includes('tables/data')) {
        const body = JSON.parse(String(init?.body));
        const page = body.request['Funnel\\Landers'].page as number;
        const rows = page < 7 ? Array.from({ length: 50 }, (_, index) => ({ n: (page - 1) * 50 + index })) : [];
        return jsonResponse({
          'Funnel\\Landers': { response: { rows, next: page < 6, columns: ['ignore'] } },
        });
      }
      throw new Error(`unexpected ${url}?token=test-aio-token-value`);
    };
    const client = new HttpAioClient(config(), fetchImpl);
    const rows = await client.loadCatalogRows();
    expect(rows).toHaveLength(300);
    expect(calls).toHaveLength(6);
    for (const call of calls) {
      const url = new URL(call.url);
      expect(url.searchParams.get('token')).toBe('test-aio-token-value');
      const headers = new Headers(call.init?.headers);
      expect(headers.get('authorization')).toBeNull();
      expect(headers.get('cookie')).toBeNull();
      expect(headers.get('x-tenant-id')).toBeNull();
    }
    const table = (buildTablesBody(1).request as Record<string, { metrics: string[]; sort_key: string; sort_direction: string; filters: unknown[]; limit: number }>)[
      'Funnel\\Landers'
    ];
    expect(table.metrics).toEqual([METRIC_STUB]);
    expect(table.sort_key).toBe('_identity');
    expect(table.sort_direction).toBe('desc');
    expect(table.filters).toEqual([]);
    expect(table.limit).toBe(50);
  });

  it('stops when next is false and never echoes the token from a transport error', async () => {
    const rows = await collectCatalogRows(async () => ({ rows: [{ id: 1 }], next: false }));
    expect(rows).toHaveLength(1);
    const empty = await collectCatalogRows(async () => ({ rows: [], next: true }));
    expect(empty).toHaveLength(0);
    const client = new HttpAioClient(config(), async (url) => {
      throw new Error(`network ${url}`);
    });
    await expect(client.loadCatalogRows()).rejects.toThrow('Сбой вызова AIO');
    try {
      await client.loadCatalogRows();
      throw new Error('expected failure');
    } catch (error) {
      expect(String(error)).not.toContain('test-aio-token-value');
      expect(String(error)).not.toContain('sign' + 'ature=');
    }
  });

  it('requests original only and does not treat the process response as a file', async () => {
    const signed = (kind: string) => `https://app.aio.tech/${kind}?${'sign' + 'ature'}=secret`;
    const fetchImpl = async (url: string, init?: RequestInit) => {
      if (String(url).includes('/actions/process')) {
        expect(init?.body).toBeInstanceOf(FormData);
        const form = init?.body as FormData;
        expect(form.get('action')).toBe('Lander\\Download');
        expect(form.get('uuids[0]')).toBe('uuid-1');
        return jsonResponse({
          messages: [{ message: 'Download Requested' }],
          primary: 'uuid-1',
          uuid: 'uuid-1',
        });
      }
      if (String(url).includes('/notifications')) {
        return jsonResponse({
          data: {
            data: [
              {
                notification: {
                  type: 'lander.download',
                  payload: {
                    status: 'done',
                    lander_uuid: 'uuid-1',
                    files: [
                      { kind: 'merged', url: signed('merged') },
                      { kind: 'original', url: signed('original') },
                    ],
                  },
                },
              },
            ],
          },
        });
      }
      if (String(url).includes('/original')) {
        expect(String(url)).toContain('token=test-aio-token-value');
        expect(String(url)).not.toContain('merged');
        return new Response(Buffer.from('zip-bytes'), { status: 200 });
      }
      return new Response('no', { status: 404 });
    };
    const client = new HttpAioClient(config(), fetchImpl);
    await client.requestDownload('uuid-1');
    const file = await client.findOriginal('uuid-1');
    const bytes = await file.read();
    expect(bytes.toString()).toBe('zip-bytes');
    expect(JSON.stringify(file)).not.toContain('sign' + 'ature');
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

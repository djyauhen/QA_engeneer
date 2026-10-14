import { AioDownloadError, HttpAioClient, buildTablesBody, collectCatalogRows } from '../src/aio/aio.client';
import { CatalogQuery } from '../src/catalog/catalog-query';
import { AppConfig } from '../src/config';
import { METRIC_STUB } from '../src/tokens';

function config(): AppConfig {
  return {
    storage: 'memory',
    databaseUrl: '',
    aioToken: 'test-aio-token-value',
    aioBaseUrl: 'https://app.aio.tech',
    aioStorageHosts: ['files.aio.tech'],
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
    aiModel: 'deepseek-flash',
    lighthouseMode: 'stub',
    lighthouseChromePath: '',
    lighthouseNoSandbox: false,
    bcryptRounds: 4,
    poolMax: 10,
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
    const table = landerTable(buildTablesBody(1));
    expect(table.metrics).toEqual([METRIC_STUB]);
    expect(table.sort_key).toBe('_identity');
    expect(table.sort_direction).toBe('desc');
    expect(table.filters).toEqual([]);
    expect(table.search).toBe('');
    expect(table.limit).toBe(50);
    expect(table).not.toHaveProperty('dates');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual(buildTablesBody(1));
  });

  it('puts the saved search, mode filter, and dates into the AIO body and leaves sort and limit', async () => {
    const query: CatalogQuery = {
      search: '359',
      filters: [{ key: 'mode', operator: 'in', value: ['Editor'] }],
      dates: ['2026-10-01 00:00:00', '2026-10-31 23:59:59', 'Europe/Minsk'],
    };
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse({ 'Funnel\\Landers': { response: { rows: [{ n: 1 }], next: false } } });
    };
    const client = new HttpAioClient(config(), fetchImpl);
    await client.loadCatalogRows(query);
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0].url);
    expect(url.searchParams.get('token')).toBe('test-aio-token-value');
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get('authorization')).toBeNull();
    const body = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
    expect(body).toEqual(buildTablesBody(1, query));
    expect(JSON.stringify(body)).not.toContain('test-aio-token-value');
    const table = landerTable(body);
    expect(table.search).toBe('359');
    expect(table.filters).toEqual(query.filters);
    expect(table.dates).toEqual(query.dates);
    expect(table.sort_key).toBe('_identity');
    expect(table.sort_direction).toBe('desc');
    expect(table.limit).toBe(50);
    expect(table.metrics).toEqual([METRIC_STUB]);
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
    const refused = new HttpAioClient(config(), async () => new Response('no', { status: 401 }));
    await expect(refused.requestDownload('uuid-1')).rejects.toThrow('Сбой вызова AIO: HTTP 401');
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

  it('fetches a signed storage url unchanged and keeps a failed status without the url', async () => {
    const fileUrl =
      'https://app.aio.tech/api/v1/storage/download?disk=digitalocean&expires=1791996754&key=production%2Fexports%2Ffile.zip&ngsw-bypass=true&' +
      'sign' +
      'ature=abc';
    const calls: string[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      const href = String(url);
      calls.push(href);
      if (href.includes('/notifications')) {
        return jsonResponse({
          data: {
            data: [
              {
                notification: {
                  type: 'lander.download',
                  payload: {
                    status: 'done',
                    lander_uuid: 'uuid-1',
                    files: [{ kind: 'original', url: fileUrl }],
                  },
                },
              },
            ],
          },
        });
      }
      expect(href).toBe(fileUrl);
      expect(href).not.toContain('token=');
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBeNull();
      expect(headers.get('cookie')).toBeNull();
      return new Response('no', { status: 403 });
    };
    const client = new HttpAioClient(config(), fetchImpl);
    const file = await client.findOriginal('uuid-1');
    await expect(file.read()).rejects.toBeInstanceOf(AioDownloadError);
    try {
      await file.read();
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toMatchObject({ status: 403, permanent: true });
      const text = String(error);
      expect(text).toContain('HTTP 403');
      expect(text).not.toContain('test-aio-token-value');
      expect(text).not.toContain('sign' + 'ature');
      expect(text).not.toContain('storage/download');
      expect(text).not.toContain('%2F');
    }
    expect(calls.filter((href) => href === fileUrl)).toHaveLength(2);
  });

  it('does not attach the token or follow a foreign download url', async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(String(url));
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
                    files: [{ kind: 'original', url: 'https://evil.test/land.zip' }],
                  },
                },
              },
            ],
          },
        });
      }
      return new Response('should-not-download', { status: 200 });
    };
    const client = new HttpAioClient(config(), fetchImpl);
    const file = await client.findOriginal('uuid-1');
    await expect(file.read()).rejects.toMatchObject({ permanent: true });
    expect(calls.some((href) => href.includes('evil.test'))).toBe(false);
    expect(calls.some((href) => href.includes('token=test-aio-token-value') && href.includes('evil.test'))).toBe(false);
  });
});

function landerTable(body: Record<string, unknown>): Record<string, unknown> {
  const requestBody = body.request as Record<string, Record<string, unknown>>;
  return requestBody['Funnel\\Landers'];
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

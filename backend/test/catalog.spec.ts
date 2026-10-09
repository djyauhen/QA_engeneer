import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { buildTablesBody } from '../src/aio/aio.client';
import { CatalogQuery } from '../src/catalog/catalog-query';
import { mapAioRow, sortByHumanIdDesc } from '../src/catalog/map-row';
import { MemoryCatalogRepo } from '../src/storage/memory-repos';
import { CATALOG_REPO } from '../src/tokens';
import { createTestApp, TestApp } from './app';
import { aioRow } from './fakes';

const SAVED_QUERY: CatalogQuery = {
  search: '359',
  filters: [{ key: 'mode', operator: 'in', value: ['Editor'] }],
  dates: ['2026-10-01 00:00:00', '2026-10-31 23:59:59', 'Europe/Minsk'],
};

describe('catalog', () => {
  let ctx: TestApp;
  let http: INestApplication;
  let session: string;

  beforeEach(async () => {
    ctx = await createTestApp();
    http = ctx.app;
    const login = await request(http.getHttpServer()).post('/session').send({ login: 'env-tl', password: 'env-tl-pass' });
    session = login.body.session_id;
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('maps identity fields, keeps a missing created_at, and drops rows without uuid or human_id', () => {
    const kept = mapAioRow(
      aioRow({
        human_id: '359226',
        uuid: '11111111-1111-4111-8111-111111111111',
        identityCreatedAt: '2026-10-07T16:00:23.000000Z',
        metric: 5,
      }),
    );
    expect(kept?.human_id).toBe('359226');
    expect(kept?.created_at).toBe('');
    expect(kept && 'metric_stub' in kept).toBe(false);
    expect(mapAioRow(aioRow({ uuid: 'u', omitHumanId: true, topHumanId: '999' }))).toBeNull();
    expect(mapAioRow({ _identity: { human_id: '1' } })).toBeNull();
  });

  it('sorts the screen by numeric human_id and refreshes immediately without a second GET call', async () => {
    ctx.aio.rows = [
      aioRow({ human_id: '9', uuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', created_at: 'a', name: 'nine' }),
      aioRow({ human_id: '100', uuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', created_at: 'b', name: 'hundred' }),
      aioRow({ human_id: '30', uuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', created_at: 'c', name: 'thirty' }),
    ];
    const refreshed = await request(http.getHttpServer()).post('/catalog/refresh').set('x-session-id', session);
    expect(refreshed.status).toBe(200);
    expect(ctx.aio.catalogCalls).toBe(1);
    expect(refreshed.body.items.map((item: { human_id: string }) => item.human_id)).toEqual(['100', '30', '9']);
    expect(refreshed.body.refreshed_at).toEqual(expect.any(String));
    expect(refreshed.body.query).toEqual({ search: '', filters: [], dates: null });
    expect(Object.keys(refreshed.body.items[0]).sort()).toEqual(['created_at', 'human_id', 'name', 'uuid']);
    const again = await request(http.getHttpServer()).get('/catalog').set('x-session-id', session);
    expect(again.body.items[0].human_id).toBe('100');
    expect(ctx.aio.catalogCalls).toBe(1);
    const stored = await (ctx.repos.catalog as MemoryCatalogRepo).load();
    expect(stored.some((row) => Object.keys(row).some((key) => key.startsWith('metric')))).toBe(false);
    expect(sortByHumanIdDesc(stored).map((row) => row.human_id)).toEqual(['100', '30', '9']);
  });

  it('does not download on a miss, a collision, or a pair miss', async () => {
    const miss = await request(http.getHttpServer())
      .post('/checks')
      .set('x-session-id', session)
      .send({ human_id: '359226' });
    expect(miss.status).toBe(404);
    expect(miss.body.error).toBe('not_found');
    expect(ctx.aio.catalogCalls).toBe(1);
    expect(ctx.aio.downloadRequests).toEqual([]);

    ctx.aio.rows = [
      aioRow({ human_id: '359226', uuid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', name: 'one' }),
      aioRow({ human_id: '359226', uuid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', name: 'two' }),
    ];
    await request(http.getHttpServer()).post('/catalog/refresh').set('x-session-id', session);
    const callsAfterRefresh = ctx.aio.catalogCalls;
    const collision = await request(http.getHttpServer())
      .post('/checks')
      .set('x-session-id', session)
      .send({ human_id: '359226' });
    expect(collision.status).toBe(409);
    expect(collision.body.rows).toHaveLength(2);
    expect(collision.body.rows.map((row: { uuid: string }) => row.uuid).sort()).toEqual([
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    ]);
    expect(ctx.aio.downloadRequests).toEqual([]);
    expect(ctx.aio.catalogCalls).toBe(callsAfterRefresh);

    const pairMiss = await request(http.getHttpServer())
      .post('/checks')
      .set('x-session-id', session)
      .send({ human_id: '359226', uuid: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc9' });
    expect(pairMiss.status).toBe(404);
    expect(pairMiss.body.error).toBe('pair_not_found');
    expect(ctx.aio.downloadRequests).toEqual([]);
    expect(ctx.aio.catalogCalls).toBe(callsAfterRefresh);

    const pair = await request(http.getHttpServer())
      .post('/checks')
      .set('x-session-id', session)
      .send({ human_id: '359226', uuid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2' });
    expect(pair.status).toBe(201);
    expect(ctx.aio.downloadRequests).toEqual(['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2']);
  });

  it('uses an empty saved query as the previous AIO body', async () => {
    const saved = await request(http.getHttpServer()).get('/admin/catalog-query').set('x-session-id', session);
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ search: '', filters: [], dates: null });
    const screen = await request(http.getHttpServer()).get('/catalog').set('x-session-id', session);
    expect(screen.status).toBe(200);
    expect(screen.body.items).toEqual([]);
    expect(screen.body.refreshed_at).toBeNull();
    expect(screen.body.query).toEqual(saved.body);

    const refreshed = await request(http.getHttpServer()).post('/catalog/refresh').set('x-session-id', session);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.query).toEqual(saved.body);
    expect(refreshed.body.refreshed_at).toEqual(expect.any(String));
    expect(ctx.aio.catalogQueries).toEqual([saved.body]);
    const table = landerTable(buildTablesBody(1, ctx.aio.catalogQueries[0]));
    expect(table.search).toBe('');
    expect(table.filters).toEqual([]);
    expect(table).not.toHaveProperty('dates');
    expect(table.sort_key).toBe('_identity');
    expect(table.sort_direction).toBe('desc');
    expect(table.limit).toBe(50);
  });

  it('sends the saved search, mode filter, and dates on refresh and on a cache miss', async () => {
    const put = await request(http.getHttpServer())
      .put('/admin/catalog-query')
      .set('x-session-id', session)
      .send({ ...SAVED_QUERY, search: '  359  ' });
    expect(put.status).toBe(200);
    expect(put.body).toEqual(SAVED_QUERY);
    expect(ctx.aio.catalogCalls).toBe(0);

    ctx.aio.rows = [aioRow({ human_id: '42', uuid: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', name: 'saved' })];
    const refreshed = await request(http.getHttpServer()).post('/catalog/refresh').set('x-session-id', session);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.query).toEqual(SAVED_QUERY);
    expect(refreshed.body.refreshed_at).toEqual(expect.any(String));
    expect(refreshed.body.items.map((item: { human_id: string }) => item.human_id)).toEqual(['42']);
    const table = landerTable(buildTablesBody(1, ctx.aio.catalogQueries[0]));
    expect(table.search).toBe('359');
    expect(table.filters).toEqual(SAVED_QUERY.filters);
    expect(table.dates).toEqual(SAVED_QUERY.dates);
    expect(table.sort_key).toBe('_identity');
    expect(table.sort_direction).toBe('desc');
    expect(table.limit).toBe(50);

    const screen = await request(http.getHttpServer()).get('/catalog').set('x-session-id', session);
    expect(screen.body.query).toEqual(SAVED_QUERY);
    expect(screen.body.refreshed_at).toBe(refreshed.body.refreshed_at);

    const miss = await request(http.getHttpServer())
      .post('/checks')
      .set('x-session-id', session)
      .send({ human_id: '404404' });
    expect(miss.status).toBe(404);
    expect(miss.body.error).toBe('not_found');
    expect(ctx.aio.catalogCalls).toBe(2);
    expect(ctx.aio.catalogQueries).toEqual([SAVED_QUERY, SAVED_QUERY]);
    expect(ctx.aio.downloadRequests).toEqual([]);
  });

  it('rejects an invalid filter or dates with 400 and does not call AIO', async () => {
    const token = 'test-aio-token-value';
    const kept = await request(http.getHttpServer())
      .put('/admin/catalog-query')
      .set('x-session-id', session)
      .send(SAVED_QUERY);
    expect(kept.status).toBe(200);

    const badFilter = await request(http.getHttpServer())
      .put('/admin/catalog-query')
      .set('x-session-id', session)
      .send({
        search: token,
        filters: [{ key: 'status', operator: 'eq', value: [token] }],
        dates: null,
      });
    expect(badFilter.status).toBe(400);
    expect(badFilter.body.message).toBe('Допустим только фильтр mode');
    expect(JSON.stringify(badFilter.body)).not.toContain(token);

    const badDates = await request(http.getHttpServer())
      .put('/admin/catalog-query')
      .set('x-session-id', session)
      .send({
        search: '',
        filters: [],
        dates: ['2026-10-01', '2026-10-31', 'Europe/Minsk'],
      });
    expect(badDates.status).toBe(400);
    expect(badDates.body.message).toBe('Начало и конец dates задаются как YYYY-MM-DD HH:mm:ss');
    expect(JSON.stringify(badDates.body)).not.toContain(token);

    const reversed = await request(http.getHttpServer())
      .put('/admin/catalog-query')
      .set('x-session-id', session)
      .send({
        search: '',
        filters: [],
        dates: ['2026-10-31 00:00:00', '2026-10-01 00:00:00', 'Europe/Minsk'],
      });
    expect(reversed.status).toBe(400);
    expect(reversed.body.message).toBe('Начало dates позже конца');

    const extra = await request(http.getHttpServer())
      .put('/admin/catalog-query')
      .set('x-session-id', session)
      .send({ ...SAVED_QUERY, metric_filters: [] });
    expect(extra.status).toBe(400);
    expect(extra.body.message).toBe('Неизвестное поле запроса каталога');

    expect(ctx.aio.catalogCalls).toBe(0);
    const still = await request(http.getHttpServer()).get('/admin/catalog-query').set('x-session-id', session);
    expect(still.body).toEqual(SAVED_QUERY);
    expect(JSON.stringify(still.body)).not.toContain(token);
  });

  it('refuses the catalog query to QA the same way as admin rules', async () => {
    await request(http.getHttpServer())
      .post('/admin/users')
      .set('x-session-id', session)
      .send({ login: 'qa-1', password: 'qa-pass-value', role: 'QA' });
    const qaLogin = await request(http.getHttpServer()).post('/session').send({ login: 'qa-1', password: 'qa-pass-value' });
    const qa = qaLogin.body.session_id as string;
    const deniedGet = await request(http.getHttpServer()).get('/admin/catalog-query').set('x-session-id', qa);
    const deniedPut = await request(http.getHttpServer())
      .put('/admin/catalog-query')
      .set('x-session-id', qa)
      .send(SAVED_QUERY);
    expect(deniedGet.status).toBe(403);
    expect(deniedPut.status).toBe(403);
    expect(deniedGet.body).toEqual({ error: 'forbidden', message: 'Недостаточно прав' });
    expect(deniedPut.body).toEqual(deniedGet.body);
    expect(ctx.aio.catalogCalls).toBe(0);
    const still = await request(http.getHttpServer()).get('/admin/catalog-query').set('x-session-id', session);
    expect(still.body).toEqual({ search: '', filters: [], dates: null });
    const screen = await request(http.getHttpServer()).get('/catalog').set('x-session-id', qa);
    expect(screen.status).toBe(200);
    expect(screen.body.query).toEqual(still.body);
  });
});

function landerTable(body: Record<string, unknown>): Record<string, unknown> {
  const requestBody = body.request as Record<string, Record<string, unknown>>;
  return requestBody['Funnel\\Landers'];
}

describe('catalog repo token', () => {
  it('is the memory repo in tests', async () => {
    const ctx = await createTestApp();
    expect(ctx.app.get(CATALOG_REPO)).toBe(ctx.repos.catalog);
    await ctx.close();
  });
});

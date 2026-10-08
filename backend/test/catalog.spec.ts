import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { mapAioRow, sortByHumanIdDesc } from '../src/catalog/map-row';
import { MemoryCatalogRepo } from '../src/storage/memory-repos';
import { CATALOG_REPO } from '../src/tokens';
import { createTestApp, TestApp } from './app';
import { aioRow } from './fakes';

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
});

describe('catalog repo token', () => {
  it('is the memory repo in tests', async () => {
    const ctx = await createTestApp();
    expect(ctx.app.get(CATALOG_REPO)).toBe(ctx.repos.catalog);
    await ctx.close();
  });
});

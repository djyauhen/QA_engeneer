import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { effectiveLanguages, mergeRules, defaultRules } from '../src/rules/rules';
import { ReportPayload } from '../src/reports/report.types';
import { SCHEMA_STATEMENTS } from '../src/storage/schema';
import { createTestApp, TestApp } from './app';

function payload(id: string, humanId: string, owner: string, createdAt: string): ReportPayload {
  return {
    report_id: id,
    human_id: humanId,
    name: 'Demo',
    owner_login: owner,
    created_at: createdAt,
    countries: ['CA'],
    languages: ['en'],
    steps: [],
    static: { summary: 'все passed', items: [] },
    ai: { status: 'Список готов', findings: [], decision: null },
    lighthouse: { status: 'выполнен', mobile: null, desktop: null },
    replaced_previous_stand: false,
  };
}

describe('rules, costs and reports', () => {
  let ctx: TestApp;
  let http: INestApplication;
  let tl: string;

  beforeEach(async () => {
    ctx = await createTestApp();
    http = ctx.app;
    const login = await request(http.getHttpServer()).post('/session').send({ login: 'env-tl', password: 'env-tl-pass' });
    tl = login.body.session_id;
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('rejects unknown rule keys and does not invent cost figures', async () => {
    const before = await request(http.getHttpServer()).get('/admin/rules').set('x-session-id', tl);
    expect(before.body.expectFormMacro).toBe(true);
    expect(before.body.allowed_external_prefixes).toHaveLength(9);
    expect(before.body.image_failed_kb).toBe(200);
    const rejected = await request(http.getHttpServer())
      .put('/admin/rules')
      .set('x-session-id', tl)
      .send({ brand_new_check: 1, image_warning_kb: 90 });
    expect(rejected.status).toBe(400);
    const after = await request(http.getHttpServer()).get('/admin/rules').set('x-session-id', tl);
    expect(after.body.image_warning_kb).toBe(100);
    expect(after.body.brand_new_check).toBeUndefined();
    const updated = await request(http.getHttpServer())
      .put('/admin/rules')
      .set('x-session-id', tl)
      .send({ image_warning_kb: 90, languages_override: ['fr'] });
    expect(updated.status).toBe(200);
    expect(updated.body.image_warning_kb).toBe(90);
    expect(updated.body.languages_override).toEqual(['fr']);
    expect(effectiveLanguages(['en'], updated.body)).toEqual(['fr']);
    expect(effectiveLanguages(['en'], defaultRules())).toEqual(['en']);
    expect(() => mergeRules(defaultRules(), { not_a_rule: 1 })).toThrow(/Неизвестный параметр/);
    const costs = await request(http.getHttpServer()).get('/admin/costs').set('x-session-id', tl);
    expect(costs.body).toEqual({ usage_reported: false });
    const sql = SCHEMA_STATEMENTS.join('\n');
    expect(sql).not.toMatch(/rules_history|password_reset|email/i);
    expect(sql).toMatch(/login TEXT PRIMARY KEY/);
    expect(sql).toMatch(/password_hash TEXT NOT NULL/);
  });

  it('returns only the caller reports for QA, every report for TL, and the previous one without a comparison verdict', async () => {
    await request(http.getHttpServer())
      .post('/admin/users')
      .set('x-session-id', tl)
      .send({ login: 'qa-a', password: 'qa-a-pass', role: 'QA' });
    await request(http.getHttpServer())
      .post('/admin/users')
      .set('x-session-id', tl)
      .send({ login: 'qa-b', password: 'qa-b-pass', role: 'QA' });
    const older = new Date();
    older.setDate(older.getDate() - 10);
    const newer = new Date();
    newer.setDate(newer.getDate() - 1);
    const expired = new Date();
    expired.setMonth(expired.getMonth() - 4);
    await ctx.repos.reports.insert({
      id: '11111111-1111-4111-8111-111111111111',
      human_id: '359226',
      owner_login: 'qa-a',
      created_at: older.toISOString(),
      payload: payload('11111111-1111-4111-8111-111111111111', '359226', 'qa-a', older.toISOString()),
    });
    await ctx.repos.reports.insert({
      id: '22222222-2222-4222-8222-222222222222',
      human_id: '359226',
      owner_login: 'qa-a',
      created_at: newer.toISOString(),
      payload: payload('22222222-2222-4222-8222-222222222222', '359226', 'qa-a', newer.toISOString()),
    });
    await ctx.repos.reports.insert({
      id: '33333333-3333-4333-8333-333333333333',
      human_id: '359226',
      owner_login: 'qa-b',
      created_at: newer.toISOString(),
      payload: payload('33333333-3333-4333-8333-333333333333', '359226', 'qa-b', newer.toISOString()),
    });
    await ctx.repos.reports.insert({
      id: '44444444-4444-4444-8444-444444444444',
      human_id: '359226',
      owner_login: 'qa-a',
      created_at: expired.toISOString(),
      payload: payload('44444444-4444-4444-8444-444444444444', '359226', 'qa-a', expired.toISOString()),
    });
    const qaA = await request(http.getHttpServer()).post('/session').send({ login: 'qa-a', password: 'qa-a-pass' });
    const qaB = await request(http.getHttpServer()).post('/session').send({ login: 'qa-b', password: 'qa-b-pass' });
    const own = await request(http.getHttpServer()).get('/reports').set('x-session-id', qaA.body.session_id);
    expect(own.body.reports.map((row: { report_id: string }) => row.report_id)).toEqual([
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
    ]);
    expect(own.body.reports[0].verdict).toBeUndefined();
    expect(own.body.reports[0].created_at).toEqual(expect.any(String));
    expect(own.body.reports[0].static_summary).toBe('все passed');
    expect(own.body.reports[0].ai_status).toBe('Список готов');
    expect(own.body.reports[0].lighthouse_status).toBe('выполнен');
    const foreign = await request(http.getHttpServer())
      .get('/reports/33333333-3333-4333-8333-333333333333')
      .set('x-session-id', qaA.body.session_id);
    expect(foreign.status).toBe(403);
    const previous = await request(http.getHttpServer())
      .get('/reports/22222222-2222-4222-8222-222222222222/previous')
      .set('x-session-id', qaA.body.session_id);
    expect(previous.body.report.report_id).toBe('11111111-1111-4111-8111-111111111111');
    expect(previous.body.comparison_verdict).toBeUndefined();
    expect(previous.body.report.verdict).toBeUndefined();
    const tlList = await request(http.getHttpServer()).get('/reports').set('x-session-id', tl);
    expect(tlList.body.reports).toHaveLength(3);
    const tlForeign = await request(http.getHttpServer())
      .get('/reports/33333333-3333-4333-8333-333333333333')
      .set('x-session-id', tl);
    expect(tlForeign.status).toBe(200);
    const empty = await request(http.getHttpServer())
      .get('/reports/11111111-1111-4111-8111-111111111111/previous')
      .set('x-session-id', qaA.body.session_id);
    expect(empty.body).toEqual({ report: null });
    expect(qaB.status).toBe(200);
  });
});

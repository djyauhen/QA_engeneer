import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { AppConfig } from '../src/config';
import { WorkdirService } from '../src/files/workdir.service';
import { StaticChecks } from '../src/static/static-checks';
import { StaticItem } from '../src/reports/report.types';
import { createTestApp, TestApp } from './app';
import { aioRow, structureFailZip, structurePassZip } from './fakes';

class PassedStatic extends StaticChecks {
  async run(): Promise<StaticItem[]> {
    return [{ name: 'Проверка структуры', status: 'passed', findings: [] }];
  }
}

async function waitFor(
  http: INestApplication,
  session: string,
  id: string,
  pred: (body: { steps: Array<{ name: string; state: string }>; replaced_previous_stand?: boolean }) => boolean,
) {
  for (let i = 0; i < 80; i += 1) {
    const res = await request(http.getHttpServer()).get(`/checks/${id}`).set('x-session-id', session);
    if (pred(res.body)) return res.body;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timeout ${id}`);
}

describe('checks, stand, AI and lighthouse', () => {
  let ctx: TestApp;
  let http: INestApplication;
  let session: string;

  beforeEach(async () => {
    ctx = await createTestApp();
    http = ctx.app;
    const login = await request(http.getHttpServer()).post('/session').send({ login: 'env-tl', password: 'env-tl-pass' });
    session = login.body.session_id;
    ctx.aio.rows = [aioRow({ human_id: '359226', uuid: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', name: 'Demo' })];
    await request(http.getHttpServer()).post('/catalog/refresh').set('x-session-id', session);
    ctx.aio.catalogCalls = 0;
    ctx.aio.downloadRequests = [];
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('stops AI until an explicit allow when a static item failed, and deny skips stand and lighthouse', async () => {
    ctx.aio.zip = structureFailZip();
    const started = await request(http.getHttpServer())
      .post('/checks')
      .set('x-session-id', session)
      .send({ human_id: '359226' });
    expect(started.status).toBe(201);
    const waiting = await waitFor(http, session, started.body.check_id, (body) =>
      body.steps.some((step) => step.name === 'ai_gate' && step.state === 'waiting_user'),
    );
    expect(waiting.static.items).toHaveLength(1);
    expect(waiting.static.items[0].status).toBe('failed');
    expect(waiting.ai.status).toBe('не запускался (ждут решения пользователя)');
    expect(ctx.ai.calls).toBe(0);
    expect(ctx.lighthouse.calls).toBe(0);
    expect(JSON.stringify(waiting)).not.toMatch(/"verdict"|"overall_status"/);

    const denied = await request(http.getHttpServer())
      .post(`/checks/${started.body.check_id}/ai-decision`)
      .set('x-session-id', session)
      .send({ decision: 'deny' });
    expect(denied.status).toBe(200);
    const done = await waitFor(http, session, started.body.check_id, (body) =>
      body.steps.some((step) => step.name === 'report' && step.state === 'done'),
    );
    expect(done.steps.find((step: { name: string }) => step.name === 'stand').state).toBe('skipped');
    expect(done.steps.find((step: { name: string }) => step.name === 'lighthouse').state).toBe('skipped');
    expect(ctx.ai.calls).toBe(0);
    expect(ctx.lighthouse.calls).toBe(0);
    const report = await request(http.getHttpServer())
      .get(`/reports/${started.body.check_id}`)
      .set('x-session-id', session);
    expect(report.status).toBe(200);
    expect(report.body.ai.decision).toBe('deny');
    expect(report.body.ai.status).toBe('не запускался (ждут решения пользователя)');
    expect(report.body.static.items).toHaveLength(1);
    expect(report.body.verdict).toBeUndefined();
    expect(report.body.overall_status).toBeUndefined();
    expect(report.body.stand_url).toBeUndefined();
    expect(report.body.preview_image).toBeUndefined();
  });

  it('calls AI without a question when nothing failed, drops incomplete findings, and keeps static if lighthouse fails', async () => {
    await ctx.close();
    ctx = await createTestApp({ staticChecks: new PassedStatic() });
    http = ctx.app;
    const login = await request(http.getHttpServer()).post('/session').send({ login: 'env-tl', password: 'env-tl-pass' });
    session = login.body.session_id;
    ctx.aio.rows = [aioRow({ human_id: '50', uuid: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', languages: ['en'] })];
    await request(http.getHttpServer()).post('/catalog/refresh').set('x-session-id', session);
    ctx.ai.findings = [
      { file: 'index.html', quote: 'Hello', screenshot: 'shot-1' },
      { file: 'index.html', quote: 'no shot' },
    ];
    ctx.ai.usage = { prompt_tokens: 11, completion_tokens: 4 };
    ctx.lighthouse.failTimes = 9;
    const started = await request(http.getHttpServer())
      .post('/checks')
      .set('x-session-id', session)
      .send({ human_id: '50' });
    const done = await waitFor(http, session, started.body.check_id, (body) =>
      body.steps.some((step) => step.name === 'report' && step.state === 'done'),
    );
    expect(ctx.ai.calls).toBe(1);
    expect(done.lighthouse.status).toBe('ошибка после повторов');
    expect(ctx.lighthouse.calls).toBe(3);
    expect(done.static.summary).toBe('все passed');
    expect(done.lighthouse.verdict).toBeUndefined();
    const report = await request(http.getHttpServer())
      .get(`/reports/${started.body.check_id}`)
      .set('x-session-id', session);
    expect(report.body.ai.findings).toEqual([{ file: 'index.html', quote: 'Hello', screenshot: 'shot-1' }]);
    expect(report.body.ai.status).toBe('Список готов');
    expect(report.body.stand_url).toBeUndefined();
    expect(JSON.stringify(report.body)).not.toMatch(/verdict|overall_status|preview_image/);
    expect(JSON.stringify(report.body)).not.toContain('sign' + 'ature=');
    const costsQa = await request(http.getHttpServer())
      .post('/admin/users')
      .set('x-session-id', session)
      .send({ login: 'qa-cost', password: 'qa-cost-pass', role: 'QA' });
    expect(costsQa.status).toBe(201);
    const qa = await request(http.getHttpServer())
      .post('/session')
      .send({ login: 'qa-cost', password: 'qa-cost-pass' });
    const qaCosts = await request(http.getHttpServer()).get('/admin/costs').set('x-session-id', qa.body.session_id);
    expect(qaCosts.status).toBe(403);
    expect(qaCosts.body.usage_reported).toBeUndefined();
    const tlCosts = await request(http.getHttpServer()).get('/admin/costs').set('x-session-id', session);
    expect(tlCosts.body).toEqual({
      usage_reported: true,
      provider_usage: [{ prompt_tokens: 11, completion_tokens: 4 }],
    });
  });

  it('keeps static when AI fails three times and still runs lighthouse', async () => {
    await ctx.close();
    ctx = await createTestApp({ staticChecks: new PassedStatic() });
    http = ctx.app;
    const login = await request(http.getHttpServer()).post('/session').send({ login: 'env-tl', password: 'env-tl-pass' });
    session = login.body.session_id;
    ctx.aio.rows = [aioRow({ human_id: '7', uuid: 'ffffffff-ffff-4fff-8fff-ffffffffffff' })];
    await request(http.getHttpServer()).post('/catalog/refresh').set('x-session-id', session);
    ctx.ai.failTimes = 3;
    const started = await request(http.getHttpServer())
      .post('/checks')
      .set('x-session-id', session)
      .send({ human_id: '7' });
    const done = await waitFor(http, session, started.body.check_id, (body) =>
      body.steps.some((step) => step.name === 'report' && step.state === 'done'),
    );
    expect(ctx.ai.calls).toBe(3);
    expect(done.ai.status).toBe('ошибка после повторов');
    expect(done.static.summary).toBe('все passed');
    expect(done.lighthouse.status).toBe('выполнен');
    expect(done.lighthouse.mobile.performance_score).toEqual(expect.any(Number));
    expect(done.lighthouse.desktop.performance_score).toEqual(expect.any(Number));
    expect(ctx.lighthouse.calls).toBe(2);
  });

  it('serves the stand with isolation until the owner allows actions', async () => {
    ctx.aio.zip = structurePassZip();
    const started = await request(http.getHttpServer())
      .post('/checks')
      .set('x-session-id', session)
      .send({ human_id: '359226', uuid: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1' });
    const id = started.body.check_id;
    await waitFor(http, session, id, (body) => body.steps.some((step) => step.name === 'ai_gate' && step.state === 'waiting_user'));
    await request(http.getHttpServer())
      .post(`/checks/${id}/ai-decision`)
      .set('x-session-id', session)
      .send({ decision: 'allow' });
    const live = await waitFor(http, session, id, (body) =>
      body.steps.some((step) => step.name === 'stand' && step.state === 'done'),
    );
    expect(String(live.stand_url)).toContain(`/preview/${id}/`);
    const isolated = await request(http.getHttpServer()).get(`/preview/${id}/index.html`);
    expect(isolated.status).toBe(200);
    expect(isolated.headers['content-security-policy']).toContain("form-action 'none'");
    expect(isolated.text).toContain('FORM');
    expect(isolated.text).toContain('Acme');
    expect(isolated.text).toContain('{{link}}');
    expect(isolated.text).not.toContain('evil.test/pixel.js');
    await request(http.getHttpServer())
      .post(`/checks/${id}/stand-actions`)
      .set('x-session-id', session)
      .send({ decision: 'allow' });
    const open = await request(http.getHttpServer()).get(`/preview/${id}/index.html`);
    expect(open.headers['content-security-policy']).toBeUndefined();
    expect(open.text).toContain('evil.test/pixel.js');
  });

  it('replaces only the same user unpacked directory', async () => {
    ctx.aio.zip = structureFailZip();
    const first = await request(http.getHttpServer())
      .post('/checks')
      .set('x-session-id', session)
      .send({ human_id: '359226' });
    await waitFor(http, session, first.body.check_id, (body) =>
      body.steps.some((step) => step.name === 'ai_gate' && step.state === 'waiting_user'),
    );
    const created = await request(http.getHttpServer())
      .post('/admin/users')
      .set('x-session-id', session)
      .send({ login: 'qa-b', password: 'qa-b-pass', role: 'QA' });
    expect(created.status).toBe(201);
    const qa = await request(http.getHttpServer()).post('/session').send({ login: 'qa-b', password: 'qa-b-pass' });
    ctx.aio.rows = [aioRow({ human_id: '359226', uuid: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1' })];
    await request(http.getHttpServer()).post('/catalog/refresh').set('x-session-id', qa.body.session_id);
    const other = await request(http.getHttpServer())
      .post('/checks')
      .set('x-session-id', qa.body.session_id)
      .send({ human_id: '359226' });
    await waitFor(http, qa.body.session_id, other.body.check_id, (body) =>
      body.steps.some((step) => step.name === 'unpack' && step.state === 'done'),
    );
    const second = await request(http.getHttpServer())
      .post('/checks')
      .set('x-session-id', session)
      .send({ human_id: '359226' });
    const replaced = await waitFor(http, session, second.body.check_id, (body) => body.replaced_previous_stand === true);
    expect(replaced.replaced_previous_stand).toBe(true);
    const otherView = await request(http.getHttpServer())
      .get(`/checks/${other.body.check_id}`)
      .set('x-session-id', qa.body.session_id);
    expect(otherView.body.replaced_previous_stand).toBe(false);
  });
});

describe('workdir isolation', () => {
  it('deletes the previous directory of one user and leaves the other', () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-work-'));
    const config = { workDir } as AppConfig;
    const work = new WorkdirService(config);
    const first = work.prepare('alice');
    fs.writeFileSync(path.join(first.dir, 'old.txt'), 'x');
    const bob = work.prepare('bob');
    fs.writeFileSync(path.join(bob.dir, 'keep.txt'), 'y');
    const second = work.prepare('alice');
    expect(second.replaced).toBe(true);
    expect(fs.existsSync(path.join(first.dir, 'old.txt'))).toBe(false);
    expect(fs.existsSync(path.join(bob.dir, 'keep.txt'))).toBe(true);
    fs.rmSync(workDir, { recursive: true, force: true });
  });
});

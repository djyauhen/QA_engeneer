import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { AppConfig } from '../src/config';
import { CheckStore } from '../src/checks/check.store';
import { WorkdirService } from '../src/files/workdir.service';
import { AioDownloadError } from '../src/aio/aio.client';
import { AdminRules } from '../src/rules/rules';
import { MERGED_SPLIT_UNAVAILABLE, STATIC_CHECK_NAMES, StaticChecks, runStaticChecks } from '../src/static/static-checks';
import { StaticItem } from '../src/reports/report.types';
import { createTestApp, TestApp } from './app';
import { FakeAio, aioRow, assetsExtraZip, phpFailZip, structurePassZip, zipFiles } from './fakes';

class PassedStatic extends StaticChecks {
  async run(): Promise<StaticItem[]> {
    return [{ name: 'Проверка структуры', status: 'passed', findings: [] }];
  }
}

class FailedStatic extends StaticChecks {
  async run(): Promise<StaticItem[]> {
    return [{ name: STATIC_CHECK_NAMES.php, status: 'failed', findings: [{ text: 'index.html: обнаружены вставки PHP' }] }];
  }
}

class StructureOnlyStatic extends StaticChecks {
  async run(): Promise<StaticItem[]> {
    return Object.values(STATIC_CHECK_NAMES)
      .filter((name) => name !== STATIC_CHECK_NAMES.split)
      .map((name) =>
        name === STATIC_CHECK_NAMES.structure
          ? { name, status: 'failed' as const, findings: [{ text: 'Фавикон отсутствует в корне или в папках img/images.' }] }
          : { name, status: 'passed' as const, findings: [] },
      );
  }
}

class UnresolvedFolderStatic extends StaticChecks {
  async run(_projectPath: string, rules: AdminRules): Promise<StaticItem[]> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-unresolved-'));
    fs.mkdirSync(path.join(root, 'one'));
    fs.mkdirSync(path.join(root, 'two'));
    try {
      return await runStaticChecks(root, rules);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
}

class EchoPlusPhpStatic extends StaticChecks {
  async run(): Promise<StaticItem[]> {
    const echo = 'Ожидается одна папка с лендингом в «x», найдено подпапок: 2';
    return [
      { name: STATIC_CHECK_NAMES.structure, status: 'failed', findings: [{ text: echo }] },
      {
        name: STATIC_CHECK_NAMES.php,
        status: 'failed',
        findings: [{ text: echo }, { text: 'index.html: обнаружены вставки PHP' }],
      },
    ];
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
    ctx.aio.zip = phpFailZip();
    const started = await request(http.getHttpServer())
      .post('/checks')
      .set('x-session-id', session)
      .send({ human_id: '359226' });
    expect(started.status).toBe(201);
    const waiting = await waitFor(http, session, started.body.check_id, (body) =>
      body.steps.some((step) => step.name === 'ai_gate' && step.state === 'waiting_user'),
    );
    const structure = waiting.static.items.find((item: { name: string }) => item.name === STATIC_CHECK_NAMES.structure);
    const php = waiting.static.items.find((item: { name: string }) => item.name === STATIC_CHECK_NAMES.php);
    const split = waiting.static.items.find((item: { name: string }) => item.name === STATIC_CHECK_NAMES.split);
    expect(structure.status).toBe('passed');
    expect(php.status).toBe('failed');
    expect(php.findings.some((finding: { text: string }) => finding.text.includes('PHP'))).toBe(true);
    expect(split.status).toBe('passed');
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
    expect(report.body.static.items.find((item: { name: string }) => item.name === STATIC_CHECK_NAMES.php).status).toBe('failed');
    expect(report.body.verdict).toBeUndefined();
    expect(report.body.overall_status).toBeUndefined();
    expect(report.body.stand_url).toBeUndefined();
    expect(report.body.preview_image).toBeUndefined();
    expect(report.body.ai_requests).toBeUndefined();
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
    ctx.ai.aiRequests = {
      shots: { desktop: 'data:image/jpeg;base64,YQ==' },
      calls: [
        {
          kind: 'category',
          category: 1,
          model: 'deepseek-v4-pro',
          system: 'Пункт 1. GEO и локализация.',
          pixels: false,
          attachments: [],
        },
      ],
    };
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
    expect(report.body.ai_requests).toEqual(ctx.ai.aiRequests);
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
    ctx.aio.zip = zipFiles({
      'landing/index.html': `<html><head></head><body>
{{form}}
{{aio.visit.fields.offer_name.for_visitors}}
<img src="{{cdn}}/images/dot.png">
<img src="https://www.index.hr/images/dot.png" alt="index.hr">
<img src="//www.index.hr/images/dot.png" alt="index.hr">
<link rel="stylesheet" href="./css/style.css">
<a href="https://www.index.hr/vijesti">Vijesti</a>
<script src="https://evil.test/pixel.js"></script>
<script src="js/local.js"></script>
{{link}}
</body></html>`,
      'landing/favicon.ico': 'ico',
      'landing/images/dot.png': Buffer.from([137, 80, 78, 71]),
      'landing/js/local.js': 'var local = 1;',
      'landing/css/style.css':
        '.a{background:url(../images/dot.png)}.b{background:url(//www.index.hr/images/dot.png)}@font-face{src:url(https://fonts.gstatic.com/s/notocoloremoji/v40/Yq6P.ttf)}',
    });
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
    expect(live.actions_allowed).toBe(false);
    expect(String(live.stand_url)).toContain('t=');
    const previewPath = previewPathOf(String(live.stand_url));
    const hidden = await request(http.getHttpServer()).get(`/preview/${id}/index.html`);
    expect(hidden.status).toBe(404);
    const isolated = await request(http.getHttpServer()).get(previewPath);
    expect(isolated.status).toBe(200);
    expect(isolated.headers['content-security-policy']).toContain("form-action 'none'");
    expect(isolated.headers['content-security-policy']).toContain("base-uri 'self' http://127.0.0.1:3000");
    expect(isolated.headers['content-security-policy']).toContain("style-src 'self' 'unsafe-inline' http://127.0.0.1:3000");
    expect(isolated.headers['content-security-policy']).not.toContain('script-src \'self\' \'unsafe-inline\' http');
    expect(isolated.text).toContain('FORM');
    expect(isolated.text).toContain('Acme');
    expect(isolated.text).toContain('{{link}}');
    expect(isolated.text).not.toContain('evil.test/pixel.js');
    const token = new URL(String(live.stand_url)).searchParams.get('t');
    expect(token).toBeTruthy();
    expect(isolated.text).toContain(`/preview/${id}/images/dot.png?t=${token}`);
    expect(isolated.text).toContain(`/preview/${id}/css/style.css?t=${token}`);
    expect(isolated.text).not.toContain('www.index.hr/images/dot.png');
    expect(isolated.text).toContain('https://www.index.hr/vijesti');
    expect(isolated.text).toContain(`/preview/${id}/js/local.js?t=${token}`);
    const css = await request(http.getHttpServer()).get(`/preview/${id}/css/style.css?t=${token}`);
    expect(css.status).toBe(200);
    expect(css.text).toContain(`/preview/${id}/images/dot.png?t=${token}`);
    expect(css.text).not.toContain('www.index.hr');
    expect(css.text).toContain('https://fonts.gstatic.com/s/notocoloremoji/v40/Yq6P.ttf');
    expect(isolated.text).toContain(`<base href="http://127.0.0.1:3000/preview/${id}/">`);
    expect(String(isolated.headers['set-cookie'])).toContain(`qa_preview=${token}`);
    const blocked = await request(http.getHttpServer()).get(`/preview/${id}/images/dot.png`);
    expect(blocked.status).toBe(404);
    const wrongCookie = await request(http.getHttpServer())
      .get(`/preview/${id}/images/dot.png`)
      .set('Cookie', 'qa_preview=not-the-token');
    expect(wrongCookie.status).toBe(404);
    const viaCookie = await request(http.getHttpServer())
      .get(`/preview/${id}/images/dot.png`)
      .set('Cookie', `qa_preview=${token}`);
    expect(viaCookie.status).toBe(200);
    expect(viaCookie.headers['content-type']).toContain('image/png');
    const viaQuery = await request(http.getHttpServer()).get(`/preview/${id}/images/dot.png?t=${token}`);
    expect(viaQuery.status).toBe(200);
    await request(http.getHttpServer())
      .post(`/checks/${id}/stand-actions`)
      .set('x-session-id', session)
      .send({ decision: 'allow' });
    const allowedView = await request(http.getHttpServer()).get(`/checks/${id}`).set('x-session-id', session);
    expect(allowedView.body.actions_allowed).toBe(true);
    const open = await request(http.getHttpServer()).get(previewPath);
    expect(open.headers['content-security-policy']).toContain('frame-ancestors');
    expect(open.headers['x-content-type-options']).toBe('nosniff');
    expect(open.text).toContain('evil.test/pixel.js');
    expect(open.text).toContain(`/preview/${id}/images/dot.png?t=${token}`);
  });

  it('resumes a waiting check on another instance after the runner is gone', async () => {
    await ctx.close();
    const staticChecks = new FailedStatic();
    ctx = await createTestApp({ staticChecks });
    http = ctx.app;
    const login = await request(http.getHttpServer()).post('/session').send({ login: 'env-tl', password: 'env-tl-pass' });
    session = login.body.session_id;
    ctx.aio.rows = [aioRow({ human_id: '359226', uuid: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', name: 'Demo' })];
    await request(http.getHttpServer()).post('/catalog/refresh').set('x-session-id', session);
    ctx.aio.zip = structurePassZip();
    const started = await request(http.getHttpServer())
      .post('/checks')
      .set('x-session-id', session)
      .send({ human_id: '359226' });
    const id = started.body.check_id as string;
    await waitFor(http, session, id, (body) =>
      body.steps.some((step) => step.name === 'ai_gate' && step.state === 'waiting_user'),
    );
    const second = await createTestApp({
      repos: ctx.repos,
      aio: ctx.aio,
      ai: ctx.ai,
      lighthouse: ctx.lighthouse,
      staticChecks,
    });
    await ctx.app.get(CheckStore).forgetLocal(id);
    const decision = await request(second.app.getHttpServer())
      .post(`/checks/${id}/ai-decision`)
      .set('x-session-id', session)
      .send({ decision: 'allow' });
    expect(decision.status).toBe(200);
    const done = await waitFor(second.app, session, id, (body) =>
      body.steps.some((step) => step.name === 'report' && step.state === 'done'),
    );
    expect(done.steps.find((step: { name: string }) => step.name === 'stand').state).toBe('done');
    const preview = new URL(String(done.stand_url));
    const page = await request(second.app.getHttpServer()).get(`${preview.pathname}${preview.search}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('FORM');
    await second.close();
  });

  it('replaces only the same user unpacked directory', async () => {
    ctx.aio.zip = phpFailZip();
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

  it.each([
    ['missing', (aio: FakeAio) => {
      aio.mergedZip = null;
    }],
    ['failed', (aio: FakeAio) => {
      aio.mergedReadError = new AioDownloadError('rejected');
    }],
  ])('fails the split check when merged is %s and still runs the original pipeline', async (_label, arrange) => {
    await ctx.close();
    ctx = await createTestApp({ staticChecks: new PassedStatic() });
    http = ctx.app;
    const login = await request(http.getHttpServer()).post('/session').send({ login: 'env-tl', password: 'env-tl-pass' });
    session = login.body.session_id;
    ctx.aio.rows = [aioRow({ human_id: '61', uuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' })];
    await request(http.getHttpServer()).post('/catalog/refresh').set('x-session-id', session);
    arrange(ctx.aio);
    const started = await request(http.getHttpServer())
      .post('/checks')
      .set('x-session-id', session)
      .send({ human_id: '61' });
    const done = await waitFor(http, session, started.body.check_id, (body) =>
      body.steps.some((step) => step.name === 'report' && step.state === 'done'),
    );
    expect(done.steps.find((step: { name: string }) => step.name === 'download_file').state).toBe('done');
    expect(done.steps.find((step: { name: string }) => step.name === 'static').state).toBe('done');
    expect(done.steps.find((step: { name: string }) => step.name === 'stand').state).toBe('done');
    expect(done.steps.find((step: { name: string }) => step.name === 'ai').state).toBe('done');
    expect(done.steps.find((step: { name: string }) => step.name === 'ai_gate').state).toBe('done');
    const split = done.static.items.find((item: { name: string }) => item.name === STATIC_CHECK_NAMES.split);
    expect(split.status).toBe('failed');
    expect(split.findings).toEqual([{ text: MERGED_SPLIT_UNAVAILABLE }]);
    expect(done.static.summary).toBe('есть failed');
    expect(done.static.items[0].status).toBe('passed');
    expect(ctx.ai.calls).toBe(1);
  });

  it('holds AI when a required split macro is missing', async () => {
    await ctx.close();
    ctx = await createTestApp({ staticChecks: new PassedStatic() });
    http = ctx.app;
    const login = await request(http.getHttpServer()).post('/session').send({ login: 'env-tl', password: 'env-tl-pass' });
    session = login.body.session_id;
    ctx.aio.rows = [aioRow({ human_id: '62', uuid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1' })];
    await request(http.getHttpServer()).post('/catalog/refresh').set('x-session-id', session);
    ctx.aio.mergedZip = zipFiles({ 'landing/index.html': '<html>{{split.subtitle}}</html>' });
    const started = await request(http.getHttpServer())
      .post('/checks')
      .set('x-session-id', session)
      .send({ human_id: '62' });
    const waiting = await waitFor(http, session, started.body.check_id, (body) =>
      body.steps.some((step) => step.name === 'ai_gate' && step.state === 'waiting_user'),
    );
    const split = waiting.static.items.find((item: { name: string }) => item.name === STATIC_CHECK_NAMES.split);
    const text = split.findings.map((finding: { text: string }) => finding.text).join('\n');
    expect(split.status).toBe('failed');
    expect(text).toContain('{{split.title}}');
    expect(text).toContain('{{split.bannerUrl}}');
    expect(text).not.toContain('subtitle');
    expect(ctx.ai.calls).toBe(0);
    expect(waiting.steps.find((step: { name: string }) => step.name === 'download_file').state).toBe('done');
  });

  it('continues stand, AI and lighthouse when only the structure item failed', async () => {
    await ctx.close();
    ctx = await createTestApp({ staticChecks: new StructureOnlyStatic() });
    http = ctx.app;
    const login = await request(http.getHttpServer()).post('/session').send({ login: 'env-tl', password: 'env-tl-pass' });
    session = login.body.session_id;
    ctx.aio.rows = [aioRow({ human_id: '63', uuid: '11111111-1111-4111-8111-111111111163' })];
    await request(http.getHttpServer()).post('/catalog/refresh').set('x-session-id', session);
    ctx.aio.zip = structurePassZip();
    const started = await request(http.getHttpServer())
      .post('/checks')
      .set('x-session-id', session)
      .send({ human_id: '63' });
    const done = await waitFor(http, session, started.body.check_id, (body) =>
      body.steps.some((step) => step.name === 'report' && step.state === 'done'),
    );
    expect(done.steps.find((step: { name: string }) => step.name === 'ai_gate').state).toBe('done');
    expect(done.steps.find((step: { name: string }) => step.name === 'stand').state).toBe('done');
    expect(done.steps.find((step: { name: string }) => step.name === 'ai').state).toBe('done');
    expect(done.steps.find((step: { name: string }) => step.name === 'lighthouse').state).toBe('done');
    const structure = done.static.items.find((item: { name: string }) => item.name === STATIC_CHECK_NAMES.structure);
    expect(structure.status).toBe('failed');
    const rest = done.static.items.filter((item: { name: string }) => item.name !== STATIC_CHECK_NAMES.structure);
    expect(rest.length).toBeGreaterThan(0);
    expect(rest.every((item: { status: string }) => item.status === 'passed')).toBe(true);
    expect(done.static.summary).toBe('есть failed');
    expect(ctx.ai.calls).toBe(1);
    expect(ctx.lighthouse.calls).toBe(2);
  });

  it('continues the pipeline when later static items only repeat the landing-folder error', async () => {
    await ctx.close();
    ctx = await createTestApp({ staticChecks: new UnresolvedFolderStatic() });
    http = ctx.app;
    const login = await request(http.getHttpServer()).post('/session').send({ login: 'env-tl', password: 'env-tl-pass' });
    session = login.body.session_id;
    ctx.aio.rows = [aioRow({ human_id: '64', uuid: '11111111-1111-4111-8111-111111111164' })];
    await request(http.getHttpServer()).post('/catalog/refresh').set('x-session-id', session);
    ctx.aio.zip = structurePassZip();
    const started = await request(http.getHttpServer())
      .post('/checks')
      .set('x-session-id', session)
      .send({ human_id: '64' });
    const done = await waitFor(http, session, started.body.check_id, (body) =>
      body.steps.some((step) => step.name === 'report' && step.state === 'done'),
    );
    expect(done.steps.find((step: { name: string }) => step.name === 'ai_gate').state).toBe('done');
    expect(done.steps.find((step: { name: string }) => step.name === 'stand').state).toBe('done');
    expect(done.steps.find((step: { name: string }) => step.name === 'ai').state).toBe('done');
    expect(done.steps.find((step: { name: string }) => step.name === 'lighthouse').state).toBe('done');
    const structure = done.static.items.find((item: { name: string }) => item.name === STATIC_CHECK_NAMES.structure);
    const php = done.static.items.find((item: { name: string }) => item.name === STATIC_CHECK_NAMES.php);
    expect(structure.status).toBe('failed');
    expect(php.status).toBe('failed');
    expect(php.findings.every((finding: { text: string }) => finding.text.startsWith('Ожидается одна папка с лендингом'))).toBe(true);
    expect(ctx.ai.calls).toBe(1);
    expect(ctx.lighthouse.calls).toBe(2);
  });

  it('still opens the AI gate when a later item has a real finding next to a resolve error', async () => {
    await ctx.close();
    ctx = await createTestApp({ staticChecks: new EchoPlusPhpStatic() });
    http = ctx.app;
    const login = await request(http.getHttpServer()).post('/session').send({ login: 'env-tl', password: 'env-tl-pass' });
    session = login.body.session_id;
    ctx.aio.rows = [aioRow({ human_id: '65', uuid: '11111111-1111-4111-8111-111111111165' })];
    await request(http.getHttpServer()).post('/catalog/refresh').set('x-session-id', session);
    const started = await request(http.getHttpServer())
      .post('/checks')
      .set('x-session-id', session)
      .send({ human_id: '65' });
    const waiting = await waitFor(http, session, started.body.check_id, (body) =>
      body.steps.some((step) => step.name === 'ai_gate' && step.state === 'waiting_user'),
    );
    const structure = waiting.static.items.find((item: { name: string }) => item.name === STATIC_CHECK_NAMES.structure);
    const php = waiting.static.items.find((item: { name: string }) => item.name === STATIC_CHECK_NAMES.php);
    expect(structure.status).toBe('failed');
    expect(php.status).toBe('failed');
    expect(php.findings).toHaveLength(2);
    expect(ctx.ai.calls).toBe(0);
    expect(ctx.lighthouse.calls).toBe(0);
    expect(waiting.steps.find((step: { name: string }) => step.name === 'stand').state).not.toBe('done');
  });

  it('runs the real static checker when structure fails on an extra assets folder', async () => {
    ctx.aio.zip = assetsExtraZip();
    const started = await request(http.getHttpServer())
      .post('/checks')
      .set('x-session-id', session)
      .send({ human_id: '359226' });
    expect(started.status).toBe(201);
    const view = await waitFor(http, session, started.body.check_id, (body) =>
      body.steps.some((step) => step.name === 'ai_gate' && (step.state === 'done' || step.state === 'waiting_user')),
    );
    const items = view.static.items as Array<{ name: string; status: string; findings: Array<{ text: string }> }>;
    expect(items.map((item) => item.name)).toEqual(Object.values(STATIC_CHECK_NAMES));
    const structure = items.find((item) => item.name === STATIC_CHECK_NAMES.structure);
    expect(structure?.status).toBe('failed');
    expect(structure?.findings.some((finding) => finding.text.includes('assets'))).toBe(true);
    const independent = items.filter((item) => {
      if (item.status !== 'failed' || item.name === STATIC_CHECK_NAMES.structure) return false;
      return item.findings.some((finding) => !finding.text.includes('assets') || !finding.text.includes('лишние файлы или папки'));
    });
    expect(independent.map((item) => item.name)).toEqual([STATIC_CHECK_NAMES.svg]);
    expect(view.steps.find((step: { name: string }) => step.name === 'stand').state).not.toBe('skipped');
    expect(view.steps.find((step: { name: string }) => step.name === 'lighthouse').state).not.toBe('skipped');
    expect(view.steps.find((step: { name: string }) => step.name === 'ai_gate').state).toBe('waiting_user');
    expect(ctx.ai.calls).toBe(0);
  });
});

function previewPathOf(standUrl: string): string {
  const url = new URL(standUrl);
  return `${url.pathname}${url.search}`;
}

describe('workdir isolation', () => {
  it('keeps each check directory and removes only the requested one', () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-work-'));
    const config = { workDir } as AppConfig;
    const work = new WorkdirService(config);
    const first = work.directory('check-a');
    fs.writeFileSync(path.join(first, 'old.txt'), 'x');
    const second = work.directory('check-b');
    fs.writeFileSync(path.join(second, 'keep.txt'), 'y');
    work.remove('check-a');
    expect(fs.existsSync(path.join(first, 'old.txt'))).toBe(false);
    expect(fs.existsSync(path.join(second, 'keep.txt'))).toBe(true);
    fs.rmSync(workDir, { recursive: true, force: true });
  });
});

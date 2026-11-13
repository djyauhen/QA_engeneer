import { createHash } from 'crypto';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { pageTextForAi } from '../src/ai/materials';
import { QA_INSTRUCTION } from '../src/ai/qa-instruction';
import { standFormHtml } from '../src/stand/form-html';
import { StaticChecks } from '../src/static/static-checks';
import { StaticItem } from '../src/reports/report.types';
import { createTestApp, TestApp } from './app';
import { aioRow, zipFiles } from './fakes';

class PassedStatic extends StaticChecks {
  async run(): Promise<StaticItem[]> {
    return [{ name: 'Проверка структуры', status: 'passed', findings: [] }];
  }
}

function jpeg(size: number): Buffer {
  const buf = Buffer.alloc(size, 7);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  return buf;
}

async function reportOf(http: INestApplication, session: string, id: string) {
  for (let i = 0; i < 120; i += 1) {
    const res = await request(http.getHttpServer()).get(`/checks/${id}`).set('x-session-id', session);
    if (res.body.steps?.some((step: { name: string; state: string }) => step.name === 'report' && step.state === 'done')) {
      return request(http.getHttpServer()).get(`/reports/${id}`).set('x-session-id', session);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('timeout');
}

describe('orchestrator sends landing materials to the AI', () => {
  let ctx: TestApp;
  let http: INestApplication;
  let session: string;

  beforeEach(async () => {
    ctx = await createTestApp({ staticChecks: new PassedStatic() });
    http = ctx.app;
    const login = await request(http.getHttpServer()).post('/session').send({ login: 'env-tl', password: 'env-tl-pass' });
    session = login.body.session_id;
    ctx.aio.zip = zipFiles({
      'land/index.html': '<html><body><h1>Andrzej Duda</h1><p>Mifix 250 PLN {{aio.visit.fields.offer_name.for_visitors}}</p>{{form}}<img src="images/hero.jpg" alt="x"><script>var a=1;</script></body></html>',
      'land/images/hero.jpg': jpeg(4000),
      'land/js/app.js': 'var JS_BODY = 1;',
    });
    ctx.aio.rows = [aioRow({ human_id: '77', uuid: 'ffffffff-ffff-4fff-8fff-fffffffffff1', name: 'PL_Andrzej_Duda_Mifix' })];
    await request(http.getHttpServer()).post('/catalog/refresh').set('x-session-id', session);
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('passes page text, person and images, and stores the schema v2 report fields from the client', async () => {
    ctx.ai.report = {
      report_markdown: 'ОБЩАЯ ИНФОРМАЦИЯ',
      general: { geo: 'Польша' },
      checks: [{ category: 1, status: 'PASS' }],
      clarifications: ['уточнить'],
    };
    const started = await request(http.getHttpServer()).post('/checks').set('x-session-id', session).send({ human_id: '77' });
    const report = await reportOf(http, session, started.body.check_id);
    const input = ctx.ai.lastInput;
    expect(input?.files).toEqual([]);
    expect(input?.pageText).toContain('Mifix 250 PLN');
    expect(input?.pageText).toContain('Acme');
    expect(input?.pageText).toContain('FORM');
    expect(input?.pageText).not.toContain('offer_name');
    expect(input?.pageText).not.toContain('{{form}}');
    expect(input?.pageText).not.toContain('var a=1');
    expect(input?.pageText).not.toContain('JS_BODY');
    expect(input?.pageTextRendered).toBe(false);
    expect(input?.person?.resolved).toBe('Andrzej Duda');
    expect(input?.images?.map((image) => [image.ref, image.file, image.claims_person])).toEqual([
      ['I1', 'images/hero.jpg', 'Andrzej Duda'],
    ]);
    expect(input?.checkDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(input?.landingPreviewUrl ?? null).toBeNull();
    expect(input?.previewShots).toEqual([]);
    expect(ctx.aio.previewCalls).toEqual([]);
    const ai = report.body.ai;
    expect(ai.schema_version).toBe(2);
    expect(ai.report_markdown).toBe('ОБЩАЯ ИНФОРМАЦИЯ');
    expect(ai.general).toEqual({ geo: 'Польша' });
    expect(ai.checks).toEqual([{ category: 1, status: 'PASS' }]);
    expect(ai.clarifications).toEqual(['уточнить']);
    expect(ai.meta).toEqual({
      instruction_sha: createHash('sha256').update(QA_INSTRUCTION).digest('hex'),
      images_sent: 1,
      text_truncated: false,
      vision: true,
      outlet_url: null,
      fact_source: null,
      fx_date: null,
      person_from_name: 'Andrzej Duda',
      person_from_text: 'Andrzej Duda',
      person_conflict: false,
    });
    expect(JSON.stringify(report.body)).not.toMatch(/verdict|overall_status/);
  });

  it('leaves the new fields undefined when the client returns no report', async () => {
    const started = await request(http.getHttpServer()).post('/checks').set('x-session-id', session).send({ human_id: '77' });
    const report = await reportOf(http, session, started.body.check_id);
    expect(report.body.ai.schema_version).toBeUndefined();
    expect(report.body.ai.report_markdown).toBeUndefined();
    expect(report.body.ai.meta).toBeUndefined();
    expect(report.body.ai.findings).toEqual([]);
  });

  it('sends transformed stand text so the raw offer macro is not the page text', async () => {
    ctx.aio.zip = zipFiles({
      'land/index.html':
        '<html><body><h1>Ben Woldring</h1><p>Deposit {{aio.visit.fields.offer_name.for_visitors}}</p>{{form}}<img src="images/hero.jpg" alt="Ben Woldring"></body></html>',
      'land/images/hero.jpg': jpeg(4000),
    });
    ctx.aio.rows = [
      aioRow({
        human_id: '78',
        uuid: 'ffffffff-ffff-4fff-8fff-fffffffffff2',
        name: 'NL_Ben_Woldring',
        countries: ['NL'],
      }),
    ];
    await request(http.getHttpServer()).post('/catalog/refresh').set('x-session-id', session);
    const started = await request(http.getHttpServer()).post('/checks').set('x-session-id', session).send({ human_id: '78' });
    await reportOf(http, session, started.body.check_id);
    const input = ctx.ai.lastInput;
    expect(input?.pageText).toContain('Deposit Acme');
    expect(input?.pageText).toContain('FORM');
    expect(input?.pageText).toContain('Ben Woldring');
    expect(input?.pageText).not.toContain('{{aio.visit.fields.offer_name.for_visitors}}');
    expect(input?.pageText).not.toContain('{{form}}');
    expect(input?.pageTextRendered).toBe(false);
    expect(input?.person?.resolved).toBe('Ben Woldring');
    expect(input?.images?.map((image) => image.ref)).toEqual(['I1']);
    expect(input?.images?.[0].claims_person).toBe('Ben Woldring');
  });
});

describe('page text sent to the model', () => {
  const raw =
    '<html><body><h1>Ben Woldring</h1><p>Minimum deposit 220 EUR at {{aio.visit.fields.offer_name.for_visitors}}.</p>{{form}}</body></html>';
  const options = {
    formHtml: standFormHtml(['NL']),
    brandName: 'Brand',
    cdnBase: '/preview/1',
    isolated: true,
  };

  it('uses rendered visible text and drops the raw offer macro', () => {
    const rendered = 'Ben Woldring Minimum deposit 220 EUR at Brand. Tel +31';
    const text = pageTextForAi(raw, options, rendered);
    expect(text.source).toBe('rendered');
    expect(text.pageText).toBe(rendered);
    expect(text.pageText).not.toContain('{{aio.visit.fields.offer_name.for_visitors}}');
    expect(text.pageText).not.toContain('{{form}}');
  });

  it('falls back to transformed text with the offer, the phone field and the dial code', () => {
    const text = pageTextForAi(raw, options, '   ');
    expect(text.source).toBe('transformed');
    expect(text.pageText).toContain('Brand');
    expect(text.pageText).toContain('Minimum deposit 220 EUR');
    expect(text.pageText).toContain('Tel');
    expect(text.pageText).toContain('+31');
    expect(text.pageText).not.toContain('{{aio.visit.fields.offer_name.for_visitors}}');
    expect(text.pageText).not.toContain('{{form}}');
  });
});

describe('page text for the model', () => {
  const raw =
    '<html><body><p>Deposit 220 EUR {{aio.visit.fields.offer_name.for_visitors}}</p>{{form}}<script>var hiddenDate = "1 January 1999";</script></body></html>';
  const options = {
    formHtml: standFormHtml(['NL']),
    brandName: 'Brand',
    cdnBase: 'https://cdn.example',
    isolated: true,
  };

  it('prefers rendered stand text and does not keep the raw offer macro', () => {
    const rendered = pageTextForAi(raw, options, 'Brand\nTel +31\n12 oktober 2026\nDeposit 220 EUR');
    expect(rendered).toEqual({
      pageText: 'Brand Tel +31 12 oktober 2026 Deposit 220 EUR',
      textTruncated: false,
      source: 'rendered',
    });
    expect(rendered.pageText).not.toContain('offer_name');
    expect(rendered.pageText).not.toContain('1999');

    const fallback = pageTextForAi(raw, options, '  \n');
    expect(fallback.source).toBe('transformed');
    expect(fallback.pageText).toContain('Brand');
    expect(fallback.pageText).toContain('Tel');
    expect(fallback.pageText).toContain('+31');
    expect(fallback.pageText).toContain('220 EUR');
    expect(fallback.pageText).not.toContain('offer_name');
    expect(fallback.pageText).not.toContain('{{form}}');
    expect(fallback.pageText).not.toContain('1999');
    expect(fallback.pageText).not.toContain('cdn.example');
  });
});

describe('landing preview link in the AI phase', () => {
  const cardUuid = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
  const previewUrl =
    'https://preview-track.invalid/?options=new-session&lp=' +
    cardUuid +
    '&launcher=launch-1&suuid=source-1&cuuid=camp-1';
  const previewConfig = {
    aioPreviewCampaignUuid: 'camp-uuid',
    aioPreviewSourceUuid: 'source-uuid',
    aioPreviewDomainUuid: 'domain-uuid',
  };

  async function open(): Promise<{ ctx: TestApp; session: string }> {
    const ctx = await createTestApp({ staticChecks: new PassedStatic(), config: previewConfig });
    const http = ctx.app;
    const login = await request(http.getHttpServer()).post('/session').send({ login: 'env-tl', password: 'env-tl-pass' });
    const session = login.body.session_id as string;
    ctx.aio.zip = zipFiles({
      'land/index.html':
        '<html><body><h1>Andrzej Duda</h1><p>Mifix 250 PLN {{aio.visit.fields.offer_name.for_visitors}}</p>{{form}}<img src="images/hero.jpg" alt="x"></body></html>',
      'land/images/hero.jpg': jpeg(4000),
    });
    ctx.aio.rows = [aioRow({ human_id: '77', uuid: cardUuid, name: 'PL_Andrzej_Duda_Mifix' })];
    await request(http.getHttpServer()).post('/catalog/refresh').set('x-session-id', session);
    return { ctx, session };
  }

  it('keeps the AI review when link generation throws and does not store the url', async () => {
    const { ctx, session } = await open();
    try {
      ctx.aio.previewError = new Error(`boom ${previewUrl}`);
      const started = await request(ctx.app.getHttpServer()).post('/checks').set('x-session-id', session).send({ human_id: '77' });
      const report = await reportOf(ctx.app, session, started.body.check_id);
      expect(ctx.aio.previewCalls).toEqual([cardUuid]);
      expect(ctx.ai.calls).toBe(1);
      expect(ctx.ai.lastInput?.landingPreviewUrl ?? null).toBeNull();
      expect(ctx.ai.lastInput?.standUrl).toContain('/preview/');
      expect(ctx.ai.lastInput?.standUrl).not.toContain('preview-track.invalid');
      expect(ctx.ai.lastInput?.pageText).toContain('Mifix 250 PLN');
      expect(ctx.lighthouse.urls.every((url) => !url.includes('preview-track.invalid'))).toBe(true);
      const aiStep = report.body.steps.find((step: { name: string }) => step.name === 'ai');
      expect(aiStep.state).toBe('done');
      expect(JSON.stringify(report.body)).not.toContain('preview-track.invalid');
      expect(JSON.stringify(report.body)).not.toContain('options=new-session');
      const live = await request(ctx.app.getHttpServer()).get(`/checks/${started.body.check_id}`).set('x-session-id', session);
      expect(String(live.body.stand_url)).toContain('/preview/');
      expect(JSON.stringify(live.body)).not.toContain('preview-track.invalid');
      const stored = await ctx.repos.activeChecks.get(started.body.check_id);
      expect(JSON.stringify(stored)).not.toContain('preview-track.invalid');
      expect(JSON.stringify(stored)).not.toContain('options=new-session');
    } finally {
      await ctx.close();
    }
  });

  it('passes the preview url to the model and keeps the local stand', async () => {
    const { ctx, session } = await open();
    try {
      ctx.aio.previewLink = previewUrl;
      ctx.ai.report = {
        report_markdown: `Кадр ${previewUrl}`,
        checks: [{ category: 1, status: 'PASS' }],
        clarifications: [previewUrl],
      };
      const started = await request(ctx.app.getHttpServer()).post('/checks').set('x-session-id', session).send({ human_id: '77' });
      const report = await reportOf(ctx.app, session, started.body.check_id);
      const input = ctx.ai.lastInput;
      expect(ctx.aio.previewCalls).toEqual([cardUuid]);
      expect(input?.landingPreviewUrl).toBe(previewUrl);
      expect(input?.previewShots).toEqual([]);
      expect(input?.standUrl).toContain('/preview/');
      expect(input?.standUrl).not.toBe(previewUrl);
      expect(input?.pageText).toContain('Mifix');
      expect(input?.pageText).not.toContain('options=new-session');
      expect(ctx.lighthouse.urls.length).toBeGreaterThan(0);
      expect(ctx.lighthouse.urls.every((url) => url.includes('/preview/') && !url.includes('preview-track.invalid'))).toBe(true);
      expect(JSON.stringify(report.body)).not.toContain('preview-track.invalid');
      expect(JSON.stringify(report.body)).not.toContain('launcher=');
      expect(JSON.stringify(report.body)).toContain('[ссылка скрыта]');
      const stored = await ctx.repos.activeChecks.get(started.body.check_id);
      expect(JSON.stringify(stored)).toContain('PL_Andrzej_Duda_Mifix');
      expect(JSON.stringify(stored)).not.toContain('preview-track.invalid');
      expect(JSON.stringify(stored)).not.toContain('options=new-session');
      expect(JSON.stringify(stored)).not.toContain('launcher=');
    } finally {
      await ctx.close();
    }
  });
});

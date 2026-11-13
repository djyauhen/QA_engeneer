import express from 'express';
import type { Request } from 'express';
import request from 'supertest';
import { createAiClient, StubAiClient } from '../src/ai/ai.client';
import { passwordFingerprint } from '../src/auth/auth.service';
import { clientAddress } from '../src/auth/session.controller';
import { CheckStore, leaseDeadline, leaseShouldRenew } from '../src/checks/check.store';
import { CheckRecord } from '../src/checks/check.record';
import { loadConfig } from '../src/config';
import { lighthouseSpawnSpec } from '../src/lighthouse/lighthouse';
import { absolutizeRelativeUrls } from '../src/stand/transform';
import { LEASE_MS } from '../src/tokens';
import { createTestApp } from './app';

const required = {
  TL_LOGIN: 'env-tl',
  TL_PASSWORD: 'env-tl-pass',
  AIO_TOKEN: 'test-aio-token-value',
  FINGERPRINT_KEY: 'test-fingerprint-key',
  STORAGE: 'memory',
};

describe('medium priority guards', () => {
  it('hashes the team-lead password with a server key', () => {
    const left = passwordFingerprint('env-tl-pass', 'key-a');
    const right = passwordFingerprint('env-tl-pass', 'key-b');
    const changed = passwordFingerprint('other-pass', 'key-a');
    expect(left).not.toBe(right);
    expect(left).not.toBe(changed);
    expect(left).toHaveLength(64);
    expect(loadConfig({ ...required, AI_MODE: 'stub' }).aiMode).toBe('stub');
    expect(createAiClient(loadConfig(required))).toBeInstanceOf(StubAiClient);
    expect(() => loadConfig({ ...required, AI_MODE: 'real' })).toThrow(/DEEPSEEK_API_KEY is required/);
    const config = loadConfig({ ...required, AI_MODE: 'real', DEEPSEEK_API_KEY: 'live-key-value' });
    expect(() => createAiClient({ ...config, aiApiKey: '' })).toThrow(/DEEPSEEK_API_KEY is required/);
  });

  it('keeps a spoofed forwarded address off a non-loopback socket', () => {
    expect(addressOf('198.51.100.20', '203.0.113.9')).toBe('198.51.100.20');
    expect(addressOf('127.0.0.1', '203.0.113.9')).toBe('203.0.113.9');
  });

  it('refuses catalog refresh to QA and still lets QA read the catalog', async () => {
    const ctx = await createTestApp();
    const tl = await request(ctx.app.getHttpServer()).post('/session').send({ login: 'env-tl', password: 'env-tl-pass' });
    await request(ctx.app.getHttpServer())
      .post('/admin/users')
      .set('x-session-id', tl.body.session_id)
      .send({ login: 'qa-1', password: 'qa-pass-value', role: 'QA' });
    const qa = await request(ctx.app.getHttpServer()).post('/session').send({ login: 'qa-1', password: 'qa-pass-value' });
    const refresh = await request(ctx.app.getHttpServer())
      .post('/catalog/refresh')
      .set('x-session-id', qa.body.session_id)
      .send({});
    expect(refresh.status).toBe(403);
    const list = await request(ctx.app.getHttpServer()).get('/catalog').set('x-session-id', qa.body.session_id);
    expect(list.status).toBe(200);
    await ctx.close();
  });

  it('renews a running check lease for longer than one AI call', async () => {
    expect(LEASE_MS).toBeGreaterThan(120_000);
    const until = Date.parse(leaseDeadline(1_000));
    expect(until - 1_000).toBe(LEASE_MS);
    expect(leaseShouldRenew({ running: true, detached: false, aborted: false, reportSaved: false })).toBe(true);
    expect(leaseShouldRenew({ running: false, detached: false, aborted: false, reportSaved: false })).toBe(false);

    const upsert = jest.fn(async () => true);
    const store = new CheckStore({
      upsert,
      get: jest.fn(async () => null),
      listByOwner: jest.fn(async () => []),
      tryClaim: jest.fn(async () => false),
      releaseLease: jest.fn(async () => undefined),
      patchDecision: jest.fn(async () => undefined),
      patchActionsAllowed: jest.fn(async () => undefined),
      delete: jest.fn(async () => undefined),
    });
    const check = new CheckRecord('env-tl', 'ТЛ', {
      uuid: 'u',
      human_id: '1',
      name: 'Landing',
      created_at: '',
      countries: [],
      languages: [],
      lander_type_name: '',
      status: '',
      preview_image: '',
      mvt_settings: '',
      owner: null,
      folder: null,
      shares: null,
      updated_at: '',
    });
    check.running = true;
    store.renewRunningLease(check);
    await new Promise((resolve) => setImmediate(resolve));
    expect(upsert).toHaveBeenCalled();
    const args = upsert.mock.calls[0] as unknown as [string, string, unknown, { until: string }];
    expect(Date.parse(args[3].until) - Date.now()).toBeGreaterThan(120_000);
    check.running = false;
    upsert.mockClear();
    store.renewRunningLease(check);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('absolutizes a relative landing url and does not use npx for lighthouse', () => {
    const html = absolutizeRelativeUrls('<script src="app.js"></script>', 'https://bdc-it.uk/preview/1');
    expect(html).toContain('src="https://bdc-it.uk/preview/1/app.js"');
    expect(absolutizeRelativeUrls('<script src="https://cdn.example/a.js"></script>', 'https://bdc-it.uk/preview/1')).toContain(
      'https://cdn.example/a.js',
    );
    const spec = lighthouseSpawnSpec(['https://bdc-it.uk/preview/1', '--quiet'], {
      execPath: '/usr/bin/node',
      cliPath: '/app/node_modules/lighthouse/cli/index.js',
    });
    expect(spec.command).toBe('/usr/bin/node');
    expect(spec.args[0]).toContain('lighthouse');
    expect(spec.args.join(' ')).not.toContain('npx');
  });
});

function addressOf(remote: string, forwarded: string): string {
  const app = express();
  app.set('trust proxy', 'loopback');
  const req = Object.create(app.request) as Request;
  req.app = app;
  req.headers = { 'x-forwarded-for': forwarded };
  req.socket = { remoteAddress: remote } as Request['socket'];
  return clientAddress(req);
}

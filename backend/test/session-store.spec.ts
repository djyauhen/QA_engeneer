import request from 'supertest';
import { CatalogCard } from '../src/catalog/map-row';
import { CheckRecord } from '../src/checks/check.record';
import { CheckStore } from '../src/checks/check.store';
import { ChecksService } from '../src/checks/checks.service';
import { SessionUser } from '../src/config';
import { createMemoryRepos } from '../src/storage/memory-repos';
import { createTestApp, TestApp } from './app';

const user: SessionUser = { login: 'env-tl', role: 'ТЛ', source: 'environment' };

function card(): CatalogCard {
  return {
    uuid: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
    human_id: '359226',
    name: 'Landing',
    created_at: '2026-01-01T00:00:00.000Z',
    countries: ['US'],
    languages: ['en'],
    lander_type_name: 'type',
    status: 'active',
    preview_image: 'https://example.test/preview.png',
    mvt_settings: '',
    owner: null,
    folder: null,
    shares: null,
    updated_at: '',
  };
}

async function eventually(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('timed out waiting for the shared snapshot');
}

describe('sessions and checks shared across processes', () => {
  let primary: TestApp;
  let secondary: TestApp;

  beforeEach(async () => {
    const repos = createMemoryRepos();
    primary = await createTestApp({ repos });
    secondary = await createTestApp({ repos });
  });

  afterEach(async () => {
    await Promise.all([primary?.close(), secondary?.close()]);
  });

  it('accepts a session created on another instance and rejects an unknown or expired id', async () => {
    const login = await request(primary.app.getHttpServer())
      .post('/session')
      .send({ login: 'env-tl', password: 'env-tl-pass' });
    expect(login.status).toBe(200);
    const sessionId = login.body.session_id as string;

    const current = await request(secondary.app.getHttpServer()).get('/session').set('x-session-id', sessionId);
    expect(current.status).toBe(200);
    expect(current.body).toEqual({ role: 'ТЛ' });

    const unknown = await request(secondary.app.getHttpServer()).get('/session').set('x-session-id', 'missing-session');
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual({ error: 'unauthorized' });

    await primary.repos.sessions.touch(sessionId, new Date(Date.now() - 1000).toISOString());
    const expired = await request(secondary.app.getHttpServer()).get('/session').set('x-session-id', sessionId);
    expect(expired.status).toBe(401);
    expect(expired.body).toEqual({ error: 'unauthorized' });
    expect(await primary.repos.sessions.get(sessionId)).toBeNull();
  });

  it('returns the same check steps from another instance and applies a remote AI decision', async () => {
    const storeA = primary.app.get(CheckStore);
    const checksA = primary.app.get(ChecksService);
    const checksB = secondary.app.get(ChecksService);
    const record = new CheckRecord(user.login, user.role, card());
    record.step('catalog', 'done');
    storeA.add(record);
    record.step('download_request', 'running');

    await eventually(async () => {
      try {
        const remote = await checksB.view(user, record.id);
        const step = (remote.steps as Array<{ name: string; state: string }>).find(
          (item) => item.name === 'download_request',
        );
        return step?.state === 'running';
      } catch {
        return false;
      }
    });

    const local = await checksA.view(user, record.id);
    const remote = await checksB.view(user, record.id);
    expect(remote.steps).toEqual(local.steps);
    expect(remote).toMatchObject({
      check_id: record.id,
      human_id: '359226',
      name: 'Landing',
      owner_login: 'env-tl',
    });

    record.aiBlock = { status: 'не запускался (ждут решения пользователя)', findings: [], decision: null };
    record.step('ai_gate', 'waiting_user');
    await eventually(async () => {
      const body = await checksB.view(user, record.id);
      return (body.steps as Array<{ name: string; state: string }>).some(
        (step) => step.name === 'ai_gate' && step.state === 'waiting_user',
      );
    });

    const decision = record.waitDecision();
    await expect(checksB.decide(user, record.id, { decision: 'allow' })).resolves.toEqual({ decision: 'allow' });
    await expect(decision).resolves.toBe('allow');
    expect((await primary.repos.activeChecks.get(record.id))?.payload.pendingDecision).toBeNull();

    record.standReady = true;
    record.standUrl = `http://127.0.0.1:3000/preview/${record.id}/index.html`;
    record.step('stand', 'done');
    await eventually(async () => {
      const body = await checksB.view(user, record.id);
      return body.stand_url === record.standUrl;
    });
    await expect(checksB.allowStand(user, record.id, { decision: 'allow' })).resolves.toEqual({
      actions_allowed: true,
    });
    await eventually(async () => record.actionsAllowed);
    expect(record.actionsAllowed).toBe(true);
  });
});

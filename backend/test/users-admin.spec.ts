import request from 'supertest';
import { MemorySessionsRepo } from '../src/storage/memory-repos';
import { createTestApp, TestApp } from './app';

describe('blocking and password change', () => {
  let ctx: TestApp;

  beforeEach(async () => {
    ctx = await createTestApp();
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('refuses a blocked user and drops that login sessions', async () => {
    const tl = await teamLead(ctx);
    await request(ctx.app.getHttpServer())
      .post('/admin/users')
      .set('x-session-id', tl)
      .send({ login: 'qa-1', password: 'qa-pass-value', role: 'QA' });
    const qa = await request(ctx.app.getHttpServer()).post('/session').send({ login: 'qa-1', password: 'qa-pass-value' });
    expect(qa.status).toBe(200);
    const sessionId = qa.body.session_id as string;
    expect(sessionLogins(ctx)).toContain('qa-1');

    const blocked = await request(ctx.app.getHttpServer())
      .post('/admin/users/qa-1/block')
      .set('x-session-id', tl)
      .send({ disabled: true });
    expect(blocked.status).toBe(200);
    expect(blocked.body).toEqual({ login: 'qa-1', disabled: true });
    expect(sessionLogins(ctx)).not.toContain('qa-1');

    const still = await request(ctx.app.getHttpServer()).get('/session').set('x-session-id', sessionId);
    expect(still.status).toBe(401);
    const again = await request(ctx.app.getHttpServer()).post('/session').send({ login: 'qa-1', password: 'qa-pass-value' });
    const wrong = await request(ctx.app.getHttpServer()).post('/session').send({ login: 'qa-1', password: 'wrong-pass' });
    expect(again.status).toBe(401);
    expect(again.body).toEqual(wrong.body);

    const opened = await request(ctx.app.getHttpServer())
      .post('/admin/users/qa-1/block')
      .set('x-session-id', tl)
      .send({ disabled: false });
    expect(opened.body).toEqual({ login: 'qa-1', disabled: false });
    const back = await request(ctx.app.getHttpServer()).post('/session').send({ login: 'qa-1', password: 'qa-pass-value' });
    expect(back.status).toBe(200);
  });

  it('replaces the password and drops existing sessions', async () => {
    const tl = await teamLead(ctx);
    await request(ctx.app.getHttpServer())
      .post('/admin/users')
      .set('x-session-id', tl)
      .send({ login: 'qa-1', password: 'qa-pass-value', role: 'QA' });
    const qa = await request(ctx.app.getHttpServer()).post('/session').send({ login: 'qa-1', password: 'qa-pass-value' });
    const sessionId = qa.body.session_id as string;
    const next = 'new-pass-value';
    const changed = await request(ctx.app.getHttpServer())
      .post('/admin/users/qa-1/password')
      .set('x-session-id', tl)
      .send({ password: next });
    expect(changed.status).toBe(200);
    expect(changed.body).toEqual({ ok: true });
    expect(JSON.stringify(changed.body)).not.toContain(next);
    expect(sessionLogins(ctx)).not.toContain('qa-1');
    const oldSession = await request(ctx.app.getHttpServer()).get('/session').set('x-session-id', sessionId);
    expect(oldSession.status).toBe(401);
    const oldPassword = await request(ctx.app.getHttpServer()).post('/session').send({ login: 'qa-1', password: 'qa-pass-value' });
    expect(oldPassword.status).toBe(401);
    const fresh = await request(ctx.app.getHttpServer()).post('/session').send({ login: 'qa-1', password: next });
    expect(fresh.status).toBe(200);
    expect(fresh.body.role).toBe('QA');
  });

  it('refuses QA and does not change the environment team lead', async () => {
    const tl = await teamLead(ctx);
    await request(ctx.app.getHttpServer())
      .post('/admin/users')
      .set('x-session-id', tl)
      .send({ login: 'qa-1', password: 'qa-pass-value', role: 'QA' });
    const qa = await request(ctx.app.getHttpServer()).post('/session').send({ login: 'qa-1', password: 'qa-pass-value' });
    const sessionId = qa.body.session_id as string;
    const block = await request(ctx.app.getHttpServer())
      .post('/admin/users/qa-2/block')
      .set('x-session-id', sessionId)
      .send({ disabled: true });
    const password = await request(ctx.app.getHttpServer())
      .post('/admin/users/qa-1/password')
      .set('x-session-id', sessionId)
      .send({ password: 'other-pass-value' });
    expect(block.status).toBe(403);
    expect(password.status).toBe(403);

    const envBlock = await request(ctx.app.getHttpServer())
      .post('/admin/users/env-tl/block')
      .set('x-session-id', tl)
      .send({ disabled: true });
    const envPassword = await request(ctx.app.getHttpServer())
      .post('/admin/users/env-tl/password')
      .set('x-session-id', tl)
      .send({ password: 'other-pass-value' });
    expect(envBlock.status).toBe(409);
    expect(envPassword.status).toBe(409);
    expect(ctx.users.rows.find((row) => row.login === 'env-tl')).toBeUndefined();
    const still = await request(ctx.app.getHttpServer()).post('/session').send({ login: 'env-tl', password: 'env-tl-pass' });
    expect(still.status).toBe(200);
  });
});

async function teamLead(ctx: TestApp): Promise<string> {
  const login = await request(ctx.app.getHttpServer()).post('/session').send({ login: 'env-tl', password: 'env-tl-pass' });
  return login.body.session_id as string;
}

function sessionLogins(ctx: TestApp): string[] {
  return [...(ctx.repos.sessions as MemorySessionsRepo).rows.values()].map((row) => row.login);
}

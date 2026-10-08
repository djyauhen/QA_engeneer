import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { LOGIN_REFUSED } from '../src/tokens';
import { createTestApp, TestApp } from './app';

describe('session and users', () => {
  let ctx: TestApp;
  let http: INestApplication;

  beforeEach(async () => {
    ctx = await createTestApp();
    http = ctx.app;
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('treats a wrong login and a wrong password as the same refusal', async () => {
    const unknown = await request(http.getHttpServer()).post('/session').send({ login: 'nobody', password: 'nope-pass' });
    const badPassword = await request(http.getHttpServer())
      .post('/session')
      .send({ login: 'env-tl', password: 'nope-pass' });
    expect(unknown.status).toBe(401);
    expect(badPassword.status).toBe(401);
    expect(unknown.body).toEqual(badPassword.body);
    expect(unknown.body).toEqual({ error: LOGIN_REFUSED });
    expect(JSON.stringify(unknown.body)).not.toMatch(/password|парол|логин не/i);
  });

  it('lets the env team lead in as ТЛ and does not copy that password into users', async () => {
    const login = await request(http.getHttpServer())
      .post('/session')
      .send({ login: 'env-tl', password: 'env-tl-pass' });
    expect(login.status).toBe(200);
    expect(login.body.role).toBe('ТЛ');
    expect(login.body.session_id).toEqual(expect.any(String));
    expect(JSON.stringify(login.body)).not.toContain('env-tl-pass');
    expect(ctx.users.rows.find((row) => row.login === 'env-tl')).toBeUndefined();

    const created = await request(http.getHttpServer())
      .post('/admin/users')
      .set('x-session-id', login.body.session_id)
      .send({ login: 'qa-1', password: 'qa-pass-value', role: 'QA' });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ login: 'qa-1', role: 'QA' });
    const stored = ctx.users.rows.find((row) => row.login === 'qa-1');
    expect(stored?.role).toBe('QA');
    expect(stored?.password_hash).not.toBe('qa-pass-value');
    expect(Object.keys(stored ?? {}).sort()).toEqual(['login', 'password_hash', 'role']);

    const duplicateEnv = await request(http.getHttpServer())
      .post('/admin/users')
      .set('x-session-id', login.body.session_id)
      .send({ login: 'env-tl', password: 'other-pass', role: 'QA' });
    expect(duplicateEnv.status).toBe(409);

    const list = await request(http.getHttpServer())
      .get('/admin/users')
      .set('x-session-id', login.body.session_id);
    expect(list.status).toBe(200);
    expect(list.body.users[0]).toEqual({ login: 'env-tl', role: 'ТЛ', source: 'environment' });
    expect(list.body.users[1]).toEqual({ login: 'qa-1', role: 'QA', source: 'neon' });
    expect(JSON.stringify(list.body)).not.toContain('qa-pass-value');
    expect(JSON.stringify(list.body)).not.toContain('password');

    const qaLogin = await request(http.getHttpServer())
      .post('/session')
      .send({ login: 'qa-1', password: 'qa-pass-value' });
    expect(qaLogin.body.role).toBe('QA');
    const qaBad = await request(http.getHttpServer())
      .post('/session')
      .send({ login: 'qa-1', password: 'wrong-pass' });
    const qaMissing = await request(http.getHttpServer())
      .post('/session')
      .send({ login: 'qa-missing', password: 'wrong-pass' });
    expect(qaBad.body).toEqual(qaMissing.body);

    for (const path of ['/admin/users', '/admin/rules', '/admin/costs']) {
      const denied = await request(http.getHttpServer()).get(path).set('x-session-id', qaLogin.body.session_id);
      expect(denied.status).toBe(403);
      expect(denied.body).toEqual({ error: 'forbidden', message: 'Недостаточно прав' });
    }
    const postDenied = await request(http.getHttpServer())
      .post('/admin/users')
      .set('x-session-id', qaLogin.body.session_id)
      .send({ login: 'x', password: 'y', role: 'QA' });
    expect(postDenied.status).toBe(403);

    const current = await request(http.getHttpServer())
      .get('/session')
      .set('x-session-id', login.body.session_id);
    expect(current.body).toEqual({ role: 'ТЛ' });
    await request(http.getHttpServer()).delete('/session').set('x-session-id', login.body.session_id);
    const after = await request(http.getHttpServer()).get('/session').set('x-session-id', login.body.session_id);
    expect(after.status).toBe(401);

    const register = await request(http.getHttpServer()).post('/register').send({ login: 'a', password: 'b' });
    expect(register.status).toBe(404);
  });
});

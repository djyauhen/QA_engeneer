import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import {
  chooseAiProfile,
  findGrokCommand,
  GrokProbe,
  grokSessionPresent,
  listAiProfiles,
  profileFromSnapshot,
} from '../src/ai/ai-profile';
import { readDevicePrompt } from '../src/ai/grok.login';
import { recordFromSnapshot } from '../src/checks/snapshot';
import { loadConfig } from '../src/config';
import { ActiveCheckSnapshot } from '../src/storage/repos';
import { createTestApp, TestApp } from './app';
import { aioRow } from './fakes';

const required = {
  TL_LOGIN: 'env-tl',
  TL_PASSWORD: 'env-tl-pass',
  AIO_TOKEN: 'test-aio-token-value',
  FINGERPRINT_KEY: 'test-fingerprint-key',
  STORAGE: 'memory',
};

function emptySnapshot(): ActiveCheckSnapshot {
  return {
    ownerLogin: 'env-tl',
    ownerRole: 'ТЛ',
    human_id: '359226',
    name: 'Demo',
    preview_image: '',
    steps: [],
    static: null,
    ai: null,
    lighthouse: null,
    replaced_previous_stand: false,
    standReady: false,
    standUrl: null,
    actionsAllowed: false,
    reportSaved: false,
    aborted: false,
    pendingDecision: null,
  };
}

describe('ai profile choice', () => {
  it('lists deepseek only with a real key and grok only when the binary and session exist', () => {
    const secret = 'session-token-not-for-the-ui';
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-grok-home-'));
    fs.writeFileSync(path.join(home, 'auth.json'), JSON.stringify({ access_token: secret }));
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-grok-bin-'));
    const exe = path.join(bin, process.platform === 'win32' ? 'grok.exe' : 'grok');
    fs.writeFileSync(exe, '');
    const absent = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-grok-absent-'));
    const local = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-grok-local-'));
    const localExe = path.join(local, process.platform === 'win32' ? 'grok.exe' : 'grok');
    fs.writeFileSync(localExe, '');
    try {
      expect(grokSessionPresent({ GROK_HOME: home })).toBe(true);
      expect(grokSessionPresent({ GROK_HOME: path.join(home, 'missing') })).toBe(false);
      const packaged = findGrokCommand({ PATH: '', Path: '' });
      expect(packaged?.replace(/\\/g, '/')).toMatch(
        /node_modules\/(?:\.bin\/grok(?:\.cmd)?|@xai-official\/grok\/bin\/grok)$/,
      );
      expect(findGrokCommand({ PATH: bin, Path: bin }, absent)).toBe(exe);
      expect(findGrokCommand({ PATH: '', Path: '' }, absent)).toBeNull();
      expect(findGrokCommand({ PATH: bin, Path: bin }, local)).toBe(localExe);
      const listed = listAiProfiles(
        { aiMode: 'stub', aiApiKey: '', grokModel: 'grok-4.7' },
        { command: true, session: true },
      );
      expect(listed).toEqual([{ id: 'grok', label: 'Grok 4.7' }]);
      expect(JSON.stringify(listed)).not.toContain(secret);
      expect(
        listAiProfiles({ aiMode: 'real', aiApiKey: 'live-key', grokModel: 'grok-4.7' }, { command: false, session: false }),
      ).toEqual([{ id: 'deepseek', label: 'DeepSeek' }]);
      expect(
        listAiProfiles({ aiMode: 'real', aiApiKey: 'live-key', grokModel: 'grok-4.7' }, { command: true, session: false }),
      ).toEqual([{ id: 'deepseek', label: 'DeepSeek' }]);
      expect(listAiProfiles({ aiMode: 'stub', aiApiKey: '', grokModel: 'grok-4.7' }, { command: false, session: false })).toEqual(
        [],
      );
      expect(Object.keys(listed[0]).sort()).toEqual(['id', 'label']);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(bin, { recursive: true, force: true });
      fs.rmSync(absent, { recursive: true, force: true });
      fs.rmSync(local, { recursive: true, force: true });
    }
  });

  it('refuses a free slug and keeps an omitted profile on deepseek when it is available', () => {
    const both = [
      { id: 'deepseek' as const, label: 'DeepSeek' },
      { id: 'grok' as const, label: 'Grok 4.7' },
    ];
    expect(chooseAiProfile(undefined, both)).toEqual(both[0]);
    expect(chooseAiProfile(undefined, [both[1]])).toEqual(both[1]);
    expect(chooseAiProfile(undefined, [])).toEqual({ id: 'deepseek', label: 'DeepSeek' });
    expect(chooseAiProfile('grok-4.7', both)).toBeNull();
    expect(chooseAiProfile('grok', [both[0]])).toBeNull();
    expect(loadConfig(required).grokModel).toBe('grok-4.7');
    expect(loadConfig({ ...required, GROK_MODEL: ' grok-4.7 ' }).grokModel).toBe('grok-4.7');
    expect('xaiApiKey' in loadConfig(required)).toBe(false);
  });

  it('reads a snapshot without a profile as deepseek and keeps a stored grok profile', () => {
    const old = recordFromSnapshot('old-check', emptySnapshot());
    expect(old.aiProfile).toEqual({ id: 'deepseek', label: 'DeepSeek' });
    expect(profileFromSnapshot({})).toEqual({ id: 'deepseek', label: 'DeepSeek' });
    const kept = recordFromSnapshot('grok-check', {
      ...emptySnapshot(),
      ai_profile: { id: 'grok', label: 'Grok 4.7' },
    });
    expect(kept.aiProfile).toEqual({ id: 'grok', label: 'Grok 4.7' });
  });
});

describe('check start profile', () => {
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
    ctx.aio.downloadRequests = [];
    ctx.aio.fileReads = 0;
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('does not download a file when ai_profile is not an available id', async () => {
    const started = await request(http.getHttpServer())
      .post('/checks')
      .set('x-session-id', session)
      .send({ human_id: '359226', ai_profile: 'grok-4.7' });
    expect(started.status).toBe(400);
    expect(started.body.message).toBe('Скачивание не начато.');
    expect(ctx.aio.downloadRequests).toEqual([]);
    expect(ctx.aio.fileReads).toBe(0);
    expect(await ctx.repos.activeChecks.listByOwner('env-tl')).toEqual([]);
  });

  it('stores the profile on the snapshot before the archive is read', async () => {
    await ctx.close();
    ctx = await createTestApp({
      config: {
        aiMode: 'real',
        aiApiKey: 'test-deepseek-placeholder',
        aiBaseUrl: 'https://api.deepseek.com',
        aiModel: 'deepseek-v4-pro',
        aiVisionModel: 'deepseek-flash',
      },
    });
    http = ctx.app;
    const login = await request(http.getHttpServer()).post('/session').send({ login: 'env-tl', password: 'env-tl-pass' });
    session = login.body.session_id;
    ctx.aio.rows = [aioRow({ human_id: '359226', uuid: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', name: 'Demo' })];
    await request(http.getHttpServer()).post('/catalog/refresh').set('x-session-id', session);
    let seen = false;
    ctx.aio.requestDownload = async () => {
      const rows = await ctx.repos.activeChecks.listByOwner('env-tl');
      expect(ctx.aio.downloadRequests).toEqual([]);
      expect(ctx.aio.fileReads).toBe(0);
      expect(rows[0]?.payload.ai_profile).toEqual({ id: 'deepseek', label: 'DeepSeek' });
      seen = true;
      throw new Error('stop-before-file');
    };
    const started = await request(http.getHttpServer())
      .post('/checks')
      .set('x-session-id', session)
      .send({ human_id: '359226', ai_profile: 'deepseek', label: 'чужая подпись' });
    expect(started.status).toBe(201);
    for (let i = 0; i < 40 && !seen; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    expect(seen).toBe(true);
    expect(ctx.aio.fileReads).toBe(0);
    let saved = await request(http.getHttpServer()).get(`/reports/${started.body.check_id}`).set('x-session-id', session);
    for (let i = 0; i < 40 && saved.status !== 200; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      saved = await request(http.getHttpServer()).get(`/reports/${started.body.check_id}`).set('x-session-id', session);
    }
    expect(saved.status).toBe(200);
    expect(saved.body.ai_profile).toEqual({ id: 'deepseek', label: 'DeepSeek' });
  });
});

describe('grok login for the team lead', () => {
  const secret = 'super-secret-token-value';

  function probe(): GrokProbe & { calls: Array<{ command: string; args: string[] }> } {
    const calls: Array<{ command: string; args: string[] }> = [];
    return {
      calls,
      command: () => 'grok',
      session: () => false,
      spawn: async (command, args) => {
        calls.push({ command, args: [...args] });
        return { stdout: JSON.stringify({ access_token: secret }), code: 0 };
      },
      spawnLogin: async (command, args, emit) => {
        calls.push({ command, args: [...args] });
        emit('Open https://auth.x.ai/device and enter code: ABCD-EF12\n');
        emit(`{"access_token":"${secret}"}`);
        return 0;
      },
    };
  }

  it('returns the device url and code to the team lead and refuses QA', async () => {
    const grok = probe();
    const ctx = await createTestApp({ grokProbe: grok });
    const http = ctx.app;
    const tl = await request(http.getHttpServer()).post('/session').send({ login: 'env-tl', password: 'env-tl-pass' });
    await request(http.getHttpServer())
      .post('/admin/users')
      .set('x-session-id', tl.body.session_id)
      .send({ login: 'qa-grok', password: 'qa-grok-pass', role: 'QA' });
    const qa = await request(http.getHttpServer()).post('/session').send({ login: 'qa-grok', password: 'qa-grok-pass' });
    const denied = await request(http.getHttpServer()).post('/admin/grok/login').set('x-session-id', qa.body.session_id).send({});
    expect(denied.status).toBe(403);
    const deniedLogout = await request(http.getHttpServer())
      .post('/admin/grok/logout')
      .set('x-session-id', qa.body.session_id)
      .send({});
    expect(deniedLogout.status).toBe(403);
    expect(grok.calls).toEqual([]);
    const profiles = await request(http.getHttpServer()).get('/ai/profiles').set('x-session-id', qa.body.session_id);
    expect(profiles.status).toBe(200);
    expect(profiles.body).toEqual({ profiles: [] });
    const started = await request(http.getHttpServer()).post('/admin/grok/login').set('x-session-id', tl.body.session_id).send({});
    expect(started.status).toBe(200);
    expect(started.body).toEqual({ url: 'https://auth.x.ai/device', code: 'ABCD-EF12' });
    expect(JSON.stringify(started.body)).not.toContain(secret);
    expect(grok.calls).toEqual([{ command: 'grok', args: ['login', '--device-auth'] }]);
    const loggedOut = await request(http.getHttpServer()).post('/admin/grok/logout').set('x-session-id', tl.body.session_id).send({});
    expect(loggedOut.status).toBe(200);
    expect(loggedOut.body).toEqual({ ok: true });
    expect(JSON.stringify(loggedOut.body)).not.toContain(secret);
    expect(grok.calls[1]).toEqual({ command: 'grok', args: ['logout'] });
    expect(readDevicePrompt(`{"verification_uri":"https://auth.x.ai/device","user_code":"ABCD-EF12","access_token":"${secret}"}`)).toEqual({
      url: 'https://auth.x.ai/device',
      code: 'ABCD-EF12',
    });
    await ctx.close();
  });
});

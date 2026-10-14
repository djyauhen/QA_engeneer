import 'reflect-metadata';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AiClient } from '../src/ai/ai.client';
import { AioClient } from '../src/aio/aio.client';
import { AppModule } from '../src/app.module';
import { AppConfig } from '../src/config';
import { configureApp } from '../src/configure-app';
import { LighthouseRunner } from '../src/lighthouse/lighthouse';
import { Runtime } from '../src/runtime.module';
import { createMemoryRepos, MemoryUsersRepo } from '../src/storage/memory-repos';
import { Repos } from '../src/storage/repos';
import { AioStaticChecks, StaticChecks } from '../src/static/static-checks';
import { FakeAio, ScriptedAi, ScriptedLighthouse } from './fakes';

export interface TestApp {
  app: INestApplication;
  repos: Repos;
  users: MemoryUsersRepo;
  aio: FakeAio;
  ai: ScriptedAi;
  lighthouse: ScriptedLighthouse;
  workDir: string;
  close: () => Promise<void>;
}

export async function createTestApp(options?: {
  aio?: AioClient;
  ai?: AiClient;
  lighthouse?: LighthouseRunner;
  staticChecks?: StaticChecks;
  repos?: Repos;
}): Promise<TestApp> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-backend-'));
  const config: AppConfig = {
    storage: 'memory',
    databaseUrl: '',
    aioToken: 'test-aio-token-value',
    aioBaseUrl: 'https://app.aio.tech',
    aioStorageHosts: ['files.aio.tech'],
    tlLogin: 'env-tl',
    tlPassword: 'env-tl-pass',
    workDir,
    port: 0,
    publicBaseUrl: 'http://127.0.0.1:3000',
    standFormHtml: '<div data-stand-form="1">FORM</div>',
    standBrandName: 'Acme',
    standCdnBase: '',
    catalogAutoRefresh: false,
    frontendOrigin: [],
    aioNotifyPollMs: 1,
    aioNotifyPollsPerAttempt: 2,
    aiMode: 'stub',
    aiBaseUrl: '',
    aiApiKey: '',
    aiModel: 'deepseek-flash',
    lighthouseMode: 'stub',
    lighthouseChromePath: '',
    lighthouseNoSandbox: false,
    bcryptRounds: 4,
    poolMax: 10,
  };
  const repos = options?.repos ?? createMemoryRepos();
  const aio = (options?.aio as FakeAio) ?? new FakeAio();
  const ai = (options?.ai as ScriptedAi) ?? new ScriptedAi();
  const lighthouse = (options?.lighthouse as ScriptedLighthouse) ?? new ScriptedLighthouse();
  const runtime: Runtime = {
    config,
    repos,
    aio,
    ai,
    lighthouse,
    staticChecks: options?.staticChecks ?? new AioStaticChecks(),
  };
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register(runtime)],
  }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return {
    app,
    repos,
    users: repos.users as MemoryUsersRepo,
    aio,
    ai,
    lighthouse,
    workDir,
    close: async () => {
      await app.close();
      fs.rmSync(workDir, { recursive: true, force: true });
    },
  };
}

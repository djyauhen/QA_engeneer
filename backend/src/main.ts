import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createAiClient } from './ai/ai.client';
import { HttpAioClient } from './aio/aio.client';
import { AppModule } from './app.module';
import { loadConfig } from './config';
import { configureApp } from './configure-app';
import { createLighthouseRunner } from './lighthouse/lighthouse';
import { nestLogger } from './logger';
import { Runtime } from './runtime.module';
import { createPostgresRepos } from './storage/postgres-repos';
import { createMemoryRepos } from './storage/memory-repos';
import { AioStaticChecks } from './static/static-checks';

async function buildRuntime(): Promise<Runtime> {
  const config = loadConfig(process.env);
  const repos = config.storage === 'memory' ? createMemoryRepos() : await createPostgresRepos(config.databaseUrl);
  return {
    config,
    repos,
    aio: new HttpAioClient(config),
    ai: createAiClient(config),
    lighthouse: createLighthouseRunner(config),
    staticChecks: new AioStaticChecks(),
  };
}

async function bootstrap(): Promise<void> {
  const runtime = await buildRuntime();
  const app = await NestFactory.create(AppModule.register(runtime), { logger: nestLogger(runtime.config) });
  configureApp(app);
  await app.listen(runtime.config.port);
}

void bootstrap();

import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Request, Response } from 'express';
import { createAiClient } from './ai/ai.client';
import { HttpAioClient } from './aio/aio.client';
import { AppModule } from './app.module';
import { loadConfig } from './config';
import { configureApp, corsOrigin } from './configure-app';
import { createLighthouseRunner } from './lighthouse/lighthouse';
import { nestLogger } from './logger';
import { Runtime } from './runtime.module';
import { createPostgresRepos } from './storage/postgres-repos';
import { createMemoryRepos } from './storage/memory-repos';
import { AioStaticChecks } from './static/static-checks';

@Module({})
class StartupFailureModule {}

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
  try {
    const runtime = await buildRuntime();
    const app = await NestFactory.create(AppModule.register(runtime), { logger: nestLogger(runtime.config) });
    configureApp(app);
    await app.listen(runtime.config.port);
  } catch (error) {
    console.error(`startup failed: ${safeError(error)}`);
    await listenAfterStartupFailure();
  }
}

async function listenAfterStartupFailure(): Promise<void> {
  const app = await NestFactory.create(StartupFailureModule, { logger: false });
  app.enableCors({
    origin: corsOrigin([]),
    credentials: true,
    allowedHeaders: ['Content-Type', 'X-Session-Id', 'Authorization'],
  });
  app.use((_req: Request, res: Response) => {
    res.status(503).json({ error: 'startup_failed' });
  });
  await app.listen(listenPort());
}

function listenPort(): number {
  const port = Number(process.env.PORT ?? 3000);
  return Number.isFinite(port) && port > 0 ? port : 3000;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'startup failed';
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]');
}

void bootstrap();

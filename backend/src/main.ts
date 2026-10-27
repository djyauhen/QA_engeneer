import 'reflect-metadata';
import fs from 'fs';
import path from 'path';
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
  const repos =
    config.storage === 'memory' ? createMemoryRepos() : await createPostgresRepos(config.databaseUrl, config.poolMax);
  return {
    config,
    repos,
    aio: new HttpAioClient(config),
    ai: createAiClient(config),
    lighthouse: createLighthouseRunner(config),
    staticChecks: new AioStaticChecks(),
  };
}

function loadLocalEnv(): void {
  const candidates = [path.resolve(process.cwd(), '.env'), path.resolve(__dirname, '../.env')];
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (!file) return;
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key]) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (value.length >= 2) {
      const quote = value[0];
      if ((quote === '"' || quote === "'") && value.endsWith(quote)) value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

async function bootstrap(): Promise<void> {
  loadLocalEnv();
  try {
    const runtime = await buildRuntime();
    const app = await NestFactory.create(AppModule.register(runtime), { logger: nestLogger(runtime.config) });
    configureApp(app);
    await app.listen(runtime.config.port);
  } catch (error) {
    console.error(`startup failed: ${safeError(error)}`);
    if (isConfigError(error)) process.exit(1);
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

function isConfigError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return message.includes('is required') || message.includes('are required');
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'startup failed';
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]');
}

void bootstrap();

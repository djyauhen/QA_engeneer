import { DynamicModule, Global, Module } from '@nestjs/common';
import { AiClient } from './ai/ai.client';
import { AioClient } from './aio/aio.client';
import { AppConfig } from './config';
import { LighthouseRunner } from './lighthouse/lighthouse';
import { Repos } from './storage/repos';
import { StaticChecks } from './static/static-checks';
import {
  ACTIVE_CHECKS_REPO,
  APP_CONFIG,
  CHECK_ARCHIVES_REPO,
  LOGIN_ATTEMPTS_REPO,
  CATALOG_QUERY_REPO,
  CATALOG_REPO,
  COSTS_REPO,
  REPORTS_REPO,
  RULES_REPO,
  SESSIONS_REPO,
  USERS_REPO,
} from './tokens';

export interface Runtime {
  config: AppConfig;
  repos: Repos;
  aio: AioClient;
  ai: AiClient;
  lighthouse: LighthouseRunner;
  staticChecks: StaticChecks;
}

@Global()
@Module({})
export class RuntimeModule {
  static register(runtime: Runtime): DynamicModule {
    return {
      module: RuntimeModule,
      global: true,
      providers: [
        { provide: APP_CONFIG, useValue: runtime.config },
        { provide: USERS_REPO, useValue: runtime.repos.users },
        { provide: SESSIONS_REPO, useValue: runtime.repos.sessions },
        { provide: CATALOG_REPO, useValue: runtime.repos.catalog },
        { provide: CATALOG_QUERY_REPO, useValue: runtime.repos.catalogQuery },
        { provide: REPORTS_REPO, useValue: runtime.repos.reports },
        { provide: RULES_REPO, useValue: runtime.repos.rules },
        { provide: COSTS_REPO, useValue: runtime.repos.costs },
        { provide: ACTIVE_CHECKS_REPO, useValue: runtime.repos.activeChecks },
        { provide: CHECK_ARCHIVES_REPO, useValue: runtime.repos.archives },
        { provide: LOGIN_ATTEMPTS_REPO, useValue: runtime.repos.loginAttempts },
        { provide: AioClient, useValue: runtime.aio },
        { provide: AiClient, useValue: runtime.ai },
        { provide: LighthouseRunner, useValue: runtime.lighthouse },
        { provide: StaticChecks, useValue: runtime.staticChecks },
      ],
      exports: [
        APP_CONFIG,
        USERS_REPO,
        SESSIONS_REPO,
        CATALOG_REPO,
        CATALOG_QUERY_REPO,
        REPORTS_REPO,
        RULES_REPO,
        COSTS_REPO,
        ACTIVE_CHECKS_REPO,
        CHECK_ARCHIVES_REPO,
        LOGIN_ATTEMPTS_REPO,
        AioClient,
        AiClient,
        LighthouseRunner,
        StaticChecks,
      ],
    };
  }
}

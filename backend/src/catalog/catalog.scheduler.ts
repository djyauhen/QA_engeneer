import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AppConfig } from '../config';
import { secretList } from '../config';
import { redactSecrets } from '../redact';
import { APP_CONFIG, CATALOG_REFRESH_MS } from '../tokens';
import { CatalogService } from './catalog.service';

@Injectable()
export class CatalogScheduler implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private readonly logger = new Logger(CatalogScheduler.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly catalog: CatalogService,
  ) {}

  onModuleInit(): void {
    if (!this.config.catalogAutoRefresh) return;
    void this.catalog.refresh().catch((error: unknown) => this.logFailure(error));
    this.timer = setInterval(() => {
      void this.catalog.refresh().catch((error: unknown) => this.logFailure(error));
    }, CATALOG_REFRESH_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private logFailure(error: unknown): void {
    const text = error instanceof Error ? error.message : 'catalog refresh failed';
    this.logger.warn(redactSecrets(text, secretList(this.config)));
  }
}

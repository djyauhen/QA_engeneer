import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogScheduler } from './catalog.scheduler';
import { CatalogService } from './catalog.service';

@Module({
  controllers: [CatalogController],
  providers: [CatalogService, CatalogScheduler],
  exports: [CatalogService],
})
export class CatalogModule {}

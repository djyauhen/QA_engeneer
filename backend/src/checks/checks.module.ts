import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { CatalogModule } from '../catalog/catalog.module';
import { WorkdirService } from '../files/workdir.service';
import { PreviewService } from '../stand/preview.service';
import { CheckStore } from './check.store';
import { ChecksController } from './checks.controller';
import { ChecksService } from './checks.service';
import { CheckOrchestrator } from './orchestrator';

@Module({
  imports: [CatalogModule, AdminModule],
  controllers: [ChecksController],
  providers: [CheckStore, WorkdirService, PreviewService, CheckOrchestrator, ChecksService],
  exports: [CheckStore, PreviewService, ChecksService],
})
export class ChecksModule {}

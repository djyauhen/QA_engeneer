import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { CatalogQueryService, CostsService, RulesService } from './admin.services';

@Module({
  controllers: [AdminController],
  providers: [RulesService, CostsService, CatalogQueryService],
  exports: [RulesService, CostsService],
})
export class AdminModule {}

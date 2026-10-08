import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { CostsService, RulesService } from './admin.services';

@Module({
  controllers: [AdminController],
  providers: [RulesService, CostsService],
  exports: [RulesService, CostsService],
})
export class AdminModule {}

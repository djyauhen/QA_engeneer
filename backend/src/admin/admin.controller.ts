import { Body, Controller, Get, HttpCode, Put, UseGuards } from '@nestjs/common';
import { SessionGuard, TlGuard } from '../auth/guards';
import { CatalogQueryService, CostsService, RulesService } from './admin.services';

@Controller('admin')
@UseGuards(SessionGuard, TlGuard)
export class AdminController {
  constructor(
    private readonly rules: RulesService,
    private readonly costs: CostsService,
    private readonly catalogQuery: CatalogQueryService,
  ) {}

  @Get('rules')
  getRules() {
    return this.rules.current();
  }

  @Put('rules')
  replaceRules(@Body() body: unknown) {
    return this.rules.replace(body);
  }

  @Get('costs')
  @HttpCode(200)
  getCosts() {
    return this.costs.report();
  }

  @Get('catalog-query')
  getCatalogQuery() {
    return this.catalogQuery.current();
  }

  @Put('catalog-query')
  replaceCatalogQuery(@Body() body: unknown) {
    return this.catalogQuery.replace(body);
  }
}

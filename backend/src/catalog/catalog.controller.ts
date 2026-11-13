import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { SessionGuard, TlGuard } from '../auth/guards';
import { CatalogService } from './catalog.service';

@Controller('catalog')
@UseGuards(SessionGuard)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  list() {
    return this.catalog.screen();
  }

  @Post('refresh')
  @HttpCode(200)
  @UseGuards(TlGuard)
  refresh() {
    return this.catalog.refresh();
  }
}

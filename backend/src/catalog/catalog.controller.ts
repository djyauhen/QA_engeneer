import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../auth/guards';
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
  refresh() {
    return this.catalog.refresh();
  }
}

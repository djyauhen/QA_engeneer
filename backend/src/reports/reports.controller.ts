import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { SessionGuard } from '../auth/guards';
import { SessionUser } from '../config';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(SessionGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  list(@Req() req: Request & { user: SessionUser }) {
    return this.reports.list(req.user);
  }

  @Get(':reportId/previous')
  previous(@Req() req: Request & { user: SessionUser }, @Param('reportId') reportId: string) {
    return this.reports.previous(req.user, reportId);
  }

  @Get(':reportId')
  get(@Req() req: Request & { user: SessionUser }, @Param('reportId') reportId: string) {
    return this.reports.get(req.user, reportId);
  }
}

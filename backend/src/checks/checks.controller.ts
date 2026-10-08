import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { SessionGuard } from '../auth/guards';
import { SessionUser } from '../config';
import { ChecksService } from './checks.service';

@Controller('checks')
@UseGuards(SessionGuard)
export class ChecksController {
  constructor(private readonly checks: ChecksService) {}

  @Post()
  @HttpCode(201)
  start(@Req() req: Request & { user: SessionUser }, @Body() body: unknown) {
    return this.checks.start(req.user, body);
  }

  @Get(':checkId')
  get(@Req() req: Request & { user: SessionUser }, @Param('checkId') checkId: string) {
    return this.checks.view(req.user, checkId);
  }

  @Post(':checkId/ai-decision')
  @HttpCode(200)
  decide(
    @Req() req: Request & { user: SessionUser },
    @Param('checkId') checkId: string,
    @Body() body: unknown,
  ) {
    return this.checks.decide(req.user, checkId, body);
  }

  @Post(':checkId/stand-actions')
  @HttpCode(200)
  stand(
    @Req() req: Request & { user: SessionUser },
    @Param('checkId') checkId: string,
    @Body() body: unknown,
  ) {
    return this.checks.allowStand(req.user, checkId, body);
  }
}

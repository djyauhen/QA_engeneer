import { Global, Module } from '@nestjs/common';
import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { SessionGuard, TlGuard } from '../auth/guards';
import { AiProfilesService } from './ai-profiles.service';
import { GROK_PROBE, realGrokProbe } from './ai-profile';
import { GrokLoginService } from './grok.login';

@Controller()
@UseGuards(SessionGuard)
export class AiProfileController {
  constructor(
    private readonly profiles: AiProfilesService,
    private readonly grok: GrokLoginService,
  ) {}

  @Get('ai/profiles')
  list() {
    return { profiles: this.profiles.list() };
  }

  @Get('admin/grok')
  @UseGuards(TlGuard)
  status() {
    return this.grok.status();
  }

  @Post('admin/grok/login')
  @HttpCode(200)
  @UseGuards(TlGuard)
  login() {
    return this.grok.begin();
  }

  @Post('admin/grok/logout')
  @HttpCode(200)
  @UseGuards(TlGuard)
  logout() {
    return this.grok.logout();
  }
}

@Global()
@Module({
  controllers: [AiProfileController],
  providers: [
    AiProfilesService,
    GrokLoginService,
    { provide: GROK_PROBE, useFactory: () => realGrokProbe() },
  ],
  exports: [AiProfilesService, GrokLoginService, GROK_PROBE],
})
export class AiProfilesModule {}

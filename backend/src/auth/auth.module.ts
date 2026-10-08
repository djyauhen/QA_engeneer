import { Global, Module } from '@nestjs/common';
import { AuthService, SessionService } from './auth.service';
import { SessionGuard, TlGuard } from './guards';
import { SessionController } from './session.controller';

@Global()
@Module({
  controllers: [SessionController],
  providers: [AuthService, SessionService, SessionGuard, TlGuard],
  exports: [AuthService, SessionService, SessionGuard, TlGuard],
})
export class AuthModule {}

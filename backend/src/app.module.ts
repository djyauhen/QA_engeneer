import { DynamicModule, Module } from '@nestjs/common';
import { AiProfilesModule } from './ai/ai-profiles.module';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { ChecksModule } from './checks/checks.module';
import { AioModule } from './aio/aio.module';
import { HealthModule } from './health/health.module';
import { ReportsModule } from './reports/reports.module';
import { Runtime, RuntimeModule } from './runtime.module';
import { UsersModule } from './users/users.module';

@Module({})
export class AppModule {
  static register(runtime: Runtime): DynamicModule {
    return {
      module: AppModule,
      imports: [
        RuntimeModule.register(runtime),
        AiProfilesModule,
        AuthModule,
        HealthModule,
        UsersModule,
        AioModule,
        CatalogModule,
        AdminModule,
        ChecksModule,
        ReportsModule,
      ],
    };
  }
}

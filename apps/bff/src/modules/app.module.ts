import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from '../common/configuration.js';
import { PrismaModule } from '../infrastructure/prisma/prisma.module.js';
import { AccountsModule } from './accounts/accounts.module.js';
import { HealthModule } from './health/health.module.js';
import { MediaModule } from './media/media.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { MetricsModule } from './metrics/metrics.module.js';
import { StakingModule } from './staking/staking.module.js';
import { DirectoryModule } from './directory/directory.module.js';
import { AuthSessionModule } from './auth-session/auth-session.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      // Support both root-level and app-level env files to reduce duplication.
      // Precedence: later entries override earlier ones -> prefer repository root .env.local
      envFilePath: ['apps/bff/.env', '.env', '.env.local', '../../.env', '../../.env.local']
    }),
    PrismaModule,
    HealthModule,
    AccountsModule,
    MediaModule,
    MetricsModule,
    OrdersModule,
    StakingModule,
    DirectoryModule,
    AuthSessionModule
  ]
})
export class AppModule {}

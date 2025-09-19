import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from '../common/configuration.js';
import { PrismaModule } from '../infrastructure/prisma/prisma.module.js';
import { AccountsModule } from './accounts/accounts.module.js';
import { HealthModule } from './health/health.module.js';
import { MediaModule } from './media/media.module.js';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, load: [configuration] }), PrismaModule, HealthModule, AccountsModule, MediaModule]
})
export class AppModule {}

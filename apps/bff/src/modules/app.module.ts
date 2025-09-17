import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from '../common/configuration';
import { PrismaModule } from '../infrastructure/prisma/prisma.module';
import { AccountsModule } from './accounts/accounts.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, load: [configuration] }), PrismaModule, HealthModule, AccountsModule]
})
export class AppModule {}

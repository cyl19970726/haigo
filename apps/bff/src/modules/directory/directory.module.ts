import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { MetricsModule } from '../metrics/metrics.module.js';
import { DirectoryController } from './directory.controller.js';
import { DirectoryService } from './directory.service.js';
import { DirectoryRepository } from './directory.repository.js';
import { HasuraClient } from './hasura.client.js';
import { StakingModule } from '../staking/staking.module.js';

@Module({
  imports: [ConfigModule, PrismaModule, MetricsModule, StakingModule],
  controllers: [DirectoryController],
  providers: [DirectoryRepository, DirectoryService, HasuraClient],
  exports: [DirectoryService]
})
export class DirectoryModule {}

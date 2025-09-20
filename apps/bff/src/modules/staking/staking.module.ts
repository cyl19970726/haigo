import { Module } from '@nestjs/common';
import { StakingRepository } from './staking.repository.js';
import { StakingService } from './staking.service.js';
import { StakingController } from './staking.controller.js';
import { StakingListener } from './staking.listener.js';
import { MetricsModule } from '../metrics/metrics.module.js';

@Module({
  imports: [MetricsModule],
  providers: [StakingRepository, StakingService, StakingListener],
  controllers: [StakingController],
  exports: [StakingRepository, StakingService]
})
export class StakingModule {}


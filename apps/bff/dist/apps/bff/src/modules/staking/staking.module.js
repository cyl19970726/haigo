var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from '@nestjs/common';
import { StakingRepository } from './staking.repository.js';
import { StakingService } from './staking.service.js';
import { StakingController } from './staking.controller.js';
import { StakingListener } from './staking.listener.js';
import { MetricsModule } from '../metrics/metrics.module.js';
let StakingModule = class StakingModule {
};
StakingModule = __decorate([
    Module({
        imports: [MetricsModule],
        providers: [StakingRepository, StakingService, StakingListener],
        controllers: [StakingController],
        exports: [StakingRepository, StakingService]
    })
], StakingModule);
export { StakingModule };

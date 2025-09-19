var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var StakingService_1;
import { Injectable, Logger } from '@nestjs/common';
import { StakingRepository } from './staking.repository.js';
import { ConfigService } from '@nestjs/config';
import { APTOS_MODULE_ADDRESS } from '@haigo/shared/config/aptos';
let StakingService = StakingService_1 = class StakingService {
    constructor(repo, config) {
        this.repo = repo;
        this.config = config;
        this.logger = new Logger(StakingService_1.name);
        this.nodeApiUrl = this.config.get('nodeApiUrl', 'https://api.testnet.aptoslabs.com/v1');
        this.aptosApiKey = this.config.get('aptosApiKey', '');
        const envModule = process.env.NEXT_PUBLIC_APTOS_MODULE || this.config.get('NEXT_PUBLIC_APTOS_MODULE');
        this.moduleAddress = (envModule && envModule.trim()) || APTOS_MODULE_ADDRESS;
    }
    async callView(functionName, args) {
        try {
            const base = (this.nodeApiUrl || '').replace(/\/$/, '');
            const headers = { 'content-type': 'application/json' };
            if (this.aptosApiKey) {
                headers['x-aptos-api-key'] = this.aptosApiKey;
                headers['authorization'] = `Bearer ${this.aptosApiKey}`;
            }
            const res = await fetch(`${base}/view`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ function: functionName, type_arguments: [], arguments: args })
            });
            if (!res.ok) {
                const text = await res.text();
                this.logger.warn(`View call ${functionName} failed: ${res.status} ${text}`);
                return null;
            }
            const json = (await res.json());
            return Array.isArray(json) ? json : null;
        }
        catch (e) {
            this.logger.warn(`View call ${functionName} error: ${e instanceof Error ? e.message : String(e)}`);
            return null;
        }
    }
    async getIntent(warehouseAddress) {
        // 1) On-chain views
        const getStakeFn = `${this.moduleAddress}::staking::get_stake`;
        const getFeeFn = `${this.moduleAddress}::staking::get_storage_fee`;
        const [stakeRes, feeRes] = await Promise.all([
            this.callView(getStakeFn, [warehouseAddress]),
            this.callView(getFeeFn, [warehouseAddress])
        ]);
        if (stakeRes && feeRes && stakeRes.length > 0 && feeRes.length > 0) {
            const stakedAmount = String(stakeRes[0]);
            const feePerUnit = Number(feeRes[0]) || 0;
            const dto = { warehouseAddress, stakedAmount, minRequired: '0', feePerUnit };
            return { data: dto, meta: { source: 'onchain' } };
        }
        // 2) Fallback to cache
        const cached = await this.repo.readIntent(warehouseAddress);
        if (!cached)
            return null;
        const dto = {
            warehouseAddress,
            stakedAmount: String(cached.stakedAmount ?? 0n),
            minRequired: '0',
            feePerUnit: cached.feePerUnit ?? 0
        };
        return { data: dto, meta: { source: 'cache' } };
    }
};
StakingService = StakingService_1 = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [StakingRepository, ConfigService])
], StakingService);
export { StakingService };

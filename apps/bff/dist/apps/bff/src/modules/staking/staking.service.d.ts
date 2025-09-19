import type { StakingIntentDto } from '@haigo/shared/dto/staking';
import { StakingRepository } from './staking.repository.js';
import { ConfigService } from '@nestjs/config';
export declare class StakingService {
    private readonly repo;
    private readonly config;
    private readonly logger;
    private readonly nodeApiUrl;
    private readonly aptosApiKey;
    private readonly moduleAddress;
    constructor(repo: StakingRepository, config: ConfigService);
    private callView;
    getIntent(warehouseAddress: string): Promise<{
        data: StakingIntentDto;
        meta: {
            source: 'onchain' | 'cache';
        };
    } | null>;
}

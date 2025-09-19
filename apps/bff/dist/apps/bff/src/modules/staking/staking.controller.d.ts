import { StakingService } from './staking.service.js';
export declare class StakingController {
    private readonly service;
    constructor(service: StakingService);
    getOwnIntent(): Promise<void>;
    getIntent(warehouseAddress: string): Promise<{
        data: import("@haigo/shared/dto/staking").StakingIntentDto;
        meta: {
            source: "onchain" | "cache";
        };
    }>;
}

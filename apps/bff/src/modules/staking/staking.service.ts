import { Injectable, Logger } from '@nestjs/common';
import type { StakingIntentDto } from '@haigo/shared/dto/staking';
import { StakingRepository } from './staking.repository.js';
import { ConfigService } from '@nestjs/config';
import { APTOS_MODULE_ADDRESS } from '@haigo/shared/config/aptos';

@Injectable()
export class StakingService {
  private readonly logger = new Logger(StakingService.name);
  private readonly nodeApiUrl: string;
  private readonly aptosApiKey: string;
  private readonly moduleAddress: string;

  constructor(private readonly repo: StakingRepository, private readonly config: ConfigService) {
    this.nodeApiUrl = this.config.get<string>('nodeApiUrl', 'https://api.testnet.aptoslabs.com/v1');
    this.aptosApiKey = this.config.get<string>('aptosApiKey', '');
    const envModule = process.env.NEXT_PUBLIC_APTOS_MODULE || this.config.get<string>('NEXT_PUBLIC_APTOS_MODULE');
    this.moduleAddress = (envModule && envModule.trim()) || APTOS_MODULE_ADDRESS;
  }

  private async callView<T = any>(functionName: string, args: unknown[]): Promise<T[] | null> {
    try {
      const base = (this.nodeApiUrl || '').replace(/\/$/, '');
      const headers: Record<string, string> = { 'content-type': 'application/json' };
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
      const json = (await res.json()) as T[];
      return Array.isArray(json) ? json : null;
    } catch (e) {
      this.logger.warn(`View call ${functionName} error: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  async getIntent(warehouseAddress: string): Promise<{ data: StakingIntentDto; meta: { source: 'onchain' | 'cache' } } | null> {
    // 1) On-chain views
    const getStakeFn = `${this.moduleAddress}::staking::get_stake`;
    const getFeeFn = `${this.moduleAddress}::staking::get_storage_fee`;
    const [stakeRes, feeRes] = await Promise.all([
      this.callView<string>(getStakeFn, [warehouseAddress]),
      this.callView<string>(getFeeFn, [warehouseAddress])
    ]);
    if (stakeRes && feeRes && stakeRes.length > 0 && feeRes.length > 0) {
      const stakedAmount = String(stakeRes[0] as unknown as string | number | bigint);
      const feePerUnit = Number(feeRes[0] as unknown as string | number | bigint) || 0;
      const dto: StakingIntentDto = { warehouseAddress, stakedAmount, minRequired: '0', feePerUnit };
      return { data: dto, meta: { source: 'onchain' } };
    }

    // 2) Fallback to cache
    const cached = await this.repo.readIntent(warehouseAddress);
    if (!cached) return null;
    const dto: StakingIntentDto = {
      warehouseAddress,
      stakedAmount: String(cached.stakedAmount ?? 0n),
      minRequired: '0',
      feePerUnit: cached.feePerUnit ?? 0
    };
    return { data: dto, meta: { source: 'cache' } };
  }
}

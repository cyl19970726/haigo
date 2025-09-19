import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { StakingService } from './staking.service.js';

@Controller('/api/staking')
export class StakingController {
  constructor(private readonly service: StakingService) {}

  @Get('/intent')
  async getOwnIntent() {
    // 在 PoC 阶段，要求客户端传递地址；如需“当前用户”语义，可从 auth 中提取
    throw new NotFoundException('Address is required: use /api/staking/:warehouseAddress');
  }

  @Get('/:warehouseAddress')
  async getIntent(@Param('warehouseAddress') warehouseAddress: string) {
    const result = await this.service.getIntent(warehouseAddress);
    if (!result) throw new NotFoundException('Staking intent not found');
    return { data: result.data, meta: { source: result.meta.source } };
  }
}


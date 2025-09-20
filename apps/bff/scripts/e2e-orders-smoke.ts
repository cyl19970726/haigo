import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service.js';
import { OrdersController } from '../src/modules/orders/orders.controller.js';
import { OrdersService } from '../src/modules/orders/orders.service.js';
import { OrdersRepository } from '../src/modules/orders/orders.repository.js';

async function main() {
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true })],
    controllers: [OrdersController],
    providers: [OrdersService, OrdersRepository, PrismaService]
  }).compile();

  const controller = moduleRef.get(OrdersController);
  const repo = moduleRef.get(OrdersRepository);

  const draft = await controller.createDraft({
    sellerAddress: '0x1',
    warehouseAddress: '0x2',
    inboundLogistics: 'TRACK-E2E',
    pricing: { amountSubunits: 100, insuranceFeeSubunits: 10, platformFeeSubunits: 5, currency: 'APT' },
    initialMedia: null
  } as any);
  // Simulate OrderCreated event ingestion
  await repo.upsertOnchainCreated({
    txnVersion: BigInt(99999),
    eventIndex: BigInt(0),
    txnHash: '0xsmokee2e',
    chainTimestamp: new Date(),
    orderId: 123,
    seller: '0x1',
    warehouse: '0x2',
    logisticsInbound: 'TRACK-E2E',
    pricing: { amount: 100, insuranceFee: 10, platformFee: 5, total: 115 }
  });

  const list = await controller.list();
  const detail = await controller.detail(`order-123-smokee2e`);

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ draft, listCount: list.length, detailRecordUid: detail.recordUid }, null, 2));
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});


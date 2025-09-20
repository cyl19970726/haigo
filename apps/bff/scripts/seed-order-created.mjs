import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const recordUid = process.argv[2] || 'order-123-smoke';
  const seller = '0x1';
  const warehouse = '0x2';
  const now = new Date();
  const txnVersion = BigInt(777777);
  const eventIndex = BigInt(0);
  const txnHash = '0xsmokeseed';

  await prisma.order.upsert({
    where: { recordUid },
    create: {
      recordUid,
      creatorAddress: seller,
      warehouseAddress: warehouse,
      status: 'ONCHAIN_CREATED',
      orderId: 123,
      txnVersion,
      eventIndex,
      txnHash,
      chainTimestamp: now
    },
    update: {
      status: 'ONCHAIN_CREATED',
      orderId: 123,
      txnVersion,
      eventIndex,
      txnHash,
      chainTimestamp: now
    }
  })

  await prisma.orderEvent.upsert({
    where: { txnVersion_eventIndex: { txnVersion, eventIndex } },
    create: {
      recordUid,
      orderId: 123,
      type: 'OrderCreated',
      txnVersion,
      eventIndex,
      txnHash,
      chainTimestamp: now,
      data: { pricing: { amount: 100, insuranceFee: 10, platformFee: 5, total: 115 }, logistics_inbound: 'TRACK-SMOKE' }
    },
    update: {}
  })

  console.log('Seeded', recordUid)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(async () => { await prisma.$disconnect() })

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { MetricsModule } from '../metrics/metrics.module.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { OrdersRepository } from './orders.repository.js';
import { OrdersEventListener } from './orders-event-listener.service.js';

@Module({
  imports: [ConfigModule, PrismaModule, MetricsModule],
  controllers: [OrdersController],
  providers: [OrdersRepository, OrdersService, OrdersEventListener],
  exports: [OrdersService]
})
export class OrdersModule {}

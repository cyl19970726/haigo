import { Module } from '@nestjs/common';
import { AccountsRepository } from './accounts.repository.js';
import { AccountsEventListener } from './event-listener.service.js';
import { AccountsService } from './accounts.service.js';
import { AccountsController } from './accounts.controller.js';

@Module({
  providers: [AccountsRepository, AccountsEventListener, AccountsService],
  controllers: [AccountsController],
  exports: [AccountsRepository, AccountsService]
})
export class AccountsModule {}

import { Module } from '@nestjs/common';
import { AccountsRepository } from './accounts.repository';
import { AccountsEventListener } from './event-listener.service';
import { AccountsService } from './accounts.service';
import { AccountsController } from './accounts.controller';

@Module({
  providers: [AccountsRepository, AccountsEventListener, AccountsService],
  controllers: [AccountsController],
  exports: [AccountsRepository, AccountsService]
})
export class AccountsModule {}

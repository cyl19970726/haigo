import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import { AuthSessionService } from './auth-session.service.js';
import { AuthSessionController } from './auth-session.controller.js';

@Module({
  imports: [AccountsModule],
  providers: [AuthSessionService],
  controllers: [AuthSessionController],
  exports: [AuthSessionService]
})
export class AuthSessionModule {}

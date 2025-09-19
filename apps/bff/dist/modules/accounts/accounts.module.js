var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from '@nestjs/common';
import { AccountsRepository } from './accounts.repository.js';
import { AccountsEventListener } from './event-listener.service.js';
import { AccountsService } from './accounts.service.js';
import { AccountsController } from './accounts.controller.js';
let AccountsModule = class AccountsModule {
};
AccountsModule = __decorate([
    Module({
        providers: [AccountsRepository, AccountsEventListener, AccountsService],
        controllers: [AccountsController],
        exports: [AccountsRepository, AccountsService]
    })
], AccountsModule);
export { AccountsModule };

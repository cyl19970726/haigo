var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from '../common/configuration.js';
import { PrismaModule } from '../infrastructure/prisma/prisma.module.js';
import { AccountsModule } from './accounts/accounts.module.js';
import { HealthModule } from './health/health.module.js';
import { MediaModule } from './media/media.module.js';
let AppModule = class AppModule {
};
AppModule = __decorate([
    Module({
        imports: [ConfigModule.forRoot({ isGlobal: true, load: [configuration] }), PrismaModule, HealthModule, AccountsModule, MediaModule]
    })
], AppModule);
export { AppModule };

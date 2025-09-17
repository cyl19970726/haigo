import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly configService: ConfigService) {
    const databaseUrl =
      configService.get<string>('database.url') ?? process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/haigo';
    super({
      datasources: {
        db: {
          url: databaseUrl
        }
      },
      log: ['error', 'warn']
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

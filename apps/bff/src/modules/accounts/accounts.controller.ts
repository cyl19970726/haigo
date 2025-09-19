import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
  Res,
  Req
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { memoryStorage } from 'multer';
import { AccountsService } from './accounts.service.js';
import type { Express } from 'express';

interface ResponseMeta {
  requestId: string;
  timestamp: string;
}

@Controller('api/accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get(':address')
  async getAccountProfile(@Param('address') address: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { requestId, timestamp, traceId } = this.createResponseMeta(req);
    res.setHeader('x-haigo-trace-id', traceId);

    const profile = await this.accountsService.getAccountProfile(address);

    return {
      data: profile,
      meta: this.buildMeta(requestId, timestamp)
    };
  }

  @Post(':address/verify-hash')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        fileSize: 15 * 1024 * 1024
      }
    })
  )
  async verifyAccountHash(
    @Param('address') address: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    if (!file) {
      throw new BadRequestException('Verification file is required');
    }

    const { requestId, timestamp, traceId } = this.createResponseMeta(req);
    res.setHeader('x-haigo-trace-id', traceId);

    const result = await this.accountsService.verifyProfileHash(address, file);

    return {
      data: {
        address: address.toLowerCase(),
        verified: result.verified,
        computedHash: result.computedHash,
        storedHash: result.storedHash,
        checkedAt: new Date().toISOString()
      },
      meta: this.buildMeta(requestId, timestamp)
    };
  }

  private createResponseMeta(req: Request): { requestId: string; timestamp: string; traceId: string } {
    const requestId = randomUUID();
    const timestamp = new Date().toISOString();
    const traceId = (req.headers['x-haigo-trace-id'] as string) || requestId;
    return { requestId, timestamp, traceId };
  }

  private buildMeta(requestId: string, timestamp: string): ResponseMeta {
    return {
      requestId,
      timestamp
    };
  }
}

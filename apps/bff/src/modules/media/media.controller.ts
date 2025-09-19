import { Body, Controller, Post, Req, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { MediaService } from './media.service.js';
import type { RawUploadMediaBody } from './dto/upload-media.dto.js';

interface UploadFilesPayload {
  file?: Express.Multer.File[];
  media?: Express.Multer.File[];
}

interface ResponseMeta {
  requestId: string;
  timestamp: string;
}

@Controller('api/media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('uploads')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'file', maxCount: 1 },
        { name: 'media', maxCount: 1 }
      ],
      {
        storage: memoryStorage(),
        limits: {
          fileSize: 200 * 1024 * 1024
        }
      }
    )
  )
  async uploadMedia(
    @UploadedFiles() files: UploadFilesPayload,
    @Body() body: RawUploadMediaBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    const { requestId, timestamp, traceId } = this.createResponseMeta(req);
    res.setHeader('x-haigo-trace-id', traceId);

    const file = files.file?.[0] ?? files.media?.[0];
    const asset = await this.mediaService.handleUpload(file, body);

    res.status(201);
    return {
      data: asset,
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

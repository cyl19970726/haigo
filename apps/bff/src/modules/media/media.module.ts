import { Module } from '@nestjs/common';
import { MediaController } from './media.controller.js';
import { MediaService } from './media.service.js';
import { MediaStorageService } from './media.storage.js';
import { MediaRepository } from './media.repository.js';

@Module({
  controllers: [MediaController],
  providers: [MediaService, MediaStorageService, MediaRepository]
})
export class MediaModule {}

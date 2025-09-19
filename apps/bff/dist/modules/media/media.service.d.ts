import type { OrderMediaAsset } from '@haigo/shared/dto/orders';
import { RawUploadMediaBody } from './dto/upload-media.dto.js';
import { MediaRepository } from './media.repository.js';
import { MediaStorageService } from './media.storage.js';
export declare class MediaService {
    private readonly storage;
    private readonly repository;
    constructor(storage: MediaStorageService, repository: MediaRepository);
    handleUpload(file: Express.Multer.File | undefined, rawBody: RawUploadMediaBody): Promise<OrderMediaAsset & {
        recordUid: string;
        path: string;
        hash: {
            algo: string;
            value: string;
        };
    }>;
    private normalizeBody;
    private normalizeStage;
    private normalizeHashAlgorithm;
    private computeBlake3;
    private normalizeHash;
    private assertFileAllowed;
    private resolveCategory;
}

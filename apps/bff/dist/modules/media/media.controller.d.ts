import type { Request, Response } from 'express';
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
export declare class MediaController {
    private readonly mediaService;
    constructor(mediaService: MediaService);
    uploadMedia(files: UploadFilesPayload, body: RawUploadMediaBody, req: Request, res: Response): Promise<{
        data: any;
        meta: ResponseMeta;
    }>;
    private createResponseMeta;
    private buildMeta;
}
export {};

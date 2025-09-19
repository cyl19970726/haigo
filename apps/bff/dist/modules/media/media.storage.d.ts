/// <reference types="node" resolution-mode="require"/>
import { ConfigService } from '@nestjs/config';
interface SaveMediaOptions {
    buffer: Buffer;
    originalName: string;
    mimeType: string;
    recordUid: string;
    stage?: string;
    category?: string;
}
export interface StoredMediaObject {
    absolutePath: string;
    storagePath: string;
    publicPath: string;
    filename: string;
}
export declare class MediaStorageService {
    private readonly configService;
    private readonly logger;
    private readonly storageRoot;
    private readonly publicPrefix;
    constructor(configService: ConfigService);
    save(options: SaveMediaOptions): Promise<StoredMediaObject>;
    private sanitizeSegment;
    private resolveExtension;
    private buildPublicPath;
    private ensureLeadingSlash;
}
export {};

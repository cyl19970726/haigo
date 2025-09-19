import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
export interface CreateMediaAssetInput {
    recordUid: string;
    stage: string;
    category: string;
    storagePath: string;
    publicPath?: string;
    hashAlgo: string;
    hashValue: string;
    mimeType?: string;
    sizeBytes?: number;
    uploadedBy?: string;
    uploadedAt: Date;
}
export declare class MediaRepository {
    private readonly prisma;
    constructor(prisma: PrismaService);
    recordUpload(input: CreateMediaAssetInput): Promise<void>;
}

import { Request, Response } from 'express';
import { AccountsService } from './accounts.service.js';
interface ResponseMeta {
    requestId: string;
    timestamp: string;
}
export declare class AccountsController {
    private readonly accountsService;
    constructor(accountsService: AccountsService);
    getAccountProfile(address: string, req: Request, res: Response): Promise<{
        data: import("@haigo/shared/dto/registry").AccountProfile;
        meta: ResponseMeta;
    }>;
    verifyAccountHash(address: string, file: Express.Multer.File, req: Request, res: Response): Promise<{
        data: {
            address: string;
            verified: boolean;
            computedHash: string;
            storedHash: string;
            checkedAt: string;
        };
        meta: ResponseMeta;
    }>;
    private createResponseMeta;
    private buildMeta;
}
export {};

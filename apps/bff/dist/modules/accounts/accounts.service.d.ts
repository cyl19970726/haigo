import { ConfigService } from '@nestjs/config';
import { AccountProfile } from '@haigo/shared/dto/registry';
import { AccountsRepository } from './accounts.repository.js';
export declare class AccountsService {
    private readonly accountsRepository;
    private readonly configService;
    private readonly logger;
    private readonly hasuraUrl;
    constructor(accountsRepository: AccountsRepository, configService: ConfigService);
    getAccountProfile(address: string): Promise<AccountProfile>;
    verifyProfileHash(address: string, file: Express.Multer.File): Promise<{
        verified: boolean;
        computedHash: string;
        storedHash: string;
    }>;
    private fetchOrderCount;
    private hasuraGraphqlUrl;
    private normalizeAddress;
    private toLiteralRole;
    private stringifyError;
}

import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Ed25519PublicKey, Ed25519Signature } from '@aptos-labs/ts-sdk';
import type { AccountProfile } from '@haigo/shared/dto/registry';
import { AccountsService } from '../accounts/accounts.service.js';

interface ChallengeEntry {
  nonce: string;
  expiresAt: number;
}

interface SessionEntry {
  address: string;
  expiresAt: number;
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

@Injectable()
export class AuthSessionService {
  private readonly logger = new Logger(AuthSessionService.name);
  private readonly challenges = new Map<string, ChallengeEntry>();
  private readonly sessions = new Map<string, SessionEntry>();

  constructor(private readonly accountsService: AccountsService) {}

  createChallenge(address: string): { address: string; nonce: string; message: string } {
    const normalizedAddress = this.normalizeAddress(address);
    if (!normalizedAddress) {
      throw new BadRequestException('Invalid account address');
    }

    const nonce = randomUUID();
    const expiresAt = Date.now() + CHALLENGE_TTL_MS;
    this.challenges.set(normalizedAddress, { nonce, expiresAt });

    return {
      address: normalizedAddress,
      nonce,
      message: this.buildChallengeMessage(nonce)
    };
  }

  async verifyChallenge(params: {
    address: string;
    publicKey: string;
    signature: string;
    fullMessage?: string;
  }): Promise<{ sessionId: string; profile: AccountProfile }> {
    const normalizedAddress = this.normalizeAddress(params.address);
    if (!normalizedAddress) {
      throw new BadRequestException('Invalid account address');
    }

    const challenge = this.challenges.get(normalizedAddress);
    if (!challenge) {
      throw new UnauthorizedException('Challenge not found or expired');
    }
    if (challenge.expiresAt <= Date.now()) {
      this.challenges.delete(normalizedAddress);
      throw new UnauthorizedException('Challenge expired');
    }

    // 按 Aptos SignMessage 规范校验：钱包会对结构化消息进行签名
    // 我们组装与前端请求相同的 payload 并进行验证
    const signedMessagePayload = params.fullMessage
      ? params.fullMessage
      : this.buildSignedMessagePayload({
          message: this.buildChallengeMessage(challenge.nonce),
          nonce: challenge.nonce
        });
    this.verifySignature({
      expectedAddress: normalizedAddress,
      publicKey: params.publicKey,
      signature: params.signature,
      message: signedMessagePayload
    });

    const profile = await this.accountsService.getAccountProfile(normalizedAddress);

    const sessionId = randomUUID();
    this.sessions.set(sessionId, {
      address: normalizedAddress,
      expiresAt: Date.now() + SESSION_TTL_MS
    });

    this.challenges.delete(normalizedAddress);

    return { sessionId, profile };
  }

  async getProfileForSession(sessionId: string): Promise<AccountProfile | null> {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt <= Date.now()) {
      this.sessions.delete(sessionId);
      return null;
    }

    try {
      return await this.accountsService.getAccountProfile(entry.address);
    } catch (error) {
      this.logger.warn(`Failed to load profile for session ${sessionId}: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  destroySession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  private verifySignature(args: {
    expectedAddress: string;
    publicKey: string;
    signature: string;
    message: string;
  }): void {
    const { expectedAddress, publicKey, signature, message } = args;

    try {
      const pubKey = new Ed25519PublicKey(publicKey);
      const derivedAddress = pubKey.authKey().derivedAddress().toString().toLowerCase();
      if (derivedAddress !== expectedAddress) {
        throw new UnauthorizedException('Public key does not match address');
      }

      const signatureInstance = new Ed25519Signature(signature);
      const messageBytes = new TextEncoder().encode(message);
      const isValid = pubKey.verifySignature({ message: messageBytes, signature: signatureInstance });
      if (!isValid) {
        throw new UnauthorizedException('Invalid signature for challenge');
      }
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.warn(`Signature verification failed: ${error instanceof Error ? error.message : error}`);
      throw new UnauthorizedException('Unable to verify signature');
    }
  }

  private buildChallengeMessage(nonce: string): string {
    return `HaiGo login challenge: ${nonce}`;
  }

  /**
   * 生成与钱包 signMessage 一致的签名消息：
   * AIP-63/Aptos Signed Message 规范要求签名原文包含固定前缀与 JSON 结构。
   * 参考 wallet-adapter 的 signMessage 行为：始终包含 message 与 nonce，address/application/chainId 由前端关闭。
   */
  private buildSignedMessagePayload(params: { message: string; nonce: string }): string {
    // 前缀来自 Aptos 钱包消息签名规范
    const prefix = 'APTOS';
    const payload = {
      message: params.message,
      nonce: params.nonce
    };
    // 与钱包一致：多行文本：第一行固定前缀，随后是 JSON 串
    return `${prefix}\n${JSON.stringify(payload)}`;
  }

  private normalizeAddress(address: string | undefined): string {
    if (!address) {
      return '';
    }
    const normalized = address.toLowerCase();
    return /^0x[a-f0-9]{1,64}$/.test(normalized) ? normalized : '';
  }
}

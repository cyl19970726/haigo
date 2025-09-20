import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthSessionService } from './auth-session.service.js';

const SESSION_COOKIE_NAME = 'haigo_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60; // 1 hour

interface ChallengeRequestBody {
  address: string;
}

interface VerifyRequestBody {
  address: string;
  publicKey: string;
  signature: string;
  fullMessage?: string;
}

@Controller('api/session')
export class AuthSessionController {
  constructor(private readonly authSessionService: AuthSessionService) {}

  @Post('challenge')
  createChallenge(@Body() body: ChallengeRequestBody) {
    const challenge = this.authSessionService.createChallenge(body.address);
    return { data: challenge };
  }

  @Post('verify')
  async verifySession(@Body() body: VerifyRequestBody, @Res({ passthrough: true }) res: Response) {
    const { sessionId, profile } = await this.authSessionService.verifyChallenge(body);
    this.setSessionCookie(res, sessionId);
    return { data: profile, sessionId };
  }

  @Get('profile')
  async getProfile(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const sessionId = this.extractSessionId(req);
    if (!sessionId) {
      res.status(401);
      return { data: null };
    }

    const profile = await this.authSessionService.getProfileForSession(sessionId);
    if (!profile) {
      this.clearSessionCookie(res);
      res.status(401);
      return { data: null };
    }

    return { data: profile };
  }

  @Post('logout')
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const sessionId = this.extractSessionId(req);
    if (sessionId) {
      this.authSessionService.destroySession(sessionId);
    }
    this.clearSessionCookie(res);
    return { data: true };
  }

  private extractSessionId(req: Request): string | null {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) {
      return null;
    }

    const cookies = cookieHeader.split(';').map((part) => part.trim());
    const sessionEntry = cookies.find((entry) => entry.startsWith(`${SESSION_COOKIE_NAME}=`));
    if (!sessionEntry) {
      return null;
    }

    const value = sessionEntry.substring(SESSION_COOKIE_NAME.length + 1);
    return value ? decodeURIComponent(value) : null;
  }

  private setSessionCookie(res: Response, sessionId: string) {
    const secureFlag = process.env.NODE_ENV === 'production' ? ' Secure;' : '';
    const cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax;${secureFlag} Max-Age=${SESSION_MAX_AGE_SECONDS}`;
    res.setHeader('Set-Cookie', cookie);
  }

  private clearSessionCookie(res: Response) {
    const secureFlag = process.env.NODE_ENV === 'production' ? ' Secure;' : '';
    const cookie = `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax;${secureFlag} Max-Age=0`;
    res.setHeader('Set-Cookie', cookie);
  }
}

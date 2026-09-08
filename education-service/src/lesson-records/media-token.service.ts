import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

export type LessonRecordMediaTokenPayload = {
  lessonUuid: string;
  recordUuid: string;
  scope: 'playback';
  userId: string;
  exp: number;
};

const MAX_TTL_SECONDS = 3600;

function b64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromB64url(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function parsePayload(encoded: string): LessonRecordMediaTokenPayload {
  try {
    const payload = JSON.parse(fromB64url(encoded)) as Partial<LessonRecordMediaTokenPayload>;
    if (
      !payload ||
      typeof payload.lessonUuid !== 'string' ||
      typeof payload.recordUuid !== 'string' ||
      payload.scope !== 'playback' ||
      typeof payload.userId !== 'string' ||
      typeof payload.exp !== 'number'
    ) {
      throw new Error('invalid payload shape');
    }
    return payload as LessonRecordMediaTokenPayload;
  } catch {
    throw new UnauthorizedException('Invalid media token');
  }
}

@Injectable()
export class LessonRecordMediaTokenService {
  private secret(): string {
    return process.env.LESSON_RECORD_MEDIA_TOKEN_SECRET || '';
  }

  sign(input: Omit<LessonRecordMediaTokenPayload, 'exp'>, ttlSeconds = MAX_TTL_SECONDS): {
    token: string;
    expiresAt: string;
    expiresIn: number;
  } {
    const secret = this.secret();
    if (!secret) {
      throw new BadRequestException('Media token secret is not configured');
    }
    const expiresIn = Math.max(1, Math.min(MAX_TTL_SECONDS, Math.floor(ttlSeconds)));
    const payload: LessonRecordMediaTokenPayload = {
      ...input,
      exp: Math.floor(Date.now() / 1000) + expiresIn,
    };
    const encoded = b64url(JSON.stringify(payload));
    const sig = b64url(createHmac('sha256', secret).update(encoded).digest());
    return {
      token: `${encoded}.${sig}`,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
      expiresIn,
    };
  }

  verify(token: string, lessonUuid: string, scope: 'playback'): LessonRecordMediaTokenPayload {
    const secret = this.secret();
    if (!secret) {
      throw new UnauthorizedException('Media token secret is not configured');
    }
    const [encoded, sig] = token.split('.');
    if (!encoded || !sig) {
      throw new UnauthorizedException('Invalid media token');
    }
    const expected = b64url(createHmac('sha256', secret).update(encoded).digest());
    const actualBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expected);
    if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
      throw new UnauthorizedException('Invalid media token');
    }
    const payload = parsePayload(encoded);
    if (payload.lessonUuid !== lessonUuid || payload.scope !== scope) {
      throw new UnauthorizedException('Invalid media token scope');
    }
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException('Expired media token');
    }
    return payload;
  }
}

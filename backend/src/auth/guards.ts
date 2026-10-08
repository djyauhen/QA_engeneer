import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Request } from 'express';
import { SessionUser } from '../config';
import { FORBIDDEN_BODY } from '../tokens';
import { ROLE_TL } from '../roles';
import { SessionService } from './auth.service';

export function readSessionId(req: Request): string | null {
  const header = req.header('x-session-id');
  if (header) return header;
  const authorization = req.header('authorization');
  if (authorization?.toLowerCase().startsWith('bearer ')) return authorization.slice(7).trim();
  const cookie = req.header('cookie');
  if (!cookie) return null;
  for (const part of cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === 'qa_session') return decodeURIComponent(rest.join('='));
  }
  return null;
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user?: SessionUser }>();
    const id = readSessionId(req);
    const session = id ? this.sessions.get(id) : null;
    if (!session) throw new UnauthorizedException({ error: 'unauthorized' });
    req.user = session;
    return true;
  }
}

@Injectable()
export class TlGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user?: SessionUser }>();
    if (!req.user || req.user.role !== ROLE_TL) {
      throw new ForbiddenException(FORBIDDEN_BODY);
    }
    return true;
  }
}

export function sessionCookie(id: string, clear = false): string {
  if (clear) return 'qa_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0';
  return `qa_session=${encodeURIComponent(id)}; HttpOnly; Path=/; SameSite=Lax`;
}

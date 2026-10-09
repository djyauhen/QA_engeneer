import { Body, Controller, Delete, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { Request, Response } from 'express';
import { SessionUser } from '../config';
import { AuthService, SessionService } from './auth.service';
import { SessionGuard, sessionCookie } from './guards';

@Controller('session')
export class SessionController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Post()
  @HttpCode(200)
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const credentials = parseCredentials(body);
    const user = await this.auth.login(credentials.login, credentials.password);
    if (!user) this.auth.refused();
    const sessionId = await this.sessions.create(user as SessionUser);
    res.setHeader('Set-Cookie', sessionCookie(sessionId));
    return { role: user?.role, session_id: sessionId };
  }

  @Get()
  @UseGuards(SessionGuard)
  current(@Req() req: Request & { user: SessionUser }) {
    return { role: req.user.role };
  }

  @Delete()
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const header = req.header('x-session-id');
    const authorization = req.header('authorization');
    const bearer = authorization?.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : null;
    const cookie = req.header('cookie') ?? '';
    const fromCookie = cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('qa_session='))
      ?.slice('qa_session='.length);
    const id = header || bearer || (fromCookie ? decodeURIComponent(fromCookie) : null);
    if (id) await this.sessions.delete(id);
    res.setHeader('Set-Cookie', sessionCookie('', true));
    return { ok: true };
  }
}

function parseCredentials(body: unknown): { login: string; password: string } {
  if (!body || typeof body !== 'object') {
    throw new BadRequestException({ error: 'Некорректный запрос' });
  }
  const record = body as Record<string, unknown>;
  if (typeof record.login !== 'string' || typeof record.password !== 'string' || !record.login || !record.password) {
    throw new BadRequestException({ error: 'Некорректный запрос' });
  }
  return { login: record.login, password: record.password };
}

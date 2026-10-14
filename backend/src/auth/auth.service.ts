import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { AppConfig, SessionUser } from '../config';
import {
  APP_CONFIG,
  LOGIN_REFUSED,
  SESSIONS_REPO,
  SESSION_ABSOLUTE_MS,
  SESSION_TTL_MS,
  USERS_REPO,
} from '../tokens';
import { SessionsRepo, UsersRepo } from '../storage/repos';
import { isRole, ROLE_TL, Role } from '../roles';

const SESSION_REFRESH_AFTER_MS = SESSION_TTL_MS - 60 * 60 * 1000;

@Injectable()
export class SessionService {
  private lastPurge = 0;

  constructor(
    @Inject(SESSIONS_REPO) private readonly sessions: SessionsRepo,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(user: SessionUser): Promise<string> {
    const id = randomBytes(32).toString('hex');
    const now = Date.now();
    await this.sessions.deleteByLogin(user.login);
    await this.sessions.insert({
      id,
      login: user.login,
      role: user.role,
      source: user.source,
      expires_at: new Date(now + SESSION_TTL_MS).toISOString(),
      absolute_expires_at: new Date(now + SESSION_ABSOLUTE_MS).toISOString(),
      password_fingerprint: user.source === 'environment' ? passwordFingerprint(this.config.tlPassword) : null,
    });
    return id;
  }

  async get(id: string): Promise<SessionUser | null> {
    await this.purgeIfDue();
    const row = await this.sessions.get(id);
    if (!row || !isRole(row.role) || (row.source !== 'environment' && row.source !== 'neon')) return null;
    const expiresAt = new Date(row.expires_at).getTime();
    const absoluteAt = row.absolute_expires_at ? new Date(row.absolute_expires_at).getTime() : Number.POSITIVE_INFINITY;
    const now = Date.now();
    if (!Number.isFinite(expiresAt) || expiresAt <= now || absoluteAt <= now) {
      await this.sessions.delete(id);
      return null;
    }
    if (
      row.source === 'environment' &&
      row.password_fingerprint &&
      row.password_fingerprint !== passwordFingerprint(this.config.tlPassword)
    ) {
      await this.sessions.delete(id);
      return null;
    }
    if (expiresAt - now < SESSION_REFRESH_AFTER_MS) {
      const nextIdle = Math.min(now + SESSION_TTL_MS, absoluteAt);
      await this.sessions.touch(id, new Date(nextIdle).toISOString());
    }
    return { login: row.login, role: row.role, source: row.source };
  }

  private async purgeIfDue(): Promise<void> {
    const now = Date.now();
    if (now - this.lastPurge < 60 * 60 * 1000) return;
    this.lastPurge = now;
    await this.sessions.purgeExpired(new Date(now));
  }

  async delete(id: string): Promise<void> {
    await this.sessions.delete(id);
  }
}

@Injectable()
export class AuthService {
  private dummyHash: string | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(USERS_REPO) private readonly users: UsersRepo,
  ) {}

  async login(login: string, password: string): Promise<SessionUser | null> {
    const user = await this.users.findByLogin(login);
    const hash = user?.password_hash ?? (await this.placeholderHash());
    let matches = false;
    try {
      matches = await bcrypt.compare(password, hash);
    } catch {
      matches = false;
    }
    const tlLogin = safeEqual(login, this.config.tlLogin);
    const tlPassword = safeEqual(password, this.config.tlPassword);
    if (tlLogin && tlPassword) return { login: this.config.tlLogin, role: ROLE_TL, source: 'environment' };
    if (tlLogin || !user || !matches) return null;
    return { login: user.login, role: user.role as Role, source: 'neon' };
  }

  refused(): never {
    throw new UnauthorizedException({ error: LOGIN_REFUSED });
  }

  private async placeholderHash(): Promise<string> {
    if (!this.dummyHash) {
      this.dummyHash = await bcrypt.hash('not-a-user-password', this.config.bcryptRounds);
    }
    return this.dummyHash;
  }
}

export function passwordFingerprint(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

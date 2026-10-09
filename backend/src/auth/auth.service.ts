import { randomBytes, timingSafeEqual } from 'crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { AppConfig, SessionUser } from '../config';
import { APP_CONFIG, LOGIN_REFUSED, SESSIONS_REPO, SESSION_TTL_MS, USERS_REPO } from '../tokens';
import { SessionsRepo, UsersRepo } from '../storage/repos';
import { isRole, ROLE_TL, Role } from '../roles';

const SESSION_REFRESH_AFTER_MS = SESSION_TTL_MS - 60 * 60 * 1000;

@Injectable()
export class SessionService {
  constructor(@Inject(SESSIONS_REPO) private readonly sessions: SessionsRepo) {}

  async create(user: SessionUser): Promise<string> {
    const id = randomBytes(32).toString('hex');
    await this.sessions.insert({
      id,
      login: user.login,
      role: user.role,
      source: user.source,
      expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    });
    return id;
  }

  async get(id: string): Promise<SessionUser | null> {
    const row = await this.sessions.get(id);
    if (!row || !isRole(row.role) || (row.source !== 'environment' && row.source !== 'neon')) return null;
    const expiresAt = new Date(row.expires_at).getTime();
    const now = Date.now();
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      await this.sessions.delete(id);
      return null;
    }
    if (expiresAt - now < SESSION_REFRESH_AFTER_MS) {
      await this.sessions.touch(id, new Date(now + SESSION_TTL_MS).toISOString());
    }
    return { login: row.login, role: row.role, source: row.source };
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
    if (safeEqual(login, this.config.tlLogin) && safeEqual(password, this.config.tlPassword)) {
      return { login: this.config.tlLogin, role: ROLE_TL, source: 'environment' };
    }
    if (safeEqual(login, this.config.tlLogin)) return null;
    const user = await this.users.findByLogin(login);
    const hash = user?.password_hash ?? (await this.placeholderHash());
    const matches = await bcrypt.compare(password, hash);
    if (!user || !matches) return null;
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

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

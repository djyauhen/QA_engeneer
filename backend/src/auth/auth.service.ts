import { randomBytes, timingSafeEqual } from 'crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { AppConfig, SessionUser } from '../config';
import { APP_CONFIG, LOGIN_REFUSED, USERS_REPO } from '../tokens';
import { UsersRepo } from '../storage/repos';
import { ROLE_TL, Role } from '../roles';

@Injectable()
export class SessionService {
  private readonly sessions = new Map<string, SessionUser>();

  create(user: SessionUser): string {
    const id = randomBytes(32).toString('hex');
    this.sessions.set(id, { login: user.login, role: user.role, source: user.source });
    return id;
  }

  get(id: string): SessionUser | null {
    return this.sessions.get(id) ?? null;
  }

  delete(id: string): void {
    this.sessions.delete(id);
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

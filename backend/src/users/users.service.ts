import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { AppConfig } from '../config';
import { isRole, ROLE_TL } from '../roles';
import { APP_CONFIG, USERS_REPO } from '../tokens';
import { UsersRepo } from '../storage/repos';

@Injectable()
export class UsersService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(USERS_REPO) private readonly users: UsersRepo,
  ) {}

  async create(body: unknown): Promise<{ login: string; role: string }> {
    const input = parseCreate(body);
    if (input.login === this.config.tlLogin) {
      throw new ConflictException({ error: 'Логин уже занят' });
    }
    const existing = await this.users.findByLogin(input.login);
    if (existing) throw new ConflictException({ error: 'Логин уже занят' });
    const passwordHash = await bcrypt.hash(input.password, this.config.bcryptRounds);
    try {
      await this.users.insert({ login: input.login, password_hash: passwordHash, role: input.role });
    } catch (error) {
      if (error instanceof Error && error.message === 'duplicate-login') {
        throw new ConflictException({ error: 'Логин уже занят' });
      }
      throw error;
    }
    return { login: input.login, role: input.role };
  }

  async list(): Promise<{ users: Array<{ login: string; role: string; source: 'environment' | 'neon' }> }> {
    const stored = await this.users.list();
    return {
      users: [
        { login: this.config.tlLogin, role: ROLE_TL, source: 'environment' },
        ...stored.map((user) => ({ login: user.login, role: user.role, source: 'neon' as const })),
      ],
    };
  }
}

function parseCreate(body: unknown): { login: string; password: string; role: string } {
  if (!body || typeof body !== 'object') throw new BadRequestException({ error: 'Некорректный запрос' });
  const record = body as Record<string, unknown>;
  if (typeof record.login !== 'string' || !record.login || typeof record.password !== 'string' || !record.password) {
    throw new BadRequestException({ error: 'Некорректный запрос' });
  }
  if (!isRole(record.role)) throw new BadRequestException({ error: 'Некорректная роль' });
  return { login: record.login, password: record.password, role: record.role };
}

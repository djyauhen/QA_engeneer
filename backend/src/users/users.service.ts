import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { AppConfig } from '../config';
import { isRole, ROLE_TL } from '../roles';
import { APP_CONFIG, SESSIONS_REPO, USERS_REPO } from '../tokens';
import { SessionsRepo, UsersRepo } from '../storage/repos';

const ENV_ACCOUNT = 'Учётная запись окружения не изменяется';

@Injectable()
export class UsersService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(USERS_REPO) private readonly users: UsersRepo,
    @Inject(SESSIONS_REPO) private readonly sessions: SessionsRepo,
  ) {}

  async create(body: unknown): Promise<{ login: string; role: string }> {
    const input = parseCreate(body);
    this.rejectEnvironmentLogin(input.login);
    const existing = await this.users.findByLogin(input.login);
    if (existing) throw new ConflictException({ error: 'Логин уже занят' });
    const passwordHash = await bcrypt.hash(input.password, this.config.bcryptRounds);
    try {
      await this.users.insert({ login: input.login, password_hash: passwordHash, role: input.role, disabled: false });
    } catch (error) {
      if (error instanceof Error && error.message === 'duplicate-login') {
        throw new ConflictException({ error: 'Логин уже занят' });
      }
      throw error;
    }
    return { login: input.login, role: input.role };
  }

  async list(): Promise<{
    users: Array<{ login: string; role: string; source: 'environment' | 'neon'; disabled: boolean }>;
  }> {
    const stored = await this.users.list();
    return {
      users: [
        { login: this.config.tlLogin, role: ROLE_TL, source: 'environment', disabled: false },
        ...stored.map((user) => ({
          login: user.login,
          role: user.role,
          source: 'neon' as const,
          disabled: user.disabled === true,
        })),
      ],
    };
  }

  async setBlocked(login: string, body: unknown): Promise<{ login: string; disabled: boolean }> {
    const disabled = parseDisabled(body);
    this.rejectEnvironmentLogin(login);
    await this.requireStored(login);
    await this.users.setDisabled(login, disabled);
    if (disabled) await this.sessions.deleteByLogin(login);
    return { login, disabled };
  }

  async changePassword(login: string, body: unknown): Promise<{ ok: true }> {
    const password = parsePassword(body);
    this.rejectEnvironmentLogin(login);
    await this.requireStored(login);
    const passwordHash = await bcrypt.hash(password, this.config.bcryptRounds);
    await this.users.setPasswordHash(login, passwordHash);
    await this.sessions.deleteByLogin(login);
    return { ok: true };
  }

  private rejectEnvironmentLogin(login: string): void {
    if (login === this.config.tlLogin) throw new ConflictException({ error: ENV_ACCOUNT });
  }

  private async requireStored(login: string): Promise<void> {
    if (!login) throw new BadRequestException({ error: 'Некорректный запрос' });
    const existing = await this.users.findByLogin(login);
    if (!existing) throw new NotFoundException({ error: 'not_found' });
  }
}

function parseCreate(body: unknown): { login: string; password: string; role: string } {
  if (!body || typeof body !== 'object') throw new BadRequestException({ error: 'Некорректный запрос' });
  const record = body as Record<string, unknown>;
  if (typeof record.login !== 'string' || !record.login || typeof record.password !== 'string' || !record.password) {
    throw new BadRequestException({ error: 'Некорректный запрос' });
  }
  if (record.password.length < 8 || record.password.length > 128) {
    throw new BadRequestException({ error: 'Некорректный запрос' });
  }
  if (!isRole(record.role)) throw new BadRequestException({ error: 'Некорректная роль' });
  return { login: record.login, password: record.password, role: record.role };
}

function parsePassword(body: unknown): string {
  if (!body || typeof body !== 'object') throw new BadRequestException({ error: 'Некорректный запрос' });
  const password = (body as { password?: unknown }).password;
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw new BadRequestException({ error: 'Некорректный запрос' });
  }
  return password;
}

function parseDisabled(body: unknown): boolean {
  if (!body || typeof body !== 'object') throw new BadRequestException({ error: 'Некорректный запрос' });
  const disabled = (body as { disabled?: unknown }).disabled;
  if (typeof disabled !== 'boolean') throw new BadRequestException({ error: 'Некорректный запрос' });
  return disabled;
}

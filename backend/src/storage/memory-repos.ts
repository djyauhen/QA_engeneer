import { randomUUID } from 'crypto';
import { CatalogQuery, cloneCatalogQuery } from '../catalog/catalog-query';
import { CatalogCard } from '../catalog/map-row';
import { ReportPayload } from '../reports/report.types';
import { AdminRules } from '../rules/rules';
import { retentionCutoff } from '../rules/rules';
import {
  CatalogQueryRepo,
  CatalogRepo,
  CostEntry,
  CostsRepo,
  ReportListItem,
  ReportsRepo,
  Repos,
  RulesRepo,
  StoredUser,
  UsersRepo,
} from './repos';

export class MemoryUsersRepo implements UsersRepo {
  readonly rows: StoredUser[] = [];

  async insert(user: StoredUser): Promise<void> {
    if (this.rows.some((row) => row.login === user.login)) {
      throw new Error('duplicate-login');
    }
    this.rows.push({ login: user.login, password_hash: user.password_hash, role: user.role });
  }

  async findByLogin(login: string): Promise<StoredUser | null> {
    return this.rows.find((row) => row.login === login) ?? null;
  }

  async list(): Promise<Array<{ login: string; role: string }>> {
    return this.rows.map((row) => ({ login: row.login, role: row.role }));
  }
}

export class MemoryCatalogRepo implements CatalogRepo {
  rows: CatalogCard[] = [];
  refreshedAtValue: string | null = null;

  async save(rows: CatalogCard[]): Promise<void> {
    this.rows = rows.map((row) => ({ ...row }));
    this.refreshedAtValue = new Date().toISOString();
  }

  async load(): Promise<CatalogCard[]> {
    return this.rows.map((row) => ({ ...row }));
  }

  async refreshedAt(): Promise<string | null> {
    return this.refreshedAtValue;
  }
}

export class MemoryReportsRepo implements ReportsRepo {
  readonly rows: Array<{
    id: string;
    human_id: string;
    owner_login: string;
    created_at: string;
    payload: ReportPayload;
  }> = [];

  async insert(row: {
    id: string;
    human_id: string;
    owner_login: string;
    created_at: string;
    payload: ReportPayload;
  }): Promise<void> {
    this.rows.push(row);
  }

  async get(id: string): Promise<ReportPayload | null> {
    this.purge(new Date());
    return this.rows.find((row) => row.id === id)?.payload ?? null;
  }

  async list(ownerLogin: string | null, now: Date): Promise<ReportListItem[]> {
    this.purge(now);
    return this.rows
      .filter((row) => ownerLogin == null || row.owner_login === ownerLogin)
      .filter((row) => new Date(row.created_at).getTime() >= retentionCutoff(now).getTime())
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((row) => ({
        report_id: row.id,
        human_id: row.human_id,
        name: row.payload.name,
        created_at: row.created_at,
        owner_login: row.owner_login,
      }));
  }

  async findPrevious(input: {
    humanId: string;
    before: string;
    ownerLogin: string | null;
    excludeId: string;
    now: Date;
  }): Promise<ReportPayload | null> {
    this.purge(input.now);
    const cutoff = retentionCutoff(input.now).getTime();
    const hits = this.rows
      .filter((row) => row.human_id === input.humanId && row.id !== input.excludeId)
      .filter((row) => input.ownerLogin == null || row.owner_login === input.ownerLogin)
      .filter((row) => row.created_at < input.before)
      .filter((row) => new Date(row.created_at).getTime() >= cutoff)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return hits[0]?.payload ?? null;
  }

  private purge(now: Date): void {
    const cutoff = retentionCutoff(now).getTime();
    for (let i = this.rows.length - 1; i >= 0; i -= 1) {
      if (new Date(this.rows[i].created_at).getTime() < cutoff) {
        this.rows.splice(i, 1);
      }
    }
  }
}

export class MemoryCatalogQueryRepo implements CatalogQueryRepo {
  current: CatalogQuery | null = null;

  async get(): Promise<CatalogQuery | null> {
    return this.current ? cloneCatalogQuery(this.current) : null;
  }

  async set(query: CatalogQuery): Promise<void> {
    this.current = cloneCatalogQuery(query);
  }
}

export class MemoryRulesRepo implements RulesRepo {
  current: AdminRules | null = null;

  async get(): Promise<AdminRules | null> {
    return this.current ? { ...this.current, languages_override: [...this.current.languages_override] } : null;
  }

  async set(rules: AdminRules): Promise<void> {
    this.current = {
      ...rules,
      allowed_external_prefixes: [...rules.allowed_external_prefixes],
      forbidden_macros: [...rules.forbidden_macros],
      forbidden_script_markers: [...rules.forbidden_script_markers],
      languages_override: [...rules.languages_override],
    };
  }
}

export class MemoryCostsRepo implements CostsRepo {
  readonly rows: CostEntry[] = [];

  async insert(entry: CostEntry): Promise<void> {
    this.rows.push({ provider_usage: { ...entry.provider_usage }, recorded_at: entry.recorded_at });
  }

  async list(): Promise<CostEntry[]> {
    return this.rows.map((row) => ({ provider_usage: { ...row.provider_usage }, recorded_at: row.recorded_at }));
  }
}

export function createMemoryRepos(): Repos {
  return {
    users: new MemoryUsersRepo(),
    catalog: new MemoryCatalogRepo(),
    catalogQuery: new MemoryCatalogQueryRepo(),
    reports: new MemoryReportsRepo(),
    rules: new MemoryRulesRepo(),
    costs: new MemoryCostsRepo(),
    close: async () => undefined,
  };
}

export function newId(): string {
  return randomUUID();
}

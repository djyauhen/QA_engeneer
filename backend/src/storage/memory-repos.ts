import { randomUUID } from 'crypto';
import { CatalogQuery, cloneCatalogQuery } from '../catalog/catalog-query';
import { CatalogCard } from '../catalog/map-row';
import { ReportPayload } from '../reports/report.types';
import { AdminRules } from '../rules/rules';
import { retentionCutoff } from '../rules/rules';
import { LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS } from '../tokens';
import { cloneSnapshot, mergeActiveSnapshot } from './active-snapshot';
import {
  ActiveCheckSnapshot,
  ActiveChecksRepo,
  CatalogQueryRepo,
  CatalogRepo,
  CheckArchivesRepo,
  CostEntry,
  CostsRepo,
  ReportListItem,
  reportListStatuses,
  ReportsRepo,
  Repos,
  RulesRepo,
  LoginAttemptsRepo,
  SessionInsert,
  SessionRecord,
  SessionsRepo,
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
    this.rows = rows.map((row) => ({ ...row, preview_image: '' }));
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
    if (this.rows.some((existing) => existing.id === row.id)) return;
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
        ...reportListStatuses(row.payload),
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

export class MemorySessionsRepo implements SessionsRepo {
  readonly rows = new Map<string, SessionRecord>();

  async insert(row: SessionInsert): Promise<void> {
    this.rows.set(row.id, {
      login: row.login,
      role: row.role,
      source: row.source,
      expires_at: row.expires_at,
      absolute_expires_at: row.absolute_expires_at,
      password_fingerprint: row.password_fingerprint,
    });
  }

  async get(id: string): Promise<SessionRecord | null> {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }

  async touch(id: string, expiresAt: string): Promise<void> {
    const row = this.rows.get(id);
    if (!row) return;
    row.expires_at = expiresAt;
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }

  async deleteByLogin(login: string): Promise<void> {
    for (const [id, row] of this.rows) {
      if (row.login === login) this.rows.delete(id);
    }
  }

  async purgeExpired(now: Date): Promise<void> {
    const stamp = now.getTime();
    for (const [id, row] of this.rows) {
      const idle = new Date(row.expires_at).getTime();
      const absolute = row.absolute_expires_at ? new Date(row.absolute_expires_at).getTime() : Number.POSITIVE_INFINITY;
      if (idle <= stamp || absolute <= stamp) this.rows.delete(id);
    }
  }
}

export class MemoryLoginAttemptsRepo implements LoginAttemptsRepo {
  private readonly attempts = new Map<string, { failures: number; windowStarted: number; lockedUntil: number | null }>();

  async blocked(subject: string, now: number): Promise<boolean> {
    const row = this.attempts.get(subject);
    return !!row?.lockedUntil && row.lockedUntil > now;
  }

  async fail(subject: string, now: number): Promise<void> {
    const current = this.attempts.get(subject);
    if (!current || now - current.windowStarted > LOGIN_WINDOW_MS) {
      this.attempts.set(subject, { failures: 1, windowStarted: now, lockedUntil: null });
      return;
    }
    current.failures += 1;
    if (current.failures >= LOGIN_MAX_FAILURES) current.lockedUntil = now + LOGIN_WINDOW_MS;
  }

  async clear(subject: string): Promise<void> {
    this.attempts.delete(subject);
  }
}

interface MemoryActiveRow {
  owner_login: string;
  payload: ActiveCheckSnapshot;
  leaseOwner: string | null;
  leaseUntil: number | null;
}

export class MemoryActiveChecksRepo implements ActiveChecksRepo {
  readonly rows = new Map<string, MemoryActiveRow>();

  async upsert(
    id: string,
    ownerLogin: string,
    payload: ActiveCheckSnapshot,
    claim?: { owner: string; until: string },
  ): Promise<boolean> {
    const current = this.rows.get(id);
    const merged = mergeActiveSnapshot(current?.payload ?? null, payload);
    let leaseOwner = current?.leaseOwner ?? null;
    let leaseUntil = current?.leaseUntil ?? null;
    let held = false;
    if (claim) {
      const now = Date.now();
      if (!leaseOwner || leaseOwner === claim.owner || (leaseUntil ?? 0) <= now) {
        leaseOwner = claim.owner;
        leaseUntil = new Date(claim.until).getTime();
        held = true;
      }
    }
    this.rows.set(id, { owner_login: ownerLogin, payload: merged, leaseOwner, leaseUntil });
    return held;
  }

  async get(id: string): Promise<{ owner_login: string; payload: ActiveCheckSnapshot } | null> {
    const row = this.rows.get(id);
    if (!row) return null;
    return { owner_login: row.owner_login, payload: cloneSnapshot(row.payload) };
  }

  async listByOwner(ownerLogin: string): Promise<Array<{ id: string; payload: ActiveCheckSnapshot }>> {
    const rows: Array<{ id: string; payload: ActiveCheckSnapshot }> = [];
    for (const [id, row] of this.rows) {
      if (row.owner_login !== ownerLogin) continue;
      rows.push({ id, payload: cloneSnapshot(row.payload) });
    }
    return rows;
  }

  async tryClaim(id: string, ownerToken: string, leaseUntil: string): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row) return false;
    const now = Date.now();
    if (row.leaseOwner && row.leaseOwner !== ownerToken && (row.leaseUntil ?? 0) > now) return false;
    row.leaseOwner = ownerToken;
    row.leaseUntil = new Date(leaseUntil).getTime();
    return true;
  }

  async releaseLease(id: string, ownerToken: string): Promise<void> {
    const row = this.rows.get(id);
    if (!row || row.leaseOwner !== ownerToken) return;
    row.leaseOwner = null;
    row.leaseUntil = null;
  }

  async patchDecision(id: string, decision: 'allow' | 'deny'): Promise<void> {
    const row = this.rows.get(id);
    if (!row) return;
    row.payload = { ...row.payload, pendingDecision: decision };
  }

  async patchActionsAllowed(id: string): Promise<void> {
    const row = this.rows.get(id);
    if (!row) return;
    row.payload = { ...row.payload, actionsAllowed: true };
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}

export class MemoryArchivesRepo implements CheckArchivesRepo {
  readonly files = new Map<string, Buffer>();

  async put(id: string, body: Buffer): Promise<void> {
    this.files.set(id, Buffer.from(body));
  }

  async get(id: string): Promise<Buffer | null> {
    const body = this.files.get(id);
    return body ? Buffer.from(body) : null;
  }

  async delete(id: string): Promise<void> {
    this.files.delete(id);
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
    sessions: new MemorySessionsRepo(),
    catalog: new MemoryCatalogRepo(),
    catalogQuery: new MemoryCatalogQueryRepo(),
    reports: new MemoryReportsRepo(),
    rules: new MemoryRulesRepo(),
    costs: new MemoryCostsRepo(),
    activeChecks: new MemoryActiveChecksRepo(),
    archives: new MemoryArchivesRepo(),
    loginAttempts: new MemoryLoginAttemptsRepo(),
    close: async () => undefined,
  };
}

export function newId(): string {
  return randomUUID();
}

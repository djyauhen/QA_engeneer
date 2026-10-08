import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { CatalogCard } from '../catalog/map-row';
import { ReportPayload } from '../reports/report.types';
import { AdminRules, retentionCutoff } from '../rules/rules';
import { SCHEMA_STATEMENTS } from './schema';
import {
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

export async function createPostgresRepos(databaseUrl: string): Promise<Repos> {
  const pool = new Pool({ connectionString: databaseUrl });
  for (const statement of SCHEMA_STATEMENTS) {
    await pool.query(statement);
  }
  return {
    users: new PgUsersRepo(pool),
    catalog: new PgCatalogRepo(pool),
    reports: new PgReportsRepo(pool),
    rules: new PgRulesRepo(pool),
    costs: new PgCostsRepo(pool),
    close: async () => {
      await pool.end();
    },
  };
}

class PgUsersRepo implements UsersRepo {
  constructor(private readonly pool: Pool) {}

  async insert(user: StoredUser): Promise<void> {
    try {
      await this.pool.query(
        'INSERT INTO users (login, password_hash, role) VALUES ($1, $2, $3)',
        [user.login, user.password_hash, user.role],
      );
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '23505') {
        throw new Error('duplicate-login');
      }
      throw new Error('users-insert-failed');
    }
  }

  async findByLogin(login: string): Promise<StoredUser | null> {
    const result = await this.pool.query<{ login: string; password_hash: string; role: string }>(
      'SELECT login, password_hash, role FROM users WHERE login = $1',
      [login],
    );
    return result.rows[0] ?? null;
  }

  async list(): Promise<Array<{ login: string; role: string }>> {
    const result = await this.pool.query<{ login: string; role: string }>(
      'SELECT login, role FROM users ORDER BY login',
    );
    return result.rows.map((row) => ({ login: row.login, role: row.role }));
  }
}

class PgCatalogRepo implements CatalogRepo {
  constructor(private readonly pool: Pool) {}

  async save(rows: CatalogCard[]): Promise<void> {
    await this.pool.query(
      `INSERT INTO catalog_cache (id, rows, refreshed_at)
       VALUES (1, $1::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET rows = EXCLUDED.rows, refreshed_at = NOW()`,
      [JSON.stringify(rows)],
    );
  }

  async load(): Promise<CatalogCard[]> {
    const result = await this.pool.query<{ rows: CatalogCard[] }>('SELECT rows FROM catalog_cache WHERE id = 1');
    return result.rows[0]?.rows ?? [];
  }
}

class PgReportsRepo implements ReportsRepo {
  constructor(private readonly pool: Pool) {}

  async insert(row: {
    id: string;
    human_id: string;
    owner_login: string;
    created_at: string;
    payload: ReportPayload;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO reports (id, human_id, owner_login, created_at, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [row.id, row.human_id, row.owner_login, row.created_at, JSON.stringify(row.payload)],
    );
  }

  async get(id: string): Promise<ReportPayload | null> {
    await this.purge(new Date());
    const result = await this.pool.query<{ payload: ReportPayload }>(
      'SELECT payload FROM reports WHERE id = $1',
      [id],
    );
    return result.rows[0]?.payload ?? null;
  }

  async list(ownerLogin: string | null, now: Date): Promise<ReportListItem[]> {
    await this.purge(now);
    const result = await this.pool.query<{
      id: string;
      human_id: string;
      owner_login: string;
      created_at: Date;
      name: string;
    }>(
      `SELECT id, human_id, owner_login, created_at, payload->>'name' AS name
       FROM reports
       WHERE created_at >= $1
         AND ($2::text IS NULL OR owner_login = $2)
       ORDER BY created_at DESC`,
      [retentionCutoff(now).toISOString(), ownerLogin],
    );
    return result.rows.map((row) => ({
      report_id: row.id,
      human_id: row.human_id,
      name: row.name ?? '',
      created_at: new Date(row.created_at).toISOString(),
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
    await this.purge(input.now);
    const result = await this.pool.query<{ payload: ReportPayload }>(
      `SELECT payload FROM reports
       WHERE human_id = $1
         AND id <> $2
         AND created_at < $3
         AND created_at >= $4
         AND ($5::text IS NULL OR owner_login = $5)
       ORDER BY created_at DESC
       LIMIT 1`,
      [
        input.humanId,
        input.excludeId,
        input.before,
        retentionCutoff(input.now).toISOString(),
        input.ownerLogin,
      ],
    );
    return result.rows[0]?.payload ?? null;
  }

  private async purge(now: Date): Promise<void> {
    await this.pool.query('DELETE FROM reports WHERE created_at < $1', [retentionCutoff(now).toISOString()]);
  }
}

class PgRulesRepo implements RulesRepo {
  constructor(private readonly pool: Pool) {}

  async get(): Promise<AdminRules | null> {
    const result = await this.pool.query<{ rules: AdminRules }>('SELECT rules FROM admin_rules WHERE id = 1');
    return result.rows[0]?.rules ?? null;
  }

  async set(rules: AdminRules): Promise<void> {
    await this.pool.query(
      `INSERT INTO admin_rules (id, rules) VALUES (1, $1::jsonb)
       ON CONFLICT (id) DO UPDATE SET rules = EXCLUDED.rules`,
      [JSON.stringify(rules)],
    );
  }
}

class PgCostsRepo implements CostsRepo {
  constructor(private readonly pool: Pool) {}

  async insert(entry: CostEntry): Promise<void> {
    await this.pool.query(
      'INSERT INTO cost_entries (id, provider_usage, recorded_at) VALUES ($1, $2::jsonb, $3)',
      [randomUUID(), JSON.stringify(entry.provider_usage), entry.recorded_at],
    );
  }

  async list(): Promise<CostEntry[]> {
    const result = await this.pool.query<{ provider_usage: Record<string, unknown>; recorded_at: Date }>(
      'SELECT provider_usage, recorded_at FROM cost_entries ORDER BY recorded_at ASC',
    );
    return result.rows.map((row) => ({
      provider_usage: row.provider_usage,
      recorded_at: new Date(row.recorded_at).toISOString(),
    }));
  }
}

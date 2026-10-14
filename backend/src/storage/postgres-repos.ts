import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { CatalogQuery, cloneCatalogQuery } from '../catalog/catalog-query';
import { CatalogCard } from '../catalog/map-row';
import { ReportPayload } from '../reports/report.types';
import { AdminRules, retentionCutoff } from '../rules/rules';
import { LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS } from '../tokens';
import { mergeActiveSnapshot } from './active-snapshot';
import { SCHEMA_STATEMENTS } from './schema';
import {
  ActiveCheckSnapshot,
  ActiveChecksRepo,
  CheckArchivesRepo,
  CatalogQueryRepo,
  CatalogRepo,
  CostEntry,
  CostsRepo,
  LoginAttemptsRepo,
  ReportListItem,
  reportListStatuses,
  ReportsRepo,
  Repos,
  RulesRepo,
  SessionInsert,
  SessionRecord,
  SessionsRepo,
  StoredUser,
  UsersRepo,
} from './repos';

export async function createPostgresRepos(databaseUrl: string, poolMax = 10): Promise<Repos> {
  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10_000, max: poolMax });
  pool.on('error', (error: Error) => {
    console.error(`postgres pool error: ${redactConnectionString(error.message)}`);
  });
  const query = pool.query.bind(pool) as Pool['query'];
  let schema: Promise<void> | null = null;
  const ensureSchema = (): Promise<void> => {
    if (!schema) {
      schema = runSchema(query).catch((error: unknown) => {
        schema = null;
        throw error;
      });
    }
    return schema;
  };
  pool.query = ((...args: Parameters<Pool['query']>) =>
    ensureSchema().then(() => query(...args))) as Pool['query'];
  return {
    users: new PgUsersRepo(pool),
    sessions: new PgSessionsRepo(pool),
    catalog: new PgCatalogRepo(pool),
    catalogQuery: new PgCatalogQueryRepo(pool),
    reports: new PgReportsRepo(pool),
    rules: new PgRulesRepo(pool),
    costs: new PgCostsRepo(pool),
    activeChecks: new PgActiveChecksRepo(pool),
    archives: new PgArchivesRepo(pool),
    loginAttempts: new PgLoginAttemptsRepo(pool),
    close: async () => {
      await pool.end();
    },
  };
}

async function runSchema(query: Pool['query']): Promise<void> {
  for (const statement of SCHEMA_STATEMENTS) {
    await query(statement);
  }
}

function redactConnectionString(message: string): string {
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]');
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
      console.error(`users insert failed: ${code ?? 'unknown'}`);
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
      [JSON.stringify(rows.map((row) => ({ ...row, preview_image: '' })))],
    );
  }

  async load(): Promise<CatalogCard[]> {
    const result = await this.pool.query<{ rows: CatalogCard[] }>('SELECT rows FROM catalog_cache WHERE id = 1');
    return result.rows[0]?.rows ?? [];
  }

  async refreshedAt(): Promise<string | null> {
    const result = await this.pool.query<{ refreshed_at: Date | string }>(
      'SELECT refreshed_at FROM catalog_cache WHERE id = 1',
    );
    const value = result.rows[0]?.refreshed_at;
    if (!value) return null;
    return new Date(value).toISOString();
  }
}

class PgCatalogQueryRepo implements CatalogQueryRepo {
  constructor(private readonly pool: Pool) {}

  async get(): Promise<CatalogQuery | null> {
    const result = await this.pool.query<{ query: CatalogQuery }>('SELECT query FROM catalog_query WHERE id = 1');
    const stored = result.rows[0]?.query;
    return stored ? cloneCatalogQuery(stored) : null;
  }

  async set(query: CatalogQuery): Promise<void> {
    await this.pool.query(
      `INSERT INTO catalog_query (id, query) VALUES (1, $1::jsonb)
       ON CONFLICT (id) DO UPDATE SET query = EXCLUDED.query`,
      [JSON.stringify(query)],
    );
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
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (id) DO NOTHING`,
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
      static_summary: string | null;
      ai_status: string | null;
      lighthouse_status: string | null;
    }>(
      `SELECT id, human_id, owner_login, created_at,
              COALESCE(payload->>'name', '') AS name,
              payload->'static'->>'summary' AS static_summary,
              payload->'ai'->>'status' AS ai_status,
              payload->'lighthouse'->>'status' AS lighthouse_status
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
      ...reportListStatuses({
        static: row.static_summary == null ? null : { summary: row.static_summary },
        ai: row.ai_status == null ? null : { status: row.ai_status },
        lighthouse: row.lighthouse_status == null ? null : { status: row.lighthouse_status },
      }),
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
    const cutoff = retentionCutoff(now).toISOString();
    await this.pool.query('DELETE FROM reports WHERE created_at < $1', [cutoff]);
    await this.pool.query('DELETE FROM cost_entries WHERE recorded_at < $1', [cutoff]);
    await this.pool.query(
      `DELETE FROM check_archives
       WHERE id IN (
         SELECT id FROM active_checks
         WHERE payload->>'reportSaved' = 'true'
           AND updated_at < NOW() - INTERVAL '24 hours'
       )`,
    );
    await this.pool.query(
      `DELETE FROM active_checks
       WHERE payload->>'reportSaved' = 'true'
         AND updated_at < NOW() - INTERVAL '24 hours'`,
    );
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

class PgSessionsRepo implements SessionsRepo {
  constructor(private readonly pool: Pool) {}

  async insert(row: SessionInsert): Promise<void> {
    await this.pool.query(
      `INSERT INTO sessions (id, login, role, source, expires_at, absolute_expires_at, password_fingerprint)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        row.id,
        row.login,
        row.role,
        row.source,
        row.expires_at,
        row.absolute_expires_at,
        row.password_fingerprint,
      ],
    );
  }

  async get(id: string): Promise<SessionRecord | null> {
    const result = await this.pool.query<{
      login: string;
      role: string;
      source: string;
      expires_at: Date | string;
      absolute_expires_at: Date | string | null;
      password_fingerprint: string | null;
    }>(
      `SELECT login, role, source, expires_at, absolute_expires_at, password_fingerprint
       FROM sessions WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (row.source !== 'environment' && row.source !== 'neon') return null;
    return {
      login: row.login,
      role: row.role,
      source: row.source,
      expires_at: new Date(row.expires_at).toISOString(),
      absolute_expires_at: row.absolute_expires_at ? new Date(row.absolute_expires_at).toISOString() : null,
      password_fingerprint: row.password_fingerprint,
    };
  }

  async touch(id: string, expiresAt: string): Promise<void> {
    await this.pool.query('UPDATE sessions SET expires_at = $2 WHERE id = $1', [id, expiresAt]);
  }

  async delete(id: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE id = $1', [id]);
  }

  async deleteByLogin(login: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE login = $1', [login]);
  }

  async purgeExpired(now: Date): Promise<void> {
    await this.pool.query(
      `DELETE FROM sessions
       WHERE expires_at <= $1
          OR (absolute_expires_at IS NOT NULL AND absolute_expires_at <= $1)`,
      [now.toISOString()],
    );
  }
}

class PgLoginAttemptsRepo implements LoginAttemptsRepo {
  constructor(private readonly pool: Pool) {}

  async blocked(subject: string, now: number): Promise<boolean> {
    const result = await this.pool.query<{ locked_until: Date | null }>(
      'SELECT locked_until FROM login_attempts WHERE subject = $1',
      [subject],
    );
    const locked = result.rows[0]?.locked_until;
    return !!locked && new Date(locked).getTime() > now;
  }

  async fail(subject: string, now: number): Promise<void> {
    const result = await this.pool.query<{ failures: number; window_started: Date }>(
      'SELECT failures, window_started FROM login_attempts WHERE subject = $1',
      [subject],
    );
    const current = result.rows[0];
    const fresh = !current || now - new Date(current.window_started).getTime() > LOGIN_WINDOW_MS;
    const failures = fresh ? 1 : current.failures + 1;
    const windowStarted = fresh ? new Date(now).toISOString() : new Date(current.window_started).toISOString();
    const lockedUntil = failures >= LOGIN_MAX_FAILURES ? new Date(now + LOGIN_WINDOW_MS).toISOString() : null;
    await this.pool.query(
      `INSERT INTO login_attempts (subject, failures, window_started, locked_until)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (subject) DO UPDATE SET
         failures = EXCLUDED.failures,
         window_started = EXCLUDED.window_started,
         locked_until = EXCLUDED.locked_until`,
      [subject, failures, windowStarted, lockedUntil],
    );
  }

  async clear(subject: string): Promise<void> {
    await this.pool.query('DELETE FROM login_attempts WHERE subject = $1', [subject]);
  }
}

class PgActiveChecksRepo implements ActiveChecksRepo {
  constructor(private readonly pool: Pool) {}

  async upsert(
    id: string,
    ownerLogin: string,
    payload: ActiveCheckSnapshot,
    claim?: { owner: string; until: string },
  ): Promise<boolean> {
    await this.pool.query('SELECT 1');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<{ payload: ActiveCheckSnapshot | string; lease_owner: string | null; lease_until: Date | null }>(
        'SELECT payload, lease_owner, lease_until FROM active_checks WHERE id = $1 FOR UPDATE',
        [id],
      );
      const previous = readSnapshot(current.rows[0]?.payload);
      const merged = mergeActiveSnapshot(previous, payload);
      const leaseOwner = current.rows[0]?.lease_owner ?? null;
      const leaseUntil = current.rows[0]?.lease_until ? new Date(current.rows[0].lease_until).getTime() : 0;
      const held =
        !!claim && (!leaseOwner || leaseOwner === claim.owner || leaseUntil <= Date.now());
      await client.query(
        `INSERT INTO active_checks (id, owner_login, payload, updated_at, lease_owner, lease_until)
         VALUES ($1, $2, $3::jsonb, NOW(), $4, $5)
         ON CONFLICT (id) DO UPDATE SET
           owner_login = EXCLUDED.owner_login,
           payload = EXCLUDED.payload,
           updated_at = NOW(),
           lease_owner = CASE WHEN $6 THEN $4 ELSE active_checks.lease_owner END,
           lease_until = CASE WHEN $6 THEN $5 ELSE active_checks.lease_until END`,
        [id, ownerLogin, JSON.stringify(merged), held ? claim?.owner ?? null : null, held ? claim?.until ?? null : null, held],
      );
      await client.query('COMMIT');
      return held;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async get(id: string): Promise<{ owner_login: string; payload: ActiveCheckSnapshot } | null> {
    const result = await this.pool.query<{ owner_login: string; payload: ActiveCheckSnapshot | string }>(
      'SELECT owner_login, payload FROM active_checks WHERE id = $1',
      [id],
    );
    const row = result.rows[0];
    if (!row) return null;
    const payload = readSnapshot(row.payload);
    if (!payload) return null;
    return { owner_login: row.owner_login, payload };
  }

  async listByOwner(ownerLogin: string): Promise<Array<{ id: string; payload: ActiveCheckSnapshot }>> {
    const result = await this.pool.query<{ id: string; payload: ActiveCheckSnapshot | string }>(
      'SELECT id, payload FROM active_checks WHERE owner_login = $1',
      [ownerLogin],
    );
    const rows: Array<{ id: string; payload: ActiveCheckSnapshot }> = [];
    for (const row of result.rows) {
      const payload = readSnapshot(row.payload);
      if (payload) rows.push({ id: row.id, payload });
    }
    return rows;
  }

  async tryClaim(id: string, ownerToken: string, leaseUntil: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE active_checks
       SET lease_owner = $2, lease_until = $3, updated_at = NOW()
       WHERE id = $1
         AND (lease_until IS NULL OR lease_until < NOW() OR lease_owner = $2)
       RETURNING id`,
      [id, ownerToken, leaseUntil],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async releaseLease(id: string, ownerToken: string): Promise<void> {
    await this.pool.query(
      `UPDATE active_checks
       SET lease_owner = NULL, lease_until = NULL
       WHERE id = $1 AND lease_owner = $2`,
      [id, ownerToken],
    );
  }

  async patchDecision(id: string, decision: 'allow' | 'deny'): Promise<void> {
    await this.pool.query(
      `UPDATE active_checks
       SET payload = jsonb_set(payload, '{pendingDecision}', to_jsonb($2::text), true),
           updated_at = NOW()
       WHERE id = $1`,
      [id, decision],
    );
  }

  async patchActionsAllowed(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE active_checks
       SET payload = jsonb_set(payload, '{actionsAllowed}', 'true'::jsonb, true),
           updated_at = NOW()
       WHERE id = $1`,
      [id],
    );
  }

  async delete(id: string): Promise<void> {
    await this.pool.query('DELETE FROM active_checks WHERE id = $1', [id]);
  }
}

class PgArchivesRepo implements CheckArchivesRepo {
  constructor(private readonly pool: Pool) {}

  async put(id: string, body: Buffer): Promise<void> {
    await this.pool.query(
      `INSERT INTO check_archives (id, body) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body`,
      [id, body],
    );
  }

  async get(id: string): Promise<Buffer | null> {
    const result = await this.pool.query<{ body: Buffer }>(
      'SELECT body FROM check_archives WHERE id = $1',
      [id],
    );
    const body = result.rows[0]?.body;
    if (!body) return null;
    return Buffer.isBuffer(body) ? body : Buffer.from(body);
  }

  async delete(id: string): Promise<void> {
    await this.pool.query('DELETE FROM check_archives WHERE id = $1', [id]);
  }
}

function readSnapshot(value: ActiveCheckSnapshot | string | undefined): ActiveCheckSnapshot | null {
  if (!value) return null;
  if (typeof value === 'string') return JSON.parse(value) as ActiveCheckSnapshot;
  return value;
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

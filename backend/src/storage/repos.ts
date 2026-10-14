import { CatalogQuery } from '../catalog/catalog-query';
import { AdminRules } from '../rules/rules';
import { CatalogCard } from '../catalog/map-row';
import { AiBlock, LighthouseBlock, ReportPayload, StaticBlock, StepSnapshot } from '../reports/report.types';

export interface StoredUser {
  login: string;
  password_hash: string;
  role: string;
}

export interface UsersRepo {
  insert(user: StoredUser): Promise<void>;
  findByLogin(login: string): Promise<StoredUser | null>;
  list(): Promise<Array<{ login: string; role: string }>>;
}

export interface CatalogRepo {
  save(rows: CatalogCard[]): Promise<void>;
  load(): Promise<CatalogCard[]>;
  refreshedAt(): Promise<string | null>;
}

export interface CatalogQueryRepo {
  get(): Promise<CatalogQuery | null>;
  set(query: CatalogQuery): Promise<void>;
}

export interface ReportListItem {
  report_id: string;
  human_id: string;
  name: string;
  created_at: string;
  owner_login: string;
  static_summary: string;
  ai_status: string;
  lighthouse_status: string;
}

export function reportListStatuses(
  payload:
    | {
        static?: { summary?: string | null } | null;
        ai?: { status?: string | null } | null;
        lighthouse?: { status?: string | null } | null;
      }
    | null
    | undefined,
): Pick<ReportListItem, 'static_summary' | 'ai_status' | 'lighthouse_status'> {
  return {
    static_summary: payload?.static?.summary ?? '',
    ai_status: payload?.ai?.status ?? '',
    lighthouse_status: payload?.lighthouse?.status ?? '',
  };
}

export interface ReportsRepo {
  insert(row: { id: string; human_id: string; owner_login: string; created_at: string; payload: ReportPayload }): Promise<void>;
  get(id: string): Promise<ReportPayload | null>;
  list(ownerLogin: string | null, now: Date): Promise<ReportListItem[]>;
  findPrevious(input: {
    humanId: string;
    before: string;
    ownerLogin: string | null;
    excludeId: string;
    now: Date;
  }): Promise<ReportPayload | null>;
}

export interface RulesRepo {
  get(): Promise<AdminRules | null>;
  set(rules: AdminRules): Promise<void>;
}

export interface CostEntry {
  provider_usage: Record<string, unknown>;
  recorded_at: string;
}

export interface CostsRepo {
  insert(entry: CostEntry): Promise<void>;
  list(): Promise<CostEntry[]>;
}

export interface SessionInsert {
  id: string;
  login: string;
  role: string;
  source: 'environment' | 'neon';
  expires_at: string;
  absolute_expires_at: string;
  password_fingerprint: string | null;
}

export interface SessionRecord {
  login: string;
  role: string;
  source: 'environment' | 'neon';
  expires_at: string;
  absolute_expires_at: string | null;
  password_fingerprint: string | null;
}

export interface SessionsRepo {
  insert(row: SessionInsert): Promise<void>;
  get(id: string): Promise<SessionRecord | null>;
  touch(id: string, expiresAt: string): Promise<void>;
  delete(id: string): Promise<void>;
  deleteByLogin(login: string): Promise<void>;
  purgeExpired(now: Date): Promise<void>;
}

export interface LoginAttemptsRepo {
  blocked(subject: string, now: number): Promise<boolean>;
  fail(subject: string, now: number): Promise<void>;
  clear(subject: string): Promise<void>;
}

export interface ActiveCheckSnapshot {
  ownerLogin: string;
  ownerRole: string;
  human_id: string;
  name: string;
  preview_image: string;
  steps: StepSnapshot[];
  static: StaticBlock | null;
  ai: AiBlock | null;
  lighthouse: LighthouseBlock | null;
  replaced_previous_stand: boolean;
  standReady: boolean;
  standUrl: string | null;
  actionsAllowed: boolean;
  reportSaved: boolean;
  aborted: boolean;
  pendingDecision: 'allow' | 'deny' | null;
  uuid?: string;
  countries?: string[];
  languages?: string[];
  lander_type_name?: string;
  catalog_status?: string;
  previewToken?: string;
}

export interface ActiveChecksRepo {
  upsert(
    id: string,
    ownerLogin: string,
    payload: ActiveCheckSnapshot,
    claim?: { owner: string; until: string },
  ): Promise<boolean>;
  get(id: string): Promise<{ owner_login: string; payload: ActiveCheckSnapshot } | null>;
  listByOwner(ownerLogin: string): Promise<Array<{ id: string; payload: ActiveCheckSnapshot }>>;
  tryClaim(id: string, ownerToken: string, leaseUntil: string): Promise<boolean>;
  releaseLease(id: string, ownerToken: string): Promise<void>;
  patchDecision(id: string, decision: 'allow' | 'deny'): Promise<void>;
  patchActionsAllowed(id: string): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface CheckArchivesRepo {
  put(id: string, body: Buffer): Promise<void>;
  get(id: string): Promise<Buffer | null>;
  delete(id: string): Promise<void>;
}

export interface Repos {
  users: UsersRepo;
  sessions: SessionsRepo;
  catalog: CatalogRepo;
  catalogQuery: CatalogQueryRepo;
  reports: ReportsRepo;
  rules: RulesRepo;
  costs: CostsRepo;
  activeChecks: ActiveChecksRepo;
  archives: CheckArchivesRepo;
  loginAttempts: LoginAttemptsRepo;
  close(): Promise<void>;
}

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
}

export interface SessionRecord {
  login: string;
  role: string;
  source: 'environment' | 'neon';
  expires_at: string;
}

export interface SessionsRepo {
  insert(row: SessionInsert): Promise<void>;
  get(id: string): Promise<SessionRecord | null>;
  touch(id: string, expiresAt: string): Promise<void>;
  delete(id: string): Promise<void>;
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
}

export interface ActiveChecksRepo {
  upsert(id: string, ownerLogin: string, payload: ActiveCheckSnapshot): Promise<void>;
  get(id: string): Promise<{ owner_login: string; payload: ActiveCheckSnapshot } | null>;
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
  close(): Promise<void>;
}

import { AdminRules } from '../rules/rules';
import { CatalogCard } from '../catalog/map-row';
import { ReportPayload } from '../reports/report.types';

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

export interface Repos {
  users: UsersRepo;
  catalog: CatalogRepo;
  reports: ReportsRepo;
  rules: RulesRepo;
  costs: CostsRepo;
  close(): Promise<void>;
}

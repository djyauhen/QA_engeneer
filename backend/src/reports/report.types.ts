import { StepName, StepState } from '../tokens';

export interface StaticFinding {
  text: string;
  file?: string;
}

export interface StaticItem {
  name: string;
  status: 'passed' | 'warning' | 'failed';
  findings: StaticFinding[];
}

export interface StaticBlock {
  summary: string | null;
  items: StaticItem[];
}

export interface AiFinding {
  file: string;
  quote: string;
  screenshot: string;
  category?: number;
  priority?: 'critical' | 'major' | 'minor';
  where?: string;
  problem?: string;
  expected?: string;
}

export interface AiGeneral {
  geo?: string;
  language?: string;
  outlet?: string;
  main_person?: string;
  offer?: string;
  currency?: string;
  min_deposit?: string;
}

export interface AiCheck {
  category: number;
  status: 'PASS' | 'FAIL' | 'N/A' | 'GAP';
  note?: string;
}

export interface AiMeta {
  instruction_sha?: string;
  images_sent?: number;
  text_truncated?: boolean;
  vision?: boolean;
  outlet_url?: string | null;
  fact_source?: string | null;
  fx_date?: string | null;
  person_from_name?: string | null;
  person_from_text?: string | null;
  person_conflict?: boolean;
}

export interface AiBlock {
  status: string;
  findings: AiFinding[];
  decision: 'allow' | 'deny' | null;
  mode?: 'stub' | 'real';
  schema_version?: 2;
  report_markdown?: string;
  general?: AiGeneral;
  checks?: AiCheck[];
  clarifications?: string[];
  meta?: AiMeta;
}

export interface LighthouseMetrics {
  performance_score: number | null;
  first_contentful_paint: number | null;
  largest_contentful_paint: number | null;
  total_blocking_time: number | null;
  cumulative_layout_shift: number | null;
  speed_index: number | null;
  time_to_interactive: number | null;
  screenshot?: string | null;
}

export interface LighthouseBlock {
  status: string;
  mobile: LighthouseMetrics | null;
  desktop: LighthouseMetrics | null;
  mode?: 'stub' | 'real';
}

export interface StepSnapshot {
  name: StepName;
  state: StepState;
  message?: string;
}

export interface ReportPayload {
  report_id: string;
  human_id: string;
  name: string;
  owner_login: string;
  created_at: string;
  countries: string[];
  languages: string[];
  steps: StepSnapshot[];
  static: StaticBlock | null;
  ai: AiBlock | null;
  lighthouse: LighthouseBlock | null;
  replaced_previous_stand: boolean;
}

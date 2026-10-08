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
}

export interface AiBlock {
  status: string;
  findings: AiFinding[];
  decision: 'allow' | 'deny' | null;
}

export interface LighthouseMetrics {
  performance_score: number | null;
  first_contentful_paint: number | null;
  largest_contentful_paint: number | null;
  total_blocking_time: number | null;
  cumulative_layout_shift: number | null;
  speed_index: number | null;
  time_to_interactive: number | null;
}

export interface LighthouseBlock {
  status: string;
  mobile: LighthouseMetrics | null;
  desktop: LighthouseMetrics | null;
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

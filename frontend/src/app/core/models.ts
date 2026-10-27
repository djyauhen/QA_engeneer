export const ROLE_TL = 'ТЛ';
export const ROLE_QA = 'QA';
export type Role = typeof ROLE_TL | typeof ROLE_QA;

export const LOGIN_ERROR = 'Неверный логин или пароль.';
export const NOT_IN_CATALOG = 'Этого human_id нет среди последних 300 лендов. Скачивание не начато.';
export const COLLISION_TEXT = 'Несколько записей с одним human_id. Выбор не делается. Скачивание не начато.';
export const REPLACED_STAND = 'Предыдущий просмотр этого пользователя заменён.';
export const AI_GATE_TEXT = 'Есть критичные находки статики (failed). ИИ сам не стартовал.';
export const STRUCTURE_FAILED_TEXT = 'Проверка структуры не пройдена. Остальные статические пункты не запускались.';
export const STRUCTURE_NAME = 'Проверка структуры';
export const RECOMMENDATION = 'Отчёт рекомендательный. Решение принимаете вы.';
export const NO_PREVIOUS = 'Прошлого отчёта этого human_id нет.';
export const STAND_URL_CAPTION = 'Временный адрес. В отчёт он не сохраняется.';
export const STAND_BEFORE_ACTIONS = 'Ленд сам ничего не выполняет: нет отправки лидов и нет сторонних пикселей.';
export const NO_USAGE = 'Провайдер модели не вернул учёт использования.';
export const NO_HISTORY = 'История изменений не ведётся.';
export const DUPLICATE_LOGIN = 'Такой логин уже есть.';
export const ENV_ACCOUNT = 'Задана окружением';
export const ACCESS_DENIED = 'Недостаточно прав';
export const CATALOG_STATUS_CAPTION = 'Статус в каталоге. Это не вердикт проверки.';
export const PREVIEW_CAPTION = 'Превью каталога. Это не скриншот стенда.';
export const EMPTY_CATALOG = 'В каталоге нет лендов.';
export const EMPTY_SEARCH = 'Ничего не найдено.';
export const STATIC_SUMMARY_FAILED = 'есть failed';

export const STEP_LABELS: Record<StepName, string> = {
  catalog: 'Поиск в каталоге',
  download_request: 'Запрос скачивания',
  notifications: 'Ожидание уведомления',
  download_file: 'Скачивание архива',
  unpack: 'Распаковка',
  static: 'Статические проверки',
  ai_gate: 'Решение по ИИ',
  stand: 'Стенд',
  ai: 'ИИ',
  lighthouse: 'Lighthouse',
  report: 'Отчёт',
};

export type StepName =
  | 'catalog'
  | 'download_request'
  | 'notifications'
  | 'download_file'
  | 'unpack'
  | 'static'
  | 'ai_gate'
  | 'stand'
  | 'ai'
  | 'lighthouse'
  | 'report';

export type StepState = 'pending' | 'running' | 'retrying' | 'waiting_user' | 'done' | 'failed' | 'skipped';

export interface StepSnapshot {
  name: StepName;
  state: StepState;
  message?: string;
}

export interface CatalogItem {
  uuid: string;
  human_id: string;
  name: string;
  created_at: string;
  countries?: string[];
  languages?: string[];
  lander_type_name?: string;
  status?: string;
  preview_image?: string;
  mvt_settings?: string;
}

export interface CatalogModeFilter {
  key: 'mode';
  operator: 'in';
  value: string[];
}

export interface CatalogQuery {
  search: string;
  filters: CatalogModeFilter[];
  dates: [string, string, string] | null;
}

export interface CatalogPayload {
  items: CatalogItem[];
  refreshed_at: string | null;
  query: CatalogQuery;
}

export interface StaticFinding {
  text: string;
  file?: string;
  path?: string;
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
  file?: string;
  path?: string;
  quote?: string;
  screenshot?: string;
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
  status: 'PASS' | 'FAIL' | 'N/A';
  note?: string;
}

export interface AiMeta {
  instruction_sha?: string;
  images_sent?: number;
  text_truncated?: boolean;
  vision?: boolean;
  outlet_url?: string | null;
  person_from_name?: string | null;
  person_from_text?: string | null;
  person_conflict?: boolean;
}

export interface AiBlock {
  status: string;
  findings: AiFinding[];
  decision: 'allow' | 'deny' | null;
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
}

export interface LighthouseBlock {
  status: string;
  mobile: LighthouseMetrics | null;
  desktop: LighthouseMetrics | null;
}

export interface CheckView {
  check_id: string;
  human_id: string;
  name: string;
  owner_login: string;
  replaced_previous_stand: boolean;
  steps: StepSnapshot[];
  static: StaticBlock | null;
  ai: AiBlock | null;
  lighthouse: LighthouseBlock | null;
  preview_image?: string;
  stand_url?: string;
  actions_allowed?: boolean;
  countries?: string[];
  languages?: string[];
  lander_type_name?: string;
  catalog_status?: string;
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
  replaced_previous_stand?: boolean;
  lander_type_name?: string;
  status?: string;
}

export interface ReportListItem {
  report_id: string;
  human_id: string;
  name: string;
  created_at: string;
  owner_login?: string;
  static_summary?: string;
  ai_status?: string;
  lighthouse_status?: string;
}

export interface ReportRow extends ReportListItem {
  staticSummary: string;
  aiStatus: string;
  lhStatus: string;
}

export interface AdminRules {
  allowed_external_prefixes: string[];
  forbidden_macros: string[];
  forbidden_script_markers: string[];
  image_warning_kb: number;
  image_failed_kb: number;
  css_ok_kb: number;
  css_failed_kb: number;
  inline_script_max_nonempty_lines: number;
  expectFormMacro: boolean;
  languages_override: string[];
}

export interface UserRow {
  login: string;
  role: string;
  source: 'environment' | 'neon';
}

export interface ReportBody {
  name: string;
  human_id: string;
  countries: string[];
  languages: string[];
  created_at: string;
  lander_type_name: string;
  catalog_status: string;
  static: StaticBlock | null;
  ai: AiBlock | null;
  ai_note?: string;
  lighthouse: LighthouseBlock | null;
}

export const LH_METRICS: Array<{ key: keyof LighthouseMetrics; label: string }> = [
  { key: 'performance_score', label: 'Оценка производительности' },
  { key: 'first_contentful_paint', label: 'Первая отрисовка' },
  { key: 'largest_contentful_paint', label: 'Крупнейшая отрисовка' },
  { key: 'total_blocking_time', label: 'Время блокировки' },
  { key: 'cumulative_layout_shift', label: 'Смещение вёрстки' },
  { key: 'speed_index', label: 'Индекс скорости' },
  { key: 'time_to_interactive', label: 'Время до интерактива' },
];

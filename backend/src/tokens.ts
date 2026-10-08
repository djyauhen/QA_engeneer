export const APP_CONFIG = 'APP_CONFIG';
export const RUNTIME = 'RUNTIME';
export const USERS_REPO = 'USERS_REPO';
export const CATALOG_REPO = 'CATALOG_REPO';
export const REPORTS_REPO = 'REPORTS_REPO';
export const RULES_REPO = 'RULES_REPO';
export const COSTS_REPO = 'COSTS_REPO';

export const CATALOG_REFRESH_MS = 10 * 60 * 1000;
export const PART_ATTEMPTS = 3;
export const CATALOG_LIMIT = 300;
export const AIO_PAGE_LIMIT = 50;

/** Stub metric id. Not a live metric uuid from an AIO capture. */
export const METRIC_STUB = '00000000-0000-4000-8000-000000000000';

export const STEP_NAMES = [
  'catalog',
  'download_request',
  'notifications',
  'download_file',
  'unpack',
  'static',
  'ai_gate',
  'stand',
  'ai',
  'lighthouse',
  'report',
] as const;

export type StepName = (typeof STEP_NAMES)[number];

export type StepState =
  | 'pending'
  | 'running'
  | 'retrying'
  | 'waiting_user'
  | 'done'
  | 'failed'
  | 'skipped';

export const AI_STATUS_READY = 'Список готов';
export const AI_STATUS_WAITING = 'не запускался (ждут решения пользователя)';
export const AI_STATUS_ERROR = 'ошибка после повторов';

export const LH_STATUS_DONE = 'выполнен';
export const LH_STATUS_ERROR = 'ошибка после повторов';

export const STATIC_SUMMARY_FAILED = 'есть failed';
export const STATIC_SUMMARY_WARNING = 'только warning';
export const STATIC_SUMMARY_PASSED = 'все passed';
export const STATIC_SUMMARY_INCOMPLETE = 'проверка не завершилась';

export const LOGIN_REFUSED = 'Отказ во входе';
export const FORBIDDEN_BODY = {
  error: 'forbidden',
  message: 'Недостаточно прав',
} as const;

import type { AiFinding, LighthouseMetricKey, LighthouseMetrics, StaticFinding, StepSnapshot } from './models';

/**
 * Business zone for clocks a person reads (reports, catalog refresh, lists).
 * Europe/Minsk is Belarus: a fixed UTC+3 offset, with no daylight saving time.
 * Persistence stays UTC instants; this zone is for display only.
 */
export const BUSINESS_TIME_ZONE = 'Europe/Minsk';

const INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2})/i;
const NAIVE_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const minskClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * User-visible `DD.MM.YYYY HH:mm` in Europe/Minsk.
 * Instants with `Z` or `±hh:mm` are converted. Naive datetimes and `YYYY-MM-DD`
 * stay as written so catalog period wall clocks are not shifted.
 */
export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '';
  const instant = instantInMinsk(value);
  if (instant === 'invalid') return value;
  if (instant) return instant;
  const withTime = NAIVE_DATE_TIME.exec(value);
  if (withTime) {
    return `${withTime[3]}.${withTime[2]}.${withTime[1]} ${withTime[4]}:${withTime[5]}`;
  }
  const dateOnly = DATE_ONLY.exec(value);
  if (dateOnly) return `${dateOnly[3]}.${dateOnly[2]}.${dateOnly[1]}`;
  return value;
}

function instantInMinsk(value: string): string | 'invalid' | null {
  const match = INSTANT.exec(value);
  if (!match) return null;
  const year = match[1];
  const month = match[2];
  const day = match[3];
  const hour = match[4];
  const minute = match[5];
  const second = match[6] ?? '00';
  const fraction = match[7] ? `.${match[7]}` : '';
  const zone = match[8];
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}${fraction}${zone}`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'invalid';
  return formatInMinsk(date);
}

function formatInMinsk(date: Date): string {
  const parts = minskClock.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  const hour = pick('hour') === '24' ? '00' : pick('hour');
  return `${pick('day')}.${pick('month')}.${pick('year')} ${hour}:${pick('minute')}`;
}

export function joinList(value: string[] | undefined): string {
  if (!value || value.length === 0) return '';
  return value.join(', ');
}

export function findingPath(finding: StaticFinding | AiFinding): string {
  const path = 'path' in finding && typeof finding.path === 'string' ? finding.path : '';
  const file = typeof finding.file === 'string' ? finding.file : '';
  return path || file;
}

export function completeAiCard(finding: AiFinding): { path: string; quote: string; screenshot: string } | null {
  const path = findingPath(finding).trim();
  const quote = typeof finding.quote === 'string' ? finding.quote.trim() : '';
  const screenshot = typeof finding.screenshot === 'string' ? finding.screenshot.trim() : '';
  if (!path || !quote || !screenshot) return null;
  return { path, quote, screenshot };
}

const QA_CATEGORY_LABELS: Record<number, string> = {
  1: 'GEO и локализация',
  2: 'Соответствие шапки и футера оригиналу',
  3: 'Данные главного персонажа',
  4: 'Соответствие персонажа GEO',
  5: 'Валюта минимального депозита',
  6: 'Размер минимального депозита',
  7: 'Единство оффера',
  8: 'Актуальность дат',
  9: 'Комментарии',
  10: 'Внутренняя согласованность контента',
  11: 'Телефонный код формы',
};

export function qaCategoryLabel(n: number): string {
  return QA_CATEGORY_LABELS[n] ?? `Критерий ${n}`;
}

export function qaStatusText(status: string): string {
  if (status === 'PASS') return 'проверено, ошибок нет';
  if (status === 'FAIL') return 'подтверждена ошибка';
  if (status === 'N/A') return 'проверить нельзя';
  if (status === 'GAP') return 'проверка не выполнена';
  return status;
}

export function qaStatusKey(status: string): string {
  if (status === 'PASS') return 'pass';
  if (status === 'FAIL') return 'fail';
  if (status === 'N/A') return 'na';
  if (status === 'GAP') return 'gap';
  return '';
}

export function qaPriorityText(priority: string): string {
  if (priority === 'critical') return 'Critical';
  if (priority === 'major') return 'Major';
  if (priority === 'minor') return 'Minor';
  return priority;
}

export function isSignedUrl(value: string): boolean {
  return /signature=|expires=|[?&]token=/i.test(value);
}

const IMAGE_EXT = /\.(apng|avif|bmp|gif|jpe?g|png|svg|webp)(?:$|[?#])/i;

export function isImageSource(value: string): boolean {
  return value.startsWith('data:image/') || IMAGE_EXT.test(value);
}

/**
 * Source for a Lighthouse thumb. Accepts a data URL (even when the payload
 * happens to contain a signed-url marker), raw image base64, an http(s) or
 * blob URL, and `{ data, width, height }`.
 */
export function lighthouseImageSrc(value: unknown): string | null {
  return readLighthouseImage(value, 0);
}

function readLighthouseImage(value: unknown, depth: number): string | null {
  if (depth > 4 || value == null) return null;
  if (typeof value === 'string') return lighthouseImageFromString(value);
  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const found = readLighthouseImage(value[index], depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === 'object') {
    const record = value as { data?: unknown; screenshot?: unknown };
    return readLighthouseImage(record.data, depth + 1) ?? readLighthouseImage(record.screenshot, depth + 1);
  }
  return null;
}

function lighthouseImageFromString(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^data:image\//i.test(trimmed)) return trimmed;
  if (/^blob:/i.test(trimmed)) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return isSignedUrl(trimmed) ? null : trimmed;
  const compact = trimmed.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const mime = mimeForImageBase64(compact);
  if (!mime) return null;
  return `data:${mime};base64,${compact}`;
}

function mimeForImageBase64(value: string): string | null {
  if (value.startsWith('/9j/')) return 'image/jpeg';
  if (value.startsWith('iVBORw0KGgo')) return 'image/png';
  if (value.startsWith('R0lGOD')) return 'image/gif';
  if (value.startsWith('UklGR')) return 'image/webp';
  return null;
}

export function scrubSignedUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s]+/gi, (url) => (isSignedUrl(url) ? '[ссылка скрыта]' : url));
}

const NO_METRIC = 'нет данных';

const TIMING_METRIC = new Set<LighthouseMetricKey>([
  'first_contentful_paint',
  'largest_contentful_paint',
  'total_blocking_time',
  'speed_index',
  'time_to_interactive',
]);

export function formatMetric(value: number | null | undefined, key?: LighthouseMetricKey): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_METRIC;
  if (key === 'performance_score') {
    const score = value >= 0 && value <= 1 ? value * 100 : value;
    return `${Math.round(score)}%`;
  }
  if (key && TIMING_METRIC.has(key)) {
    if (Math.abs(value) >= 1000) return `${trimTenths(value / 1000)} с`;
    return `${trimTenths(value)} мс`;
  }
  return trimThousandths(value);
}

function trimTenths(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function trimThousandths(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded);
}

export function metricValue(metrics: LighthouseMetrics | null, key: LighthouseMetricKey): string {
  if (!metrics) return NO_METRIC;
  return formatMetric(metrics[key], key);
}

export function shouldPoll(steps: StepSnapshot[]): boolean {
  const report = steps.find((step) => step.name === 'report');
  if (report?.state === 'done' || report?.state === 'failed') return false;
  return steps.some(
    (step) =>
      step.state === 'running' ||
      step.state === 'retrying' ||
      step.state === 'waiting_user' ||
      step.state === 'pending',
  );
}

export function errorText(error: unknown, fallback: string): string {
  const status = readStatus(error);
  const body = readErrorBody(error);
  const message = typeof body?.['message'] === 'string' ? body['message'] : '';
  const code = typeof body?.['error'] === 'string' ? body['error'] : '';
  if (status === 401 || code === 'unauthorized') return 'Сессия закончилась. Войдите снова.';
  if (status === 403 || code === 'forbidden') return 'Недостаточно прав';
  const raw = message || (code && code !== 'forbidden' ? code : '') || fallback;
  return scrubSignedUrls(raw);
}

function readStatus(error: unknown): number {
  if (typeof error !== 'object' || error === null || !('status' in error)) return 0;
  const status = (error as { status: unknown }).status;
  return typeof status === 'number' ? status : 0;
}

function readErrorBody(error: unknown): Record<string, unknown> | null {
  if (typeof error !== 'object' || error === null || !('error' in error)) return null;
  const body = (error as { error: unknown }).error;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

export function inputValue(event: Event): string {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return target.value;
  }
  return '';
}

export function linesToList(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function listToLines(value: string[]): string {
  return value.join('\n');
}

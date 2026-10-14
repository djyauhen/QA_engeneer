import type { AiFinding, LighthouseMetrics, StaticFinding, StepSnapshot } from './models';

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

export function isSignedUrl(value: string): boolean {
  return /signature=|expires=|[?&]token=/i.test(value);
}

const IMAGE_EXT = /\.(apng|avif|bmp|gif|jpe?g|png|svg|webp)(?:$|[?#])/i;

export function isImageSource(value: string): boolean {
  return value.startsWith('data:image/') || IMAGE_EXT.test(value);
}

export function scrubSignedUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s]+/gi, (url) => (isSignedUrl(url) ? '[ссылка скрыта]' : url));
}

const NO_METRIC = 'нет данных';

const TIMING_METRIC = new Set<keyof LighthouseMetrics>([
  'first_contentful_paint',
  'largest_contentful_paint',
  'total_blocking_time',
  'speed_index',
  'time_to_interactive',
]);

export function formatMetric(value: number | null | undefined, key?: keyof LighthouseMetrics): string {
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

export function metricValue(metrics: LighthouseMetrics | null, key: keyof LighthouseMetrics): string {
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

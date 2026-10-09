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

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function isImageSource(value: string): boolean {
  return value.startsWith('data:image/') || isHttpUrl(value) || /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(value);
}

export function scrubSignedUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s]+/gi, (url) => (isSignedUrl(url) ? '[ссылка скрыта]' : url));
}

export function formatMetric(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '';
  return String(value);
}

export function metricValue(metrics: LighthouseMetrics | null, key: keyof LighthouseMetrics): string {
  if (!metrics) return '';
  return formatMetric(metrics[key]);
}

export function shouldPoll(steps: StepSnapshot[]): boolean {
  if (steps.some((step) => step.state === 'running' || step.state === 'retrying' || step.state === 'waiting_user')) {
    return true;
  }
  const report = steps.find((step) => step.name === 'report');
  if (report?.state === 'done' || report?.state === 'failed') return false;
  if (steps.some((step) => step.state === 'failed')) return false;
  return steps.some((step) => step.state === 'pending');
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

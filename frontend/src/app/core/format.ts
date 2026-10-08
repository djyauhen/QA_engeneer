import { AiFinding, LighthouseMetrics, StaticFinding, StepSnapshot } from './models';

/** Day, month, year and time as written in the string. No timezone conversion. */
export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '';
  const withTime = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value);
  if (withTime) {
    return `${withTime[3]}.${withTime[2]}.${withTime[1]} ${withTime[4]}:${withTime[5]}`;
  }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) return `${dateOnly[3]}.${dateOnly[2]}.${dateOnly[1]}`;
  return value;
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

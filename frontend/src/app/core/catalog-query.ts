import { formatTimestamp } from './format';
import { CatalogQuery } from './models';

/** Wall-clock text only. No Date parsing, so the clock is not shifted into another zone. */
export function apiDateToDatetimeLocal(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?/.exec(value.trim());
  if (!match) return '';
  return `${match[1]}T${match[2]}:${match[3] ?? '00'}`;
}

/** datetime-local value to `YYYY-MM-DD HH:mm:ss`, without applying a timezone offset. */
export function datetimeLocalToApiDate(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?(?:\.\d+)?$/.exec(value.trim());
  if (!match) return null;
  return `${match[1]} ${match[2]}:${match[3] ?? '00'}`;
}

export function catalogModeValues(query: CatalogQuery): string[] {
  const values: string[] = [];
  for (const filter of query.filters) {
    if (filter.key !== 'mode' || filter.operator !== 'in') continue;
    for (const value of filter.value) {
      const trimmed = value.trim();
      if (trimmed) values.push(trimmed);
    }
  }
  return values;
}

export function normalizeCatalogQuery(value: unknown): CatalogQuery {
  const record = isRecord(value) ? value : {};
  const search = typeof record['search'] === 'string' ? record['search'] : '';
  return {
    search,
    filters: normalizeModeFilters(record['filters']),
    dates: normalizeDates(record['dates']),
  };
}

export function catalogSourceLine(query: CatalogQuery): string {
  const parts: string[] = [];
  const search = query.search.trim();
  if (search) parts.push(`поиск «${search}»`);
  const modes = catalogModeValues(query);
  if (modes.length > 0) parts.push(`режимы ${modes.join(', ')}`);
  const period = periodPart(query.dates);
  if (period) parts.push(period);
  if (parts.length === 0) return 'Последние 300 лендов AIO';
  return parts[0].charAt(0).toUpperCase() + parts[0].slice(1) + (parts.length > 1 ? `, ${parts.slice(1).join(', ')}` : '');
}

function periodPart(dates: [string, string, string] | null): string {
  if (!dates) return '';
  const from = formatTimestamp(dates[0]);
  const to = formatTimestamp(dates[1]);
  const zone = dates[2].trim();
  const range = [from, to].filter((part) => part.length > 0).join(' — ');
  const text = [range, zone].filter((part) => part.length > 0).join(', ');
  return text ? `период ${text}` : '';
}

function normalizeModeFilters(value: unknown): CatalogQuery['filters'] {
  if (!Array.isArray(value)) return [];
  const filters: CatalogQuery['filters'] = [];
  for (const item of value) {
    if (!isRecord(item) || item['key'] !== 'mode' || item['operator'] !== 'in' || !Array.isArray(item['value'])) continue;
    const modes = item['value'].filter((mode): mode is string => typeof mode === 'string' && mode.trim().length > 0);
    if (modes.length === 0) continue;
    filters.push({ key: 'mode', operator: 'in', value: modes.map((mode) => mode.trim()) });
  }
  return filters;
}

function normalizeDates(value: unknown): [string, string, string] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  if (!value.every((part) => typeof part === 'string')) return null;
  return [value[0], value[1], value[2]];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

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

const QUERY_KEYS = new Set(['search', 'filters', 'dates']);
const FILTER_KEYS = new Set(['key', 'operator', 'value']);
const DATE_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const TIME_ZONE = /^[A-Za-z0-9_/+-]{1,64}$/;

export class CatalogQueryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogQueryValidationError';
  }
}

export function defaultCatalogQuery(): CatalogQuery {
  return { search: '', filters: [], dates: null };
}

export function cloneCatalogQuery(query: CatalogQuery): CatalogQuery {
  return {
    search: query.search,
    filters: query.filters.map((filter) => ({
      key: 'mode',
      operator: 'in',
      value: [...filter.value],
    })),
    dates: query.dates === null ? null : [query.dates[0], query.dates[1], query.dates[2]],
  };
}

export function effectiveCatalogQuery(stored: CatalogQuery | null): CatalogQuery {
  return stored ? cloneCatalogQuery(stored) : defaultCatalogQuery();
}

export function parseCatalogQuery(body: unknown): CatalogQuery {
  if (!isRecord(body)) fail('Тело запроса должно быть объектом');
  for (const key of Object.keys(body)) {
    if (!QUERY_KEYS.has(key)) fail('Неизвестное поле запроса каталога');
  }
  if (!Object.prototype.hasOwnProperty.call(body, 'search')) fail('Поле search обязательно');
  if (!Object.prototype.hasOwnProperty.call(body, 'filters')) fail('Поле filters обязательно');
  if (!Object.prototype.hasOwnProperty.call(body, 'dates')) fail('Поле dates обязательно');
  return {
    search: parseSearch(body.search),
    filters: parseFilters(body.filters),
    dates: parseDates(body.dates),
  };
}

function parseSearch(value: unknown): string {
  if (typeof value !== 'string') fail('Поле search должно быть строкой');
  const search = value.trim();
  if (search.length > 200) fail('Поле search длиннее 200 символов');
  return search;
}

function parseFilters(value: unknown): CatalogModeFilter[] {
  if (!Array.isArray(value)) fail('Поле filters должно быть массивом');
  if (value.length > 1) fail('В filters допускается не больше одного фильтра');
  if (value.length === 0) return [];
  const raw = value[0];
  if (!isRecord(raw)) fail('Фильтр задан неверно');
  for (const key of Object.keys(raw)) {
    if (!FILTER_KEYS.has(key)) fail('У фильтра допустимы только поля key, operator и value');
  }
  if (raw.key !== 'mode') fail('Допустим только фильтр mode');
  if (raw.operator !== 'in') fail('У фильтра mode допустим только оператор in');
  if (!Array.isArray(raw.value) || raw.value.length === 0) {
    fail('Значение фильтра mode должно быть непустым списком строк');
  }
  if (raw.value.length > 10) fail('В фильтре mode не больше 10 значений');
  const items: string[] = [];
  for (const item of raw.value) {
    if (typeof item !== 'string') fail('Значение фильтра mode должно быть непустым списком строк');
    if (item !== item.trim()) fail('Значение mode не должно содержать пробелы по краям');
    if (item.length < 1 || item.length > 64) fail('Каждое значение mode — от 1 до 64 символов');
    items.push(item);
  }
  return [{ key: 'mode', operator: 'in', value: items }];
}

function parseDates(value: unknown): [string, string, string] | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length !== 3 || value.some((part) => typeof part !== 'string')) {
    fail('Поле dates должно быть null или тройкой строк: начало, конец и часовой пояс');
  }
  const [start, end, zone] = value as [string, string, string];
  if (!DATE_TIME.test(start) || !DATE_TIME.test(end)) {
    fail('Начало и конец dates задаются как YYYY-MM-DD HH:mm:ss');
  }
  if (start > end) fail('Начало dates позже конца');
  if (!TIME_ZONE.test(zone)) fail('Часовой пояс dates задан неверно');
  return [start, end, zone];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function fail(message: string): never {
  throw new CatalogQueryValidationError(message);
}

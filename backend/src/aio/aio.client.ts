import { CatalogQuery, defaultCatalogQuery } from '../catalog/catalog-query';
import { AIO_PAGE_LIMIT, CATALOG_LIMIT, METRIC_STUB } from '../tokens';
import { AppConfig } from '../config';

export interface AioPage {
  rows: unknown[];
  next: boolean;
}

export interface OriginalFile {
  read(): Promise<Buffer>;
}

export class AioDownloadError extends Error {
  readonly status: number | null;
  readonly permanent: boolean;

  constructor(kind: 'http' | 'network' | 'body', status: number | null = null) {
    const message =
      kind === 'http' && status !== null
        ? `Сбой скачивания файла: HTTP ${status}`
        : kind === 'body'
          ? 'Сбой скачивания файла: обрыв тела'
          : 'Сбой скачивания файла: сеть';
    super(message);
    this.name = 'AioDownloadError';
    this.status = status;
    this.permanent =
      kind === 'body' ||
      (kind === 'http' && status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429);
  }
}

export abstract class AioClient {
  abstract loadCatalogRows(query?: CatalogQuery): Promise<unknown[]>;
  abstract requestDownload(uuid: string): Promise<void>;
  abstract findOriginal(uuid: string): Promise<OriginalFile>;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function buildTablesBody(page: number, query: CatalogQuery = defaultCatalogQuery()): Record<string, unknown> {
  const filters = query.filters.map((filter) => ({
    key: filter.key,
    operator: filter.operator,
    value: [...filter.value],
  }));
  return {
    request: {
      'Funnel\\Landers': {
        table: 'Funnel\\Landers',
        page,
        limit: AIO_PAGE_LIMIT,
        search: query.search,
        sort_key: '_identity',
        sort_direction: 'desc',
        analytics_position: 1,
        filters,
        ...(query.dates === null ? {} : { dates: [query.dates[0], query.dates[1], query.dates[2]] }),
        hide_empty_metrics: false,
        show_empty_fields: false,
        hide_bots: true,
        unwrap_tree: false,
        hide_trash: true,
        event_time_attribution: false,
        back_fix_attribution: false,
        metric_filters: [],
        metric_definition: null,
        metric_definitions: [],
        meta_spend_attribution_engine_level: 'campaign',
        metrics: [METRIC_STUB],
      },
    },
  };
}

export async function collectCatalogRows(
  fetchPage: (page: number) => Promise<AioPage>,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let page = 1; rows.length < CATALOG_LIMIT; page += 1) {
    const batch = await fetchPage(page);
    if (!batch.rows || batch.rows.length === 0) break;
    rows.push(...batch.rows);
    if (batch.next === false) break;
  }
  return rows.slice(0, CATALOG_LIMIT);
}

export function assertAioHeaders(headers: HeadersInit | undefined): void {
  const bag = new Map<string, string>();
  if (headers instanceof Headers) {
    headers.forEach((value, key) => bag.set(key.toLowerCase(), value));
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) bag.set(key.toLowerCase(), value);
  } else if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === 'string') bag.set(key.toLowerCase(), value);
    }
  }
  if (bag.has('authorization') || bag.has('cookie') || bag.has('x-tenant-id')) {
    throw new Error('Сбой вызова AIO');
  }
}

export class HttpAioClient extends AioClient {
  constructor(
    private readonly config: AppConfig,
    private readonly fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  ) {
    super();
  }

  async loadCatalogRows(query: CatalogQuery = defaultCatalogQuery()): Promise<unknown[]> {
    return collectCatalogRows((page) => this.fetchPage(page, query));
  }

  async requestDownload(uuid: string): Promise<void> {
    const url = this.withToken('/api/v1/actions/process');
    const form = new FormData();
    form.append('action', 'Lander\\Download');
    form.append('repository', 'Eloquent\\LanderRepository');
    form.append('arguments[is_archived]', 'true');
    form.append('uuids[0]', uuid);
    const response = await this.call(url, { method: 'POST', body: form, headers: { accept: 'application/json' } });
    const body = (await response.json()) as {
      messages?: Array<{ message?: string }>;
      primary?: string;
      uuid?: string;
    };
    const requested = (body.messages ?? []).some((item) => item.message === 'Download Requested');
    const echoed = body.primary === uuid || body.uuid === uuid;
    if (!requested || !echoed) {
      throw new Error('Сбой вызова AIO');
    }
  }

  async findOriginal(uuid: string): Promise<OriginalFile> {
    const fileUrl = await this.pollOriginalUrl(uuid);
    return {
      read: () => this.downloadFile(fileUrl),
    };
  }

  private async fetchPage(page: number, query: CatalogQuery): Promise<AioPage> {
    const url = this.withToken('/api/v1/tables/data');
    const response = await this.call(url, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(buildTablesBody(page, query)),
    });
    const body = (await response.json()) as Record<string, unknown>;
    const table = readTable(body);
    const rows = Array.isArray(table.rows) ? table.rows : [];
    const next = table.next === true;
    return { rows, next };
  }

  private async pollOriginalUrl(uuid: string): Promise<string> {
    const polls = this.config.aioNotifyPollsPerAttempt;
    for (let i = 0; i < polls; i += 1) {
      const url = await this.scanNotifications(uuid);
      if (url) return url;
      if (i < polls - 1) {
        await delay(this.config.aioNotifyPollMs);
      }
    }
    throw new Error('Сбой вызова AIO');
  }

  private async scanNotifications(uuid: string): Promise<string | null> {
    const url = this.withToken('/api/v1/notifications');
    url.searchParams.set('limit', '25');
    url.searchParams.set('page', '1');
    url.searchParams.set('unread_only', 'false');
    const response = await this.call(url.toString(), {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    const body = (await response.json()) as unknown;
    const items = readNotifications(body);
    for (const item of items) {
      const notification = (item.notification ?? item) as Record<string, unknown>;
      if (notification.type !== 'lander.download') continue;
      const payload = notification.payload as Record<string, unknown> | undefined;
      if (!payload) continue;
      if (payload.lander_uuid !== uuid || payload.status !== 'done') continue;
      const files = Array.isArray(payload.files) ? payload.files : [];
      const original = files.find((file) => {
        const row = file as Record<string, unknown>;
        return row.kind === 'original' && typeof row.url === 'string' && row.url.length > 0;
      }) as Record<string, unknown> | undefined;
      if (original && typeof original.url === 'string') return original.url;
    }
    return null;
  }

  private async downloadFile(fileUrl: string): Promise<Buffer> {
    const headers = { accept: 'application/octet-stream' };
    assertAioHeaders(headers);
    const href = signedStorageUrl(fileUrl) ? fileUrl : withDownloadToken(fileUrl, this.config.aioToken);
    let response: Response;
    try {
      response = await this.fetchImpl(href, { method: 'GET', headers });
    } catch {
      throw new AioDownloadError('network');
    }
    if (!response.ok) throw new AioDownloadError('http', response.status);
    try {
      return Buffer.from(await response.arrayBuffer());
    } catch {
      throw new AioDownloadError('body');
    }
  }

  private withToken(pathname: string): URL {
    const url = new URL(pathname, this.config.aioBaseUrl);
    url.searchParams.set('token', this.config.aioToken);
    return url;
  }

  private async call(url: string | URL, init: RequestInit): Promise<Response> {
    assertAioHeaders(init.headers);
    const href = typeof url === 'string' ? url : url.toString();
    try {
      const response = await this.fetchImpl(href, init);
      if (!response.ok) throw new Error('status');
      return response;
    } catch {
      throw new Error('Сбой вызова AIO');
    }
  }
}

function readTable(body: Record<string, unknown>): { rows?: unknown[]; next?: boolean } {
  const funnel = body['Funnel\\Landers'];
  if (!funnel || typeof funnel !== 'object') return {};
  const response = (funnel as Record<string, unknown>).response;
  if (!response || typeof response !== 'object') return {};
  return response as { rows?: unknown[]; next?: boolean };
}

function readNotifications(body: unknown): Array<Record<string, unknown>> {
  if (!body || typeof body !== 'object') return [];
  const data = (body as Record<string, unknown>).data;
  if (!data || typeof data !== 'object') return [];
  const rows = (data as Record<string, unknown>).data;
  if (!Array.isArray(rows)) return [];
  return rows.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object');
}

function signedStorageUrl(fileUrl: string): boolean {
  try {
    const url = new URL(fileUrl);
    return url.searchParams.has('signature') && url.searchParams.has('expires');
  } catch {
    return false;
  }
}

function withDownloadToken(fileUrl: string, token: string): string {
  const url = new URL(fileUrl);
  url.searchParams.set('token', token);
  return url.toString();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

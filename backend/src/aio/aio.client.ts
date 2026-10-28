import { CatalogQuery, defaultCatalogQuery } from '../catalog/catalog-query';
import { AIO_PAGE_LIMIT, CATALOG_LIMIT } from '../tokens';
import { AppConfig, previewLinkConfigured } from '../config';

export interface AioPage {
  rows: unknown[];
  next: boolean;
}

export interface OriginalFile {
  read(signal?: AbortSignal): Promise<Buffer>;
}

export class AioDownloadError extends Error {
  readonly status: number | null;
  readonly permanent: boolean;

  constructor(kind: 'http' | 'network' | 'body' | 'rejected', status: number | null = null) {
    const message =
      kind === 'http' && status !== null
        ? `Сбой скачивания файла: HTTP ${status}`
        : kind === 'body'
          ? 'Сбой скачивания файла: обрыв тела'
          : kind === 'rejected'
            ? 'Сбой скачивания файла: адрес отклонён'
            : 'Сбой скачивания файла: сеть';
    super(message);
    this.name = 'AioDownloadError';
    this.status = status;
    this.permanent =
      kind === 'body' ||
      kind === 'rejected' ||
      (kind === 'http' && status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429);
  }
}

const MAX_DOWNLOAD_BYTES = 80 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;

export abstract class AioClient {
  abstract loadCatalogRows(query?: CatalogQuery): Promise<unknown[]>;
  abstract requestDownload(uuid: string): Promise<void>;
  abstract findOriginal(uuid: string): Promise<OriginalFile>;
  /** Readable Landing Preview Link, or null when the three preview UUIDs are not configured. */
  abstract landingPreviewLink(landerUuid: string): Promise<string | null>;
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
        metric_filters: [],
        metric_definition: null,
        metric_definitions: [],
        meta_spend_attribution_engine_level: 'campaign',
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

export function assertAioHeaders(headers: HeadersInit | undefined, options?: { allowTenant?: boolean }): void {
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
  if (bag.has('authorization') || bag.has('cookie')) {
    throw new Error('Сбой вызова AIO');
  }
  if (bag.has('x-tenant-id') && !options?.allowTenant) {
    throw new Error('Сбой вызова AIO');
  }
}

const LANDING_PREVIEW_TITLE = 'Landing Preview Link';

/** Content of the "Landing Preview Link" row. Never content_short or content_slug. */
export function readLandingPreviewContent(body: unknown): string {
  if (!Array.isArray(body)) throw new Error('Сбой вызова AIO');
  for (const item of body) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const title = typeof row.title === 'string' ? row.title.trim() : '';
    if (title !== LANDING_PREVIEW_TITLE) continue;
    const content = typeof row.content === 'string' ? row.content.trim() : '';
    if (!isHttpUrl(content)) throw new Error('Сбой вызова AIO');
    return content;
  }
  throw new Error('Сбой вызова AIO');
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
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
      throw new Error('Сбой вызова AIO: нет Download Requested');
    }
  }

  async findOriginal(uuid: string): Promise<OriginalFile> {
    const fileUrl = await this.pollOriginalUrl(uuid);
    return {
      read: (signal?: AbortSignal) => this.downloadFile(fileUrl, signal),
    };
  }

  async landingPreviewLink(landerUuid: string): Promise<string | null> {
    if (!previewLinkConfigured(this.config)) return null;
    const url = this.withToken('/api/v1/campaigns/link-generator/data');
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': 'application/json',
    };
    const tenant = this.config.aioTenantId;
    if (tenant) headers['x-tenant-id'] = tenant;
    const response = await this.call(
      url,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          campaign_uuid: this.config.aioPreviewCampaignUuid,
          source_uuid: this.config.aioPreviewSourceUuid,
          name: '',
          domain_uuid: this.config.aioPreviewDomainUuid,
          replaces: { lp: landerUuid },
          shuffle_params: true,
        }),
      },
      { allowTenant: tenant.length > 0 },
    );
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error('Сбой вызова AIO');
    }
    return readLandingPreviewContent(body);
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
    for (let page = 1; page <= 10; page += 1) {
      const pageResult = await this.scanNotificationPage(uuid, page);
      if (pageResult.url) return pageResult.url;
      if (!pageResult.more) return null;
    }
    return null;
  }

  private async scanNotificationPage(uuid: string, page: number): Promise<{ url: string | null; more: boolean }> {
    const url = this.withToken('/api/v1/notifications');
    url.searchParams.set('limit', '25');
    url.searchParams.set('page', String(page));
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
      if (original && typeof original.url === 'string') return { url: original.url, more: false };
    }
    return { url: null, more: items.length >= 25 };
  }

  private async downloadFile(fileUrl: string, signal?: AbortSignal): Promise<Buffer> {
    if (!downloadHostAllowed(fileUrl, this.config)) throw new AioDownloadError('rejected');
    const headers = { accept: 'application/octet-stream' };
    assertAioHeaders(headers);
    const href = downloadHref(fileUrl, this.config);
    const timeout = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await this.fetchImpl(href, { method: 'GET', headers, signal: combined, redirect: 'manual' });
    } catch (error) {
      if (signal?.aborted || combined.aborted) throw error;
      throw new AioDownloadError('network');
    }
    if (response.status >= 300 && response.status < 400) throw new AioDownloadError('rejected');
    if (!response.ok) throw new AioDownloadError('http', response.status);
    try {
      return await readLimitedBody(response, MAX_DOWNLOAD_BYTES);
    } catch (error) {
      if (error instanceof AioDownloadError) throw error;
      throw new AioDownloadError('body');
    }
  }

  private withToken(pathname: string): URL {
    const url = new URL(pathname, this.config.aioBaseUrl);
    url.searchParams.set('token', this.config.aioToken);
    return url;
  }

  private async call(url: string | URL, init: RequestInit, options?: { allowTenant?: boolean }): Promise<Response> {
    assertAioHeaders(init.headers, options);
    const href = typeof url === 'string' ? url : url.toString();
    let response: Response;
    try {
      response = await this.fetchImpl(href, init);
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      const safeName = /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(name) && name !== 'Error' ? `: ${name}` : '';
      throw new Error(`Сбой вызова AIO${safeName}`);
    }
    if (!response.ok) throw new Error(`Сбой вызова AIO: HTTP ${response.status}`);
    return response;
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

function downloadHostAllowed(fileUrl: string, config: AppConfig): boolean {
  let url: URL;
  try {
    url = new URL(fileUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  let apiHost = '';
  try {
    apiHost = new URL(config.aioBaseUrl).host;
  } catch {
    return false;
  }
  if (url.host === apiHost) return true;
  return config.aioStorageHosts.includes(url.host);
}

function downloadHref(fileUrl: string, config: AppConfig): string {
  if (signedStorageUrl(fileUrl)) return fileUrl;
  const fileHost = new URL(fileUrl).host;
  const apiHost = new URL(config.aioBaseUrl).host;
  if (fileHost !== apiHost) return fileUrl;
  return withDownloadToken(fileUrl, config.aioToken);
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) {
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > maxBytes) throw new AioDownloadError('rejected');
    return body;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    total += step.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new AioDownloadError('rejected');
    }
    chunks.push(Buffer.from(step.value));
  }
  return Buffer.concat(chunks);
}

function withDownloadToken(fileUrl: string, token: string): string {
  const url = new URL(fileUrl);
  url.searchParams.set('token', token);
  return url.toString();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

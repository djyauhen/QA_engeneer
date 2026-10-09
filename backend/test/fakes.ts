import AdmZip from 'adm-zip';
import { AiClient, AiResult } from '../src/ai/ai.client';
import { AioClient, OriginalFile } from '../src/aio/aio.client';
import { CatalogQuery, cloneCatalogQuery, defaultCatalogQuery } from '../src/catalog/catalog-query';
import { LighthouseRunner, StubLighthouseRunner } from '../src/lighthouse/lighthouse';
import { AiFinding, LighthouseMetrics } from '../src/reports/report.types';

export function zipFiles(files: Record<string, string | Buffer>): Buffer {
  const zip = new AdmZip();
  for (const [name, data] of Object.entries(files)) {
    zip.addFile(name, Buffer.isBuffer(data) ? data : Buffer.from(data));
  }
  return zip.toBuffer();
}

export function structurePassZip(): Buffer {
  return zipFiles({
    'landing/index.html': `<html><head></head><body>
{{form}}
{{aio.visit.fields.offer_name.for_visitors}}
<img src="{{cdn}}/images/dot.png">
<script src="https://evil.test/pixel.js"></script>
<script src="js/local.js"></script>
{{link}}
</body></html>`,
    'landing/favicon.ico': 'ico',
    'landing/images/dot.png': Buffer.from([137, 80, 78, 71]),
    'landing/js/local.js': 'var local = 1;',
  });
}

export function structureFailZip(): Buffer {
  return zipFiles({
    'a/index.html': '<html></html>',
    'b/index.html': '<html></html>',
  });
}

export function aioRow(input: {
  human_id?: string;
  uuid: string;
  name?: string;
  created_at?: string;
  includeCreatedAt?: boolean;
  identityCreatedAt?: string;
  preview_image?: string;
  countries?: string[];
  languages?: string[];
  omitHumanId?: boolean;
  topHumanId?: string;
  metric?: number;
}): Record<string, unknown> {
  const identity: Record<string, unknown> = {
    uuid: input.uuid,
    name: input.name ?? 'Lander',
    countries: input.countries ?? ['CA'],
    languages: input.languages ?? ['en'],
    status: 'Fine',
    preview_image: input.preview_image ?? 'https://example.invalid/preview.webp',
    mvt_settings: '',
    lander_type: { name: 'Preland w/ Form' },
  };
  if (!input.omitHumanId) identity.human_id = input.human_id ?? '100';
  if (input.identityCreatedAt) identity.created_at = input.identityCreatedAt;
  const row: Record<string, unknown> = { _identity: identity };
  if (input.includeCreatedAt !== false && input.created_at !== undefined) row.created_at = input.created_at;
  if (input.topHumanId) row.human_id = input.topHumanId;
  if (input.metric != null) row.metric_stub = input.metric;
  return row;
}

export class FakeAio extends AioClient {
  catalogCalls = 0;
  catalogQueries: CatalogQuery[] = [];
  lastCatalogQuery: CatalogQuery | null = null;
  downloadRequests: string[] = [];
  notificationPolls: string[] = [];
  fileReads = 0;
  rows: unknown[] = [];
  zip: Buffer = structurePassZip();
  failDownloads = 0;

  async loadCatalogRows(query?: CatalogQuery): Promise<unknown[]> {
    this.catalogCalls += 1;
    const captured = query ? cloneCatalogQuery(query) : defaultCatalogQuery();
    this.lastCatalogQuery = captured;
    this.catalogQueries.push(captured);
    return this.rows;
  }

  async requestDownload(uuid: string): Promise<void> {
    this.downloadRequests.push(uuid);
    if (this.downloadRequests.length <= this.failDownloads) throw new Error('Сбой вызова AIO');
  }

  async findOriginal(uuid: string): Promise<OriginalFile> {
    this.notificationPolls.push(uuid);
    return {
      read: async () => {
        this.fileReads += 1;
        return this.zip;
      },
    };
  }
}

export class ScriptedAi extends AiClient {
  calls = 0;
  failTimes = 0;
  findings: Array<Partial<AiFinding>> = [];
  usage: Record<string, unknown> | null = null;
  lastLanguages: string[] = [];

  async review(input: { languages: string[] }): Promise<AiResult> {
    this.calls += 1;
    this.lastLanguages = input.languages;
    if (this.calls <= this.failTimes) throw new Error('Сбой вызова ИИ');
    return { findings: this.findings, usage: this.usage };
  }
}

export class ScriptedLighthouse extends LighthouseRunner {
  calls = 0;
  failTimes = 0;
  urls: string[] = [];
  private readonly stub = new StubLighthouseRunner();

  async run(url: string, formFactor: 'mobile' | 'desktop'): Promise<LighthouseMetrics> {
    this.calls += 1;
    this.urls.push(url);
    if (this.calls <= this.failTimes) throw new Error('Сбой Lighthouse');
    return this.stub.run(url, formFactor);
  }
}

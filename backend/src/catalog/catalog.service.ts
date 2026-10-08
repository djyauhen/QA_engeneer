import { BadGatewayException, Inject, Injectable } from '@nestjs/common';
import { AioClient } from '../aio/aio.client';
import { CATALOG_REPO } from '../tokens';
import { CatalogRepo } from '../storage/repos';
import { CatalogCard, mapCatalogRows, sortByHumanIdDesc, toScreenItem } from './map-row';

export type ResolveResult =
  | { kind: 'ok'; card: CatalogCard }
  | { kind: 'not_found' }
  | { kind: 'pair_not_found' }
  | { kind: 'collision'; rows: CatalogCard[] };

@Injectable()
export class CatalogService {
  private inflight: Promise<void> | null = null;

  constructor(
    @Inject(CATALOG_REPO) private readonly catalog: CatalogRepo,
    @Inject(AioClient) private readonly aio: AioClient,
  ) {}

  async screen() {
    const rows = sortByHumanIdDesc(await this.catalog.load());
    return { items: rows.map(toScreenItem) };
  }

  async refresh(): Promise<{ items: ReturnType<typeof toScreenItem>[] }> {
    if (!this.inflight) {
      this.inflight = this.fetchAndStore().finally(() => {
        this.inflight = null;
      });
    }
    await this.inflight;
    return this.screen();
  }

  async resolve(humanId: string, uuid?: string): Promise<ResolveResult> {
    if (uuid) {
      const rows = await this.catalog.load();
      const hit = rows.find((row) => row.human_id === humanId && row.uuid === uuid);
      return hit ? { kind: 'ok', card: hit } : { kind: 'pair_not_found' };
    }
    let hits = (await this.catalog.load()).filter((row) => row.human_id === humanId);
    if (hits.length === 0) {
      await this.refresh();
      hits = (await this.catalog.load()).filter((row) => row.human_id === humanId);
    }
    if (hits.length === 0) return { kind: 'not_found' };
    if (hits.length > 1) return { kind: 'collision', rows: hits };
    return { kind: 'ok', card: hits[0] };
  }

  private async fetchAndStore(): Promise<void> {
    try {
      const raw = await this.aio.loadCatalogRows();
      await this.catalog.save(mapCatalogRows(raw));
    } catch {
      throw new BadGatewayException({ error: 'catalog_refresh_failed', message: 'Не удалось обновить каталог' });
    }
  }
}

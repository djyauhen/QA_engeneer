import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from '../core/api.service';
import { catalogSourceLine, normalizeCatalogQuery } from '../core/catalog-query';
import { errorCode, errorText } from '../core/http-error';
import { formatTimestamp, inputValue, joinList } from '../core/format';
import {
  CATALOG_STATUS_CAPTION,
  COLLISION_TEXT,
  EMPTY_CATALOG,
  EMPTY_SEARCH,
  NOT_IN_CATALOG,
  PREVIEW_CAPTION,
  CatalogItem,
  CatalogPayload,
  CatalogQuery,
} from '../core/models';
import { SessionStore } from '../core/session.store';

@Component({
  selector: 'app-launch',
  template: `
    <h1>Запуск проверки</h1>
    @if (catalogSource()) {
      <p class="meta">
        {{ catalogSource() }}
        @if (refreshedAt()) {
          <br />
          Обновлено {{ formatTimestamp(refreshedAt()) }}
        }
      </p>
    }
    <div class="toolbar">
      <div class="field">
        <label for="search">Поиск</label>
        <input id="search" [value]="query()" (input)="query.set(inputValue($event))" />
      </div>
      <button type="button" class="secondary" (click)="refresh()" [disabled]="refreshing()" [attr.aria-busy]="refreshing()">
        Обновить
      </button>
      <div class="spacer"></div>
      <div class="field">
        <label for="human-id">human_id</label>
        <input
          id="human-id"
          [value]="humanId()"
          placeholder="359226"
          aria-describedby="human-hint"
          autocomplete="off"
          (input)="humanId.set(inputValue($event))"
        />
        <p id="human-hint" class="hint">Например, 359226</p>
      </div>
      <button type="button" class="primary" (click)="launch()" [disabled]="launching()">Запустить проверку</button>
    </div>

    @if (refreshError()) {
      <p class="alert error" role="alert">{{ refreshError() }}</p>
    }
    @if (notice() === 'collision') {
      <p class="alert error" role="alert">{{ collisionText }}</p>
    }
    @if (notice() === 'missing') {
      <p class="alert error" role="alert">{{ missingText }}</p>
    }
    @if (notice() === 'pair') {
      <p class="alert error" role="alert">{{ pairText() }}</p>
    }
    @if (notice() === 'need') {
      <p class="alert error" role="alert">Выберите строку или введите human_id.</p>
    }
    @if (launchError()) {
      <p class="alert error" role="alert">{{ launchError() }}</p>
    }

    @if (loading()) {
      <p>Загрузка…</p>
    } @else if (items().length === 0) {
      <p class="empty">{{ emptyCatalog }}</p>
    } @else if (filtered().length === 0) {
      <p class="empty">{{ emptySearch }}</p>
    } @else {
      <table class="data" aria-label="Каталог лендингов">
        <thead>
          <tr>
            <th>id</th>
            <th>Лендинг</th>
            <th>Создано</th>
          </tr>
        </thead>
        <tbody>
          @for (row of filtered(); track row.uuid; let index = $index) {
            <tr
              [id]="'catalog-row-' + row.uuid"
              tabindex="0"
              [class.selected]="selected()?.uuid === row.uuid"
              [attr.aria-selected]="selected()?.uuid === row.uuid"
              (click)="select(row)"
              (keydown)="onRowKey($event, row, index)"
            >
              <td class="mono">{{ row.human_id }}</td>
              <td>{{ row.name }}</td>
              <td>{{ formatTimestamp(row.created_at) }}</td>
            </tr>
          }
        </tbody>
      </table>
    }

    @if (card(); as current) {
      <section class="card preview-card" aria-label="Карточка до скачивания">
        <div class="preview-layout">
          @if (hasPreview(current)) {
            <figure class="preview">
              <img [src]="current.preview_image" alt="" />
              <figcaption>{{ previewCaption }}</figcaption>
            </figure>
          }
          <dl class="facts">
            <div>
              <dt>Название</dt>
              <dd>{{ current.name }}</dd>
            </div>
            <div>
              <dt>human_id</dt>
              <dd class="mono">{{ current.human_id }}</dd>
            </div>
            @if (hasField(current, 'countries')) {
              <div>
                <dt>Страны</dt>
                <dd>{{ joinList(current.countries) }}</dd>
              </div>
            }
            @if (hasField(current, 'languages')) {
              <div>
                <dt>Языки</dt>
                <dd>{{ joinList(current.languages) }}</dd>
              </div>
            }
            @if (hasField(current, 'lander_type_name')) {
              <div>
                <dt>Тип</dt>
                <dd>{{ current.lander_type_name }}</dd>
                <p class="hint">Например, Preland w/ Form</p>
              </div>
            }
            @if (hasField(current, 'status')) {
              <div>
                <dt>Статус в каталоге</dt>
                <dd>{{ current.status }}</dd>
                <p class="hint">{{ statusCaption }}</p>
              </div>
            }
            @if (hasField(current, 'mvt_settings')) {
              <div>
                <dt>Варианты</dt>
                <dd>{{ current.mvt_settings }}</dd>
              </div>
            }
          </dl>
        </div>
      </section>
    }
  `,
})
export class LaunchComponent {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly session = inject(SessionStore);
  readonly items = signal<CatalogItem[]>([]);
  readonly catalogQuery = signal<CatalogQuery | null>(null);
  readonly refreshedAt = signal<string | null>(null);
  readonly query = signal('');
  readonly humanId = signal('');
  readonly selected = signal<CatalogItem | null>(null);
  readonly loading = signal(true);
  readonly refreshing = signal(false);
  readonly launching = signal(false);
  readonly refreshError = signal('');
  readonly launchError = signal('');
  readonly notice = signal<'' | 'collision' | 'missing' | 'pair' | 'need'>('');
  readonly pairText = signal('');
  readonly blockedHumanId = signal('');
  readonly inputValue = inputValue;
  readonly formatTimestamp = formatTimestamp;
  readonly joinList = joinList;
  readonly collisionText = COLLISION_TEXT;
  readonly missingText = NOT_IN_CATALOG;
  readonly emptyCatalog = EMPTY_CATALOG;
  readonly emptySearch = EMPTY_SEARCH;
  readonly previewCaption = PREVIEW_CAPTION;
  readonly statusCaption = CATALOG_STATUS_CAPTION;

  readonly catalogSource = computed(() => {
    const query = this.catalogQuery();
    return query ? catalogSourceLine(query) : '';
  });

  readonly filtered = computed(() => {
    const query = this.query().trim().toLowerCase();
    const items = this.items();
    if (!query) return items;
    return items.filter(
      (row) => row.human_id.toLowerCase().includes(query) || row.name.toLowerCase().includes(query),
    );
  });

  readonly card = computed(() => {
    const selected = this.selected();
    if (selected) return selected;
    const typed = this.humanId();
    if (!typed) return null;
    const matches = this.items().filter((row) => row.human_id === typed);
    return matches.length === 1 ? matches[0] : null;
  });

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.catalog().subscribe({
      next: (response) => {
        this.applyCatalog(response);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.refreshError.set(errorText(error, 'Не удалось загрузить каталог.'));
      },
    });
  }

  refresh(): void {
    this.refreshing.set(true);
    this.refreshError.set('');
    this.api.refreshCatalog().subscribe({
      next: (response) => {
        this.applyCatalog(response);
        this.refreshing.set(false);
      },
      error: (error: unknown) => {
        this.refreshing.set(false);
        this.refreshError.set(errorText(error, 'Не удалось обновить каталог'));
      },
    });
  }

  select(row: CatalogItem): void {
    this.selected.set(row);
    this.notice.set('');
  }

  onRowKey(event: KeyboardEvent, row: CatalogItem, index: number): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.select(row);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const rows = this.filtered();
    const nextIndex = event.key === 'ArrowDown' ? Math.min(index + 1, rows.length - 1) : Math.max(index - 1, 0);
    const next = rows[nextIndex];
    if (!next) return;
    this.select(next);
    queueMicrotask(() => document.getElementById(`catalog-row-${next.uuid}`)?.focus());
  }

  launch(): void {
    const typed = this.humanId();
    const selected = this.selected();
    this.launchError.set('');
    this.notice.set('');
    if (typed.length > 0 && selected && typed === selected.human_id) {
      this.post({ human_id: selected.human_id, uuid: selected.uuid });
      return;
    }
    if (typed.length > 0) {
      const matches = this.items().filter((row) => row.human_id === typed);
      if (matches.length > 1) {
        this.blockedHumanId.set(typed);
        this.notice.set('collision');
        return;
      }
      if (matches.length === 1) {
        this.post({ human_id: typed });
        return;
      }
      if (this.blockedHumanId() === typed) {
        this.notice.set('collision');
        return;
      }
      this.post({ human_id: typed });
      return;
    }
    if (selected) {
      this.post({ human_id: selected.human_id, uuid: selected.uuid });
      return;
    }
    this.notice.set('need');
  }

  hasField(row: CatalogItem, key: 'countries' | 'languages' | 'lander_type_name' | 'status' | 'mvt_settings'): boolean {
    return Object.prototype.hasOwnProperty.call(row, key);
  }

  hasPreview(row: CatalogItem): boolean {
    return typeof row.preview_image === 'string' && row.preview_image.length > 0;
  }

  private applyCatalog(response: Partial<CatalogPayload>): void {
    this.items.set(response.items ?? []);
    this.catalogQuery.set(normalizeCatalogQuery(response.query));
    const refreshed = response.refreshed_at;
    this.refreshedAt.set(typeof refreshed === 'string' && refreshed.length > 0 ? refreshed : null);
  }

  private post(body: { human_id: string; uuid?: string }): void {
    this.launching.set(true);
    this.api.startCheck(body).subscribe({
      next: (response) => {
        this.launching.set(false);
        this.session.rememberCheck(response.check_id);
        void this.router.navigate(['/checks', response.check_id]);
      },
      error: (error: unknown) => {
        this.launching.set(false);
        if (!(error instanceof HttpErrorResponse)) {
          this.launchError.set(errorText(error, 'Не удалось запустить проверку.'));
          return;
        }
        const code = errorCode(error);
        if (code === 'collision') {
          this.blockedHumanId.set(body.human_id);
          this.notice.set('collision');
          return;
        }
        if (code === 'not_found') {
          this.notice.set('missing');
          return;
        }
        if (code === 'pair_not_found') {
          this.pairText.set(errorText(error, 'Пара human_id и uuid не найдена в кэше. Скачивание не начато.'));
          this.notice.set('pair');
          return;
        }
        this.launchError.set(errorText(error, 'Не удалось запустить проверку.'));
      },
    });
  }
}

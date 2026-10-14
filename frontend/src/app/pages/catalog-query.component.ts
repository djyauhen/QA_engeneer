import { Component, inject, signal } from '@angular/core';
import { ApiService } from '../core/api.service';
import { apiDateToDatetimeLocal, catalogModeValues, datetimeLocalToApiDate, normalizeCatalogQuery } from '../core/catalog-query';
import { inputValue } from '../core/format';
import { errorText } from '../core/http-error';
import { CatalogQuery } from '../core/models';

interface CatalogQueryForm {
  search: string;
  mode: string;
  from: string;
  to: string;
  timezone: string;
}

@Component({
  selector: 'app-catalog-query',
  template: `
    <h1>Каталог AIO</h1>
    @if (loading()) {
      <p>Загрузка…</p>
    } @else if (loadError()) {
      <p class="alert error" role="alert">{{ loadError() }}</p>
    } @else if (form(); as current) {
      <form (submit)="save($event)">
        <label for="catalog-search">Поиск AIO</label>
        <input
          id="catalog-search"
          autocomplete="off"
          [value]="current.search"
          (input)="patch('search', inputValue($event))"
        />
        <p class="hint">Это поиск на стороне AIO, не фильтр уже показанной таблицы.</p>

        <label for="catalog-mode">Режим (mode)</label>
        <input
          id="catalog-mode"
          autocomplete="off"
          [value]="current.mode"
          (input)="patch('mode', inputValue($event))"
        />
        <p class="hint">Значения через запятую, например Editor. Пусто — фильтр не отправляется.</p>

        <fieldset>
          <legend>Период</legend>
          <label for="catalog-from">Начало</label>
          <input
            id="catalog-from"
            type="datetime-local"
            step="1"
            [value]="current.from"
            (input)="patch('from', inputValue($event))"
          />
          <label for="catalog-to">Конец</label>
          <input
            id="catalog-to"
            type="datetime-local"
            step="1"
            [value]="current.to"
            (input)="patch('to', inputValue($event))"
          />
          <label for="catalog-zone">Пояс</label>
          <input
            id="catalog-zone"
            autocomplete="off"
            [value]="current.timezone"
            (input)="patch('timezone', inputValue($event))"
          />
          <p class="hint">Например, Europe/Minsk. Если начало, конец и пояс пустые, период не отправляется.</p>
        </fieldset>

        @if (saveError()) {
          <p class="alert error" role="alert">{{ saveError() }}</p>
        }
        @if (saved()) {
          <p class="alert neutral" role="status">Сохранено.</p>
        }
        <button type="submit" class="primary" [disabled]="saving()">Сохранить</button>
        <p class="hint">Список на экране запуска обновится после «Обновить».</p>
      </form>
    }
  `,
})
export class CatalogQueryComponent {
  private readonly api = inject(ApiService);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly loadError = signal('');
  readonly saveError = signal('');
  readonly saved = signal(false);
  readonly form = signal<CatalogQueryForm | null>(null);
  readonly inputValue = inputValue;

  constructor() {
    this.api.catalogQuery().subscribe({
      next: (query) => {
        this.form.set(toForm(query));
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.form.set(null);
        this.loadError.set(errorText(error, 'Не удалось прочитать запрос каталога.'));
      },
    });
  }

  patch(key: keyof CatalogQueryForm, value: string): void {
    const current = this.form();
    if (!current) return;
    this.saved.set(false);
    this.form.set({ ...current, [key]: value });
  }

  save(event: Event): void {
    event.preventDefault();
    const current = this.form();
    if (!current) return;
    const built = fromForm(current);
    if (!built.ok) {
      this.saved.set(false);
      this.saveError.set(built.error);
      return;
    }
    this.saving.set(true);
    this.saveError.set('');
    this.api.saveCatalogQuery(built.query).subscribe({
      next: (response) => {
        this.form.set(toForm(savedQuery(response, built.query)));
        this.saving.set(false);
        this.saved.set(true);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.saved.set(false);
        this.saveError.set(errorText(error, 'Не удалось сохранить запрос каталога.'));
      },
    });
  }
}

function toForm(query: CatalogQuery): CatalogQueryForm {
  const normalized = normalizeCatalogQuery(query);
  const dates = normalized.dates;
  return {
    search: normalized.search,
    mode: catalogModeValues(normalized).join(', '),
    from: dates ? apiDateToDatetimeLocal(dates[0]) : '',
    to: dates ? apiDateToDatetimeLocal(dates[1]) : '',
    timezone: dates ? dates[2] : '',
  };
}

function fromForm(form: CatalogQueryForm): { ok: true; query: CatalogQuery } | { ok: false; error: string } {
  const modes = form.mode
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const from = form.from.trim();
  const to = form.to.trim();
  const timezone = form.timezone.trim();
  let dates: CatalogQuery['dates'];
  if (!from && !to && !timezone) {
    dates = null;
  } else if (!from || !to) {
    return { ok: false, error: 'Укажите начало и конец периода.' };
  } else if (!timezone) {
    return { ok: false, error: 'Укажите пояс периода.' };
  } else {
    const fromApi = datetimeLocalToApiDate(from);
    const toApi = datetimeLocalToApiDate(to);
    if (!fromApi || !toApi) return { ok: false, error: 'Некорректная дата периода.' };
    if (fromApi > toApi) return { ok: false, error: 'Конец периода раньше начала.' };
    dates = [fromApi, toApi, timezone];
  }
  return {
    ok: true,
    query: {
      search: form.search.trim(),
      filters: modes.length === 0 ? [] : [{ key: 'mode', operator: 'in', value: modes }],
      dates,
    },
  };
}

function savedQuery(response: CatalogQuery | null, fallback: CatalogQuery): CatalogQuery {
  if (!response || typeof response !== 'object') return fallback;
  if (!('search' in response) || !('filters' in response) || !('dates' in response)) return fallback;
  return normalizeCatalogQuery(response);
}

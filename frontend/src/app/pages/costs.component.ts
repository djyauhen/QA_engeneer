import { Component, inject, signal } from '@angular/core';
import { ApiService } from '../core/api.service';
import { isSignedUrl, scrubSignedUrls } from '../core/format';
import { errorText } from '../core/http-error';
import { NO_USAGE } from '../core/models';

const HIDDEN_KEYS = new Set([
  'password',
  'password_hash',
  'token',
  'aio_token',
  'stand_url',
  'signed_url',
  'download_url',
  'overall_status',
  'verdict',
  'preview_image',
]);

@Component({
  selector: 'app-costs',
  template: `
    <h1>Затраты</h1>
    @if (loading()) {
      <p>Загрузка…</p>
    } @else if (error()) {
      <p class="alert error" role="alert">{{ error() }}</p>
    } @else if (missing()) {
      <p class="alert neutral">{{ noUsage }}</p>
    } @else {
      @for (entry of entries(); track $index) {
        <section class="card">
          <dl class="facts">
            @for (row of entry; track row.key) {
              <div>
                <dt class="mono">{{ row.key }}</dt>
                <dd class="mono">{{ row.value }}</dd>
              </div>
            }
          </dl>
        </section>
      }
    }
  `,
})
export class CostsComponent {
  private readonly api = inject(ApiService);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly missing = signal(false);
  readonly entries = signal<Array<Array<{ key: string; value: string }>>>([]);
  readonly noUsage = NO_USAGE;

  constructor() {
    this.api.costs().subscribe({
      next: (response) => {
        this.loading.set(false);
        if (!response.usage_reported || !('provider_usage' in response) || !response.provider_usage?.length) {
          this.missing.set(true);
          this.entries.set([]);
          return;
        }
        this.missing.set(false);
        this.entries.set(response.provider_usage.map((entry) => flattenUsage(entry)));
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.entries.set([]);
        this.missing.set(false);
        this.error.set(errorText(error, 'Не удалось загрузить затраты.'));
      },
    });
  }
}

function flattenUsage(value: Record<string, unknown>, prefix = ''): Array<{ key: string; value: string }> {
  const rows: Array<{ key: string; value: string }> = [];
  for (const [key, nested] of Object.entries(value)) {
    if (HIDDEN_KEYS.has(key)) continue;
    const name = prefix ? `${prefix}.${key}` : key;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      rows.push(...flattenUsage(nested as Record<string, unknown>, name));
      continue;
    }
    rows.push({ key: name, value: displayValue(nested) });
  }
  return rows;
}

function displayValue(value: unknown): string {
  if (typeof value === 'string') {
    if (isSignedUrl(value)) return '[ссылка скрыта]';
    return scrubSignedUrls(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return '';
  return scrubSignedUrls(JSON.stringify(value));
}

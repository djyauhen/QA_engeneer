import { Component, inject, signal } from '@angular/core';
import { ApiService } from '../core/api.service';
import { errorText } from '../core/http-error';

@Component({
  selector: 'app-grok',
  template: `
    <h1>Grok Build</h1>
    <p class="hint">Вход делает тимлид через код устройства. Ключ xAI на сервер не кладётся. QA эту страницу не открывает.</p>
    @if (loading()) {
      <p>Загрузка…</p>
    } @else {
      <section class="card">
        <p>Статус: {{ connected() ? 'подключён' : 'не подключён' }}</p>
        @if (error()) {
          <p class="alert error" role="alert">{{ error() }}</p>
        }
        @if (loginUrl()) {
          <p>
            Откройте ссылку и введите код.
            <a [href]="loginUrl()" target="_blank" rel="noopener noreferrer">{{ loginUrl() }}</a>
          </p>
          <p class="mono">{{ loginCode() }}</p>
        }
        <p class="actions">
          <button type="button" class="primary" (click)="login()" [disabled]="busy()" [attr.aria-busy]="busy()">
            Войти
          </button>
          <button type="button" class="secondary" (click)="logout()" [disabled]="busy() || !connected()">
            Отключить
          </button>
        </p>
      </section>
    }
  `,
})
export class GrokComponent {
  private readonly api = inject(ApiService);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly connected = signal(false);
  readonly error = signal('');
  readonly loginUrl = signal('');
  readonly loginCode = signal('');

  constructor() {
    this.refresh();
  }

  login(): void {
    this.busy.set(true);
    this.error.set('');
    this.api.grokLogin().subscribe({
      next: (response) => {
        this.loginUrl.set(response.url);
        this.loginCode.set(response.code);
        this.busy.set(false);
        this.refresh();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.error.set(errorText(error, 'Не удалось начать вход.'));
      },
    });
  }

  logout(): void {
    this.busy.set(true);
    this.error.set('');
    this.loginUrl.set('');
    this.loginCode.set('');
    this.api.grokLogout().subscribe({
      next: () => {
        this.busy.set(false);
        this.refresh();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.error.set(errorText(error, 'Не удалось отключить Grok Build.'));
      },
    });
  }

  private refresh(): void {
    this.api.grokStatus().subscribe({
      next: (response) => {
        this.connected.set(response.connected === true);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.error.set(errorText(error, 'Не удалось прочитать статус Grok Build.'));
      },
    });
  }
}

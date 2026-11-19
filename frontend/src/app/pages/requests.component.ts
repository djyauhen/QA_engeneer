import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../core/api.service';
import { qaCategoryLabel } from '../core/format';
import { errorText } from '../core/http-error';
import { ACCESS_DENIED, AiRequestCall, ROLE_QA, ReportPayload } from '../core/models';
import { SessionStore } from '../core/session.store';

@Component({
  selector: 'app-requests',
  template: `
    <h1>Запросы</h1>
    @if (loading()) {
      <p>Загрузка…</p>
    } @else if (error()) {
      <p class="alert error" role="alert">{{ error() }}</p>
    } @else if (report(); as current) {
      @if (current.ai_requests; as trace) {
        @for (call of trace.calls; track $index) {
          <section class="block">
            <h2>{{ heading(call) }}</h2>
            <p>Модель: {{ call.model }}</p>
            <p class="request-pixels">{{ call.pixels ? 'Пиксели приложены' : 'Без файлов' }}</p>
            <p class="hint">Системный промпт</p>
            <pre class="qa-report">{{ call.system }}</pre>
            @if (call.attachments.length) {
              <ol class="request-files">
                @for (label of call.attachments; track $index) {
                  <li>
                    <figure class="request-shot">
                      <figcaption>{{ label }}</figcaption>
                      @if (imageOf(trace.shots, label); as src) {
                        <img [src]="src" [alt]="label" loading="lazy" />
                      } @else {
                        <p class="shot-placeholder">Файл отсутствует.</p>
                      }
                    </figure>
                  </li>
                }
              </ol>
            }
          </section>
        }
      } @else {
        <p class="alert neutral">Запросы этой проверки не сохранены.</p>
      }
    }
  `,
})
export class RequestsComponent {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly session = inject(SessionStore);
  private readonly destroyRef = inject(DestroyRef);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly report = signal<ReportPayload | null>(null);

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.load(params.get('reportId') ?? '');
    });
  }

  heading(call: AiRequestCall): string {
    if (call.kind === 'vision') return 'Осмотр кадров';
    if (typeof call.category !== 'number') return 'Пункт';
    return `Пункт ${call.category}. ${qaCategoryLabel(call.category)}`;
  }

  imageOf(shots: Record<string, string>, label: string): string | null {
    const url = shots[label];
    if (typeof url !== 'string' || !/^data:image\/[^;,]+;base64,/i.test(url)) return null;
    return url;
  }

  private load(id: string): void {
    this.loading.set(true);
    this.error.set('');
    this.report.set(null);
    this.api.report(id).subscribe({
      next: (report) => {
        if (!this.allowed(report)) {
          this.loading.set(false);
          this.error.set(ACCESS_DENIED);
          return;
        }
        this.report.set(report);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.error.set(errorText(error, 'Не удалось открыть отчёт.'));
      },
    });
  }

  private allowed(report: ReportPayload): boolean {
    if (this.session.role() !== ROLE_QA) return true;
    const login = this.session.login();
    return Boolean(login) && report.owner_login === login;
  }
}

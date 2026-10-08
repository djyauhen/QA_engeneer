import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../core/api.service';
import { errorText } from '../core/http-error';
import { ACCESS_DENIED, NO_PREVIOUS, ROLE_QA, ReportBody, ReportPayload } from '../core/models';
import { SessionStore } from '../core/session.store';
import { ReportBlocksComponent } from '../report/report-blocks.component';
import { toBody } from './report.component';

@Component({
  selector: 'app-compare',
  imports: [ReportBlocksComponent],
  template: `
    <h1>Сравнение</h1>
    @if (loading()) {
      <p>Загрузка…</p>
    } @else if (error()) {
      <p class="alert error" role="alert">{{ error() }}</p>
    } @else if (current(); as report) {
      <div class="compare">
        <app-report-blocks [data]="report" heading="Текущий отчёт" [showDate]="true" [showRecommendation]="true" />
        <div>
          @if (previous(); as past) {
            <app-report-blocks [data]="past" heading="Прошлый отчёт" [showDate]="true" [showRecommendation]="true" />
          } @else {
            <h2>Прошлый отчёт</h2>
            <p class="alert neutral">{{ noPrevious }}</p>
          }
        </div>
      </div>
    }
  `,
})
export class CompareComponent {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly session = inject(SessionStore);
  private readonly destroyRef = inject(DestroyRef);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly current = signal<ReportBody | null>(null);
  readonly previous = signal<ReportBody | null>(null);
  readonly noPrevious = NO_PREVIOUS;

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.load(params.get('reportId') ?? '');
    });
  }

  private load(id: string): void {
    this.loading.set(true);
    this.error.set('');
    this.current.set(null);
    this.previous.set(null);
    this.api.report(id).subscribe({
      next: (report) => {
        if (!this.allowed(report)) {
          this.loading.set(false);
          this.error.set(ACCESS_DENIED);
          return;
        }
        this.current.set(toBody(report));
        this.api.previousReport(id).subscribe({
          next: (response) => {
            this.previous.set(response.report ? toBody(response.report) : null);
            this.loading.set(false);
          },
          error: (error: unknown) => {
            this.loading.set(false);
            this.current.set(null);
            this.error.set(errorText(error, 'Не удалось открыть прошлый отчёт.'));
          },
        });
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

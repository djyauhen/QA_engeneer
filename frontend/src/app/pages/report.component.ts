import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { errorText } from '../core/http-error';
import { ACCESS_DENIED, ROLE_QA, ReportBody, ReportPayload } from '../core/models';
import { SessionStore } from '../core/session.store';
import { ReportBlocksComponent } from '../report/report-blocks.component';

@Component({
  selector: 'app-report',
  imports: [ReportBlocksComponent, RouterLink],
  template: `
    @if (loading()) {
      <h1>Отчёт</h1>
      <p>Загрузка…</p>
    } @else if (error()) {
      <h1>Отчёт</h1>
      <p class="alert error" role="alert">{{ error() }}</p>
    } @else if (body(); as report) {
      <p class="actions"><a class="secondary link" [routerLink]="['/reports', reportId(), 'compare']">Сравнение</a></p>
      <app-report-blocks [data]="report" heading="Отчёт" [showDate]="true" [showRecommendation]="true" />
    }
  `,
})
export class ReportComponent {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly session = inject(SessionStore);
  private readonly destroyRef = inject(DestroyRef);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly body = signal<ReportBody | null>(null);
  readonly reportId = signal('');

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('reportId') ?? '';
      this.reportId.set(id);
      this.session.rememberCheck(id);
      this.load(id);
    });
  }

  private load(id: string): void {
    this.loading.set(true);
    this.error.set('');
    this.body.set(null);
    this.api.report(id).subscribe({
      next: (report) => {
        if (!this.allowed(report)) {
          this.loading.set(false);
          this.error.set(ACCESS_DENIED);
          return;
        }
        this.body.set(toBody(report));
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

export function toBody(report: ReportPayload): ReportBody {
  return {
    name: report.name,
    human_id: report.human_id,
    countries: report.countries ?? [],
    languages: report.languages ?? [],
    created_at: report.created_at,
    lander_type_name: report.lander_type_name ?? '',
    catalog_status: report.status ?? '',
    static: report.static,
    ai: report.ai,
    ai_note: report.steps.find((step) => step.name === 'ai' && step.state === 'failed')?.message ?? '',
    lighthouse: report.lighthouse,
  };
}

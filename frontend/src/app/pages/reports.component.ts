import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ApiService } from '../core/api.service';
import { errorText } from '../core/http-error';
import { formatTimestamp } from '../core/format';
import { ACCESS_DENIED, ROLE_QA, ReportListItem, ReportRow } from '../core/models';
import { SessionStore } from '../core/session.store';

@Component({
  selector: 'app-reports',
  template: `
    <h1>Отчёты</h1>
    @if (loading()) {
      <p>Загрузка…</p>
    } @else if (error()) {
      <p class="alert error" role="alert">{{ error() }}</p>
    } @else if (rows(); as list) {
      @if (list.length === 0) {
        <p class="empty">Отчётов нет.</p>
      } @else {
        <table class="data" aria-label="Список отчётов">
          <thead>
            <tr>
              <th>Дата</th>
              <th>human_id</th>
              <th>Название</th>
              <th>Статика</th>
              <th>ИИ</th>
              <th>Lighthouse</th>
              @if (showOwner()) {
                <th>Кто запустил</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (row of list; track row.report_id; let index = $index) {
              <tr
                tabindex="0"
                [id]="'report-row-' + row.report_id"
                (click)="open(row.report_id)"
                (keydown)="onKey($event, row.report_id, index)"
              >
                <td>{{ formatTimestamp(row.created_at) }}</td>
                <td class="mono">{{ row.human_id }}</td>
                <td>{{ row.name }}</td>
                <td><span class="chip">{{ row.staticSummary }}</span></td>
                <td><span class="chip">{{ row.aiStatus }}</span></td>
                <td><span class="chip">{{ row.lhStatus }}</span></td>
                @if (showOwner()) {
                  <td>{{ row.owner_login }}</td>
                }
              </tr>
            }
          </tbody>
        </table>
      }
    }
  `,
})
export class ReportsComponent {
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly rows = signal<ReportRow[] | null>(null);
  readonly formatTimestamp = formatTimestamp;

  constructor() {
    this.load();
  }

  showOwner(): boolean {
    return this.session.role() !== ROLE_QA;
  }

  open(reportId: string): void {
    this.session.rememberCheck(reportId);
    void this.router.navigate(['/reports', reportId]);
  }

  onKey(event: KeyboardEvent, reportId: string, index: number): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.open(reportId);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const list = this.rows() ?? [];
    const nextIndex = event.key === 'ArrowDown' ? Math.min(index + 1, list.length - 1) : Math.max(index - 1, 0);
    const next = list[nextIndex];
    if (!next) return;
    document.getElementById(`report-row-${next.report_id}`)?.focus();
  }

  private load(): void {
    this.loading.set(true);
    this.error.set('');
    this.rows.set(null);
    this.api.reports().subscribe({
      next: (response) => {
        const reports = response.reports ?? [];
        if (this.session.role() === ROLE_QA) {
          const login = this.session.login();
          if (!login || reports.some((row) => row.owner_login !== login)) {
            this.loading.set(false);
            this.error.set(ACCESS_DENIED);
            return;
          }
        }
        if (reports.length === 0) {
          this.rows.set([]);
          this.loading.set(false);
          return;
        }
        forkJoin(reports.map((row) => this.loadRow(row))).subscribe({
          next: (rows) => {
            if (this.session.role() === ROLE_QA) {
              const login = this.session.login();
              if (!login || rows.some((row) => row.owner_login !== login)) {
                this.loading.set(false);
                this.error.set(ACCESS_DENIED);
                this.rows.set(null);
                return;
              }
            }
            this.rows.set(rows);
            this.loading.set(false);
          },
          error: (error: unknown) => {
            this.loading.set(false);
            this.rows.set(null);
            this.error.set(errorText(error, 'Не удалось открыть отчёты.'));
          },
        });
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.rows.set(null);
        this.error.set(errorText(error, 'Не удалось загрузить отчёты.'));
      },
    });
  }

  private loadRow(row: ReportListItem) {
    if (row.static_summary !== undefined && row.ai_status !== undefined && row.lighthouse_status !== undefined) {
      return of(toRow(row, row.static_summary, row.ai_status, row.lighthouse_status));
    }
    return this.api.report(row.report_id).pipe(
      map((report) => toRow(row, report.static?.summary ?? '', report.ai?.status ?? '', report.lighthouse?.status ?? '')),
      catchError((error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === 403) {
          throw error;
        }
        return of(toRow(row, '', '', ''));
      }),
    );
  }
}

function toRow(row: ReportListItem, staticSummary: string, aiStatus: string, lhStatus: string): ReportRow {
  return { ...row, staticSummary, aiStatus, lhStatus };
}

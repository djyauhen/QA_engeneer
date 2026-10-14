import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { errorText } from '../core/http-error';
import { formatTimestamp } from '../core/format';
import { ROLE_QA, ReportListItem, ReportRow } from '../core/models';
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
        <div class="table-scroll">
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
                  class="clickable"
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
        </div>
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
        let reports = response.reports ?? [];
        if (this.session.role() === ROLE_QA) {
          const login = this.session.login();
          reports = login ? reports.filter((row) => row.owner_login === login) : [];
        }
        this.rows.set(reports.map((row) => toRow(row)));
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.rows.set(null);
        this.error.set(errorText(error, 'Не удалось загрузить отчёты.'));
      },
    });
  }
}

function toRow(row: ReportListItem): ReportRow {
  return {
    ...row,
    staticSummary: row.static_summary ?? '',
    aiStatus: row.ai_status ?? '',
    lhStatus: row.lighthouse_status ?? '',
  };
}

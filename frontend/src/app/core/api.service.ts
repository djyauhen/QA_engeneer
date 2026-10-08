import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  AdminRules,
  CatalogItem,
  CheckView,
  ReportListItem,
  ReportPayload,
  Role,
  UserRow,
} from './models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl.replace(/\/$/, '');

  login(login: string, password: string): Observable<{ role: Role; session_id: string }> {
    return this.http.post<{ role: Role; session_id: string }>(this.url('/session'), { login, password });
  }

  currentSession(): Observable<{ role: Role }> {
    return this.http.get<{ role: Role }>(this.url('/session'));
  }

  logout(): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(this.url('/session'));
  }

  catalog(): Observable<{ items: CatalogItem[] }> {
    return this.http.get<{ items: CatalogItem[] }>(this.url('/catalog'));
  }

  refreshCatalog(): Observable<{ items: CatalogItem[] }> {
    return this.http.post<{ items: CatalogItem[] }>(this.url('/catalog/refresh'), {});
  }

  startCheck(body: { human_id: string; uuid?: string }): Observable<{ check_id: string }> {
    return this.http.post<{ check_id: string }>(this.url('/checks'), body);
  }

  check(checkId: string): Observable<CheckView> {
    return this.http.get<CheckView>(this.url(`/checks/${encodeURIComponent(checkId)}`));
  }

  aiDecision(checkId: string, decision: 'allow' | 'deny'): Observable<{ decision: 'allow' | 'deny' }> {
    return this.http.post<{ decision: 'allow' | 'deny' }>(
      this.url(`/checks/${encodeURIComponent(checkId)}/ai-decision`),
      { decision },
    );
  }

  standActions(checkId: string): Observable<{ actions_allowed: true }> {
    return this.http.post<{ actions_allowed: true }>(
      this.url(`/checks/${encodeURIComponent(checkId)}/stand-actions`),
      { decision: 'allow' },
    );
  }

  reports(): Observable<{ reports: ReportListItem[] }> {
    return this.http.get<{ reports: ReportListItem[] }>(this.url('/reports'));
  }

  report(reportId: string): Observable<ReportPayload> {
    return this.http.get<ReportPayload>(this.url(`/reports/${encodeURIComponent(reportId)}`));
  }

  previousReport(reportId: string): Observable<{ report: ReportPayload | null }> {
    return this.http.get<{ report: ReportPayload | null }>(
      this.url(`/reports/${encodeURIComponent(reportId)}/previous`),
    );
  }

  rules(): Observable<AdminRules> {
    return this.http.get<AdminRules>(this.url('/admin/rules'));
  }

  saveRules(body: AdminRules): Observable<AdminRules> {
    return this.http.put<AdminRules>(this.url('/admin/rules'), body);
  }

  costs(): Observable<{ usage_reported: false } | { usage_reported: true; provider_usage: Record<string, unknown>[] }> {
    return this.http.get<{ usage_reported: false } | { usage_reported: true; provider_usage: Record<string, unknown>[] }>(
      this.url('/admin/costs'),
    );
  }

  users(): Observable<{ users: UserRow[] }> {
    return this.http.get<{ users: UserRow[] }>(this.url('/admin/users'));
  }

  createUser(body: { login: string; password: string; role: Role }): Observable<{ login: string; role: string }> {
    return this.http.post<{ login: string; role: string }>(this.url('/admin/users'), body);
  }

  private url(path: string): string {
    return `${this.base}${path}`;
  }
}

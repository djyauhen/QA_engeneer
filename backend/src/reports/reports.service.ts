import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SessionUser } from '../config';
import { sanitizeReport } from '../redact';
import { ROLE_TL } from '../roles';
import { ReportPayload } from './report.types';
import { FORBIDDEN_BODY, REPORTS_REPO } from '../tokens';
import { ReportsRepo } from '../storage/repos';

@Injectable()
export class ReportsService {
  constructor(@Inject(REPORTS_REPO) private readonly reports: ReportsRepo) {}

  async list(user: SessionUser) {
    const owner = user.role === ROLE_TL ? null : user.login;
    const reports = await this.reports.list(owner, new Date());
    return {
      reports: reports.map((report) => ({
        report_id: report.report_id,
        human_id: report.human_id,
        name: report.name,
        created_at: report.created_at,
        owner_login: report.owner_login,
        static_summary: report.static_summary,
        ai_status: report.ai_status,
        lighthouse_status: report.lighthouse_status,
      })),
    };
  }

  async get(user: SessionUser, id: string): Promise<ReportPayload> {
    const payload = await this.accessible(user, id);
    return sanitizeReport(payload);
  }

  async previous(user: SessionUser, id: string): Promise<{ report: ReportPayload | null }> {
    const current = await this.accessible(user, id);
    const previous = await this.reports.findPrevious({
      humanId: current.human_id,
      before: current.created_at,
      ownerLogin: user.role === ROLE_TL ? null : user.login,
      excludeId: id,
      now: new Date(),
    });
    return { report: previous ? sanitizeReport(previous) : null };
  }

  private async accessible(user: SessionUser, id: string): Promise<ReportPayload> {
    const payload = await this.reports.get(id);
    if (!payload) throw new NotFoundException({ error: 'not_found' });
    if (user.role !== ROLE_TL && payload.owner_login !== user.login) {
      throw new ForbiddenException(FORBIDDEN_BODY);
    }
    return payload;
  }
}

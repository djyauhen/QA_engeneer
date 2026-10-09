import fs from 'fs';
import path from 'path';
import { Inject, Injectable } from '@nestjs/common';
import { AiClient } from '../ai/ai.client';
import { completeFindings } from '../ai/ai.client';
import { AioClient, AioDownloadError } from '../aio/aio.client';
import { CostsService } from '../admin/admin.services';
import { RulesService } from '../admin/admin.services';
import { unpackZip } from '../files/unpack';
import { WorkdirService } from '../files/workdir.service';
import { LighthouseRunner } from '../lighthouse/lighthouse';
import { effectiveLanguages } from '../rules/rules';
import { sanitizeReport } from '../redact';
import { ReportPayload } from '../reports/report.types';
import { REPORTS_REPO } from '../tokens';
import {
  AI_STATUS_ERROR,
  AI_STATUS_READY,
  AI_STATUS_WAITING,
  LH_STATUS_DONE,
  LH_STATUS_ERROR,
  STATIC_SUMMARY_INCOMPLETE,
} from '../tokens';
import { ReportsRepo } from '../storage/repos';
import { getAllFilesByExtensions, relFromLanding } from '../static/landing-utils';
import { StaticChecks, summarizeStatic } from '../static/static-checks';
import { PreviewService } from '../stand/preview.service';
import { abortError, CheckRecord, isAbort } from './check.record';
import { ATTEMPTS, HaltAttempts, withAttempts } from './retry';

@Injectable()
export class CheckOrchestrator {
  constructor(
    @Inject(AioClient) private readonly aio: AioClient,
    @Inject(StaticChecks) private readonly staticChecks: StaticChecks,
    @Inject(AiClient) private readonly ai: AiClient,
    @Inject(LighthouseRunner) private readonly lighthouse: LighthouseRunner,
    private readonly rules: RulesService,
    private readonly costs: CostsService,
    private readonly workdir: WorkdirService,
    private readonly preview: PreviewService,
    @Inject(REPORTS_REPO) private readonly reports: ReportsRepo,
  ) {}

  async run(check: CheckRecord): Promise<void> {
    try {
      await this.execute(check);
    } catch (error) {
      if (!check.reportSaved) {
        this.skipPending(check);
        try {
          await this.saveReport(check);
        } catch {
          if (!isAbort(error)) {
            /* The stored report is the durable result. A second failure leaves the check steps. */
          }
        }
      }
    }
  }

  private async execute(check: CheckRecord): Promise<void> {
    this.throwIfAborted(check);
    await this.download(check);
    this.throwIfAborted(check);
    await this.unpack(check);
    this.throwIfAborted(check);
    await this.staticPhase(check);
    this.throwIfAborted(check);
    const failed = check.staticBlock?.items.some((entry) => entry.status === 'failed') ?? false;
    if (failed) {
      check.aiBlock = { status: AI_STATUS_WAITING, findings: [], decision: null };
      check.step('ai_gate', 'waiting_user');
      const decision = await check.waitDecision();
      this.throwIfAborted(check);
      if (check.aiBlock) check.aiBlock.decision = decision;
      check.step('ai_gate', 'done');
      if (decision === 'deny') {
        check.step('stand', 'skipped');
        check.step('ai', 'skipped');
        check.step('lighthouse', 'skipped');
        await this.saveReport(check);
        return;
      }
    } else {
      check.step('ai_gate', 'done');
    }
    const standOk = await this.raiseStand(check);
    this.throwIfAborted(check);
    if (standOk) {
      await Promise.all([this.runAi(check), this.runLighthouse(check)]);
    } else {
      check.step('lighthouse', 'skipped', 'Стенд не поднят, прогон Lighthouse невозможен');
      await this.runAi(check);
    }
    await this.saveReport(check);
  }

  private async download(check: CheckRecord): Promise<void> {
    try {
      await withAttempts(ATTEMPTS, async (attempt) => {
        check.step('download_request', attempt === 1 ? 'running' : 'retrying');
        await this.aio.requestDownload(check.card.uuid);
      });
      check.step('download_request', 'done');
    } catch {
      check.step('download_request', 'failed', 'Сбой запроса на скачивание после повторов');
      throw new Error('download-request-failed');
    }
    let original: { read(): Promise<Buffer> } | null = null;
    try {
      await withAttempts(ATTEMPTS, async (attempt) => {
        check.step('notifications', attempt === 1 ? 'running' : 'retrying');
        original = await this.aio.findOriginal(check.card.uuid);
      });
      check.step('notifications', 'done');
    } catch {
      check.step('notifications', 'failed', 'Сбой опроса уведомлений после повторов');
      throw new Error('notifications-failed');
    }
    try {
      await withAttempts(ATTEMPTS, async (attempt) => {
        check.step('download_file', attempt === 1 ? 'running' : 'retrying');
        if (!original) throw new HaltAttempts(new Error('no-file'));
        try {
          check.zip = await original.read();
        } catch (error) {
          if (error instanceof AioDownloadError && error.permanent) throw new HaltAttempts(error);
          throw error;
        }
      });
      check.step('download_file', 'done');
    } catch (error) {
      check.step('download_file', 'failed', downloadFailureText(error));
      throw new Error('download-file-failed');
    }
  }

  private async unpack(check: CheckRecord): Promise<void> {
    try {
      await withAttempts(ATTEMPTS, async (attempt) => {
        check.step('unpack', attempt === 1 ? 'running' : 'retrying');
        if (!check.zip) throw new Error('no-zip');
        const prepared = this.workdir.prepare(check.ownerLogin);
        check.replaced_previous_stand = check.replaced_previous_stand || prepared.replaced;
        const unpacked = unpackZip(check.zip, prepared.dir);
        check.projectPath = unpacked.projectPath;
        check.landingFolder = unpacked.landingFolder;
      });
      check.zip = null;
      check.step('unpack', 'done');
    } catch {
      check.zip = null;
      check.step('unpack', 'failed', 'Сбой распаковки после повторов');
      throw new Error('unpack-failed');
    }
  }

  private async staticPhase(check: CheckRecord): Promise<void> {
    const rules = await this.rules.current();
    try {
      const items = await withAttempts(ATTEMPTS, async (attempt) => {
        check.step('static', attempt === 1 ? 'running' : 'retrying');
        if (!check.projectPath) throw new Error('no-project');
        return this.staticChecks.run(check.projectPath, rules);
      });
      check.staticBlock = { summary: summarizeStatic(items), items };
      check.step('static', 'done');
    } catch {
      check.staticBlock = { summary: STATIC_SUMMARY_INCOMPLETE, items: check.staticBlock?.items ?? [] };
      check.step('static', 'failed', 'Ошибка статики после повторов');
      throw new Error('static-failed');
    }
  }

  private async raiseStand(check: CheckRecord): Promise<boolean> {
    try {
      await withAttempts(ATTEMPTS, async (attempt) => {
        check.step('stand', attempt === 1 ? 'running' : 'retrying');
        if (!check.landingFolder) throw new Error('no-landing');
        const indexName = fs.existsSync(path.join(check.landingFolder, 'index.html')) ? 'index.html' : 'index.php';
        if (!fs.existsSync(path.join(check.landingFolder, indexName))) throw new Error('no-index');
        check.standUrl = this.preview.standUrl(check.id, indexName);
        check.standReady = true;
      });
      check.step('stand', 'done');
      return true;
    } catch {
      check.standReady = false;
      check.standUrl = null;
      check.step('stand', 'failed', 'Сбой развёртывания после повторов');
      return false;
    }
  }

  private async runAi(check: CheckRecord): Promise<void> {
    check.step('ai', 'running');
    try {
      const result = await withAttempts(ATTEMPTS, async (attempt) => {
        if (attempt > 1) check.step('ai', 'retrying');
        const rules = await this.rules.current();
        const languages = effectiveLanguages(check.card.languages, rules);
        check.effectiveLanguages = languages;
        return this.ai.review({
          name: check.card.name,
          languages,
          countries: check.card.countries,
          standUrl: check.standUrl,
          files: check.landingFolder ? readTexts(check.landingFolder) : [],
        });
      });
      if (result.usage && typeof result.usage === 'object') {
        await this.costs.record(result.usage);
      }
      check.aiBlock = {
        status: AI_STATUS_READY,
        findings: completeFindings(result.findings),
        decision: check.aiBlock?.decision ?? null,
      };
      check.step('ai', 'done');
    } catch {
      check.aiBlock = {
        status: AI_STATUS_ERROR,
        findings: [],
        decision: check.aiBlock?.decision ?? null,
      };
      check.step('ai', 'failed', 'Ошибка ИИ после повторов');
    }
  }

  private async runLighthouse(check: CheckRecord): Promise<void> {
    if (!check.standUrl) {
      check.lighthouseBlock = { status: LH_STATUS_ERROR, mobile: null, desktop: null };
      check.step('lighthouse', 'failed', 'Ошибка Lighthouse после повторов');
      return;
    }
    const url = check.standUrl;
    check.step('lighthouse', 'running');
    try {
      const mobile = await withAttempts(ATTEMPTS, async (attempt) => {
        if (attempt > 1) check.step('lighthouse', 'retrying');
        return this.lighthouse.run(url, 'mobile');
      });
      const desktop = await withAttempts(ATTEMPTS, async (attempt) => {
        if (attempt > 1) check.step('lighthouse', 'retrying');
        return this.lighthouse.run(url, 'desktop');
      });
      check.lighthouseBlock = { status: LH_STATUS_DONE, mobile, desktop };
      check.step('lighthouse', 'done');
    } catch {
      check.lighthouseBlock = { status: LH_STATUS_ERROR, mobile: null, desktop: null };
      check.step('lighthouse', 'failed', 'Ошибка Lighthouse после повторов');
    }
  }

  private async saveReport(check: CheckRecord): Promise<void> {
    if (check.reportSaved) return;
    const rules = await this.rules.current();
    const languages = check.effectiveLanguages ?? effectiveLanguages(check.card.languages, rules);
    const createdAt = new Date().toISOString();
    const payload = sanitizeReport<ReportPayload>({
      report_id: check.id,
      human_id: check.card.human_id,
      name: check.card.name,
      owner_login: check.ownerLogin,
      created_at: createdAt,
      countries: [...check.card.countries],
      languages,
      steps: check.steps.map((step) => ({
        name: step.name,
        state: step.state,
        ...(step.message ? { message: step.message } : {}),
      })),
      static: check.staticBlock,
      ai: check.aiBlock,
      lighthouse: check.lighthouseBlock,
      replaced_previous_stand: check.replaced_previous_stand,
    });
    await this.reports.insert({
      id: check.id,
      human_id: check.card.human_id,
      owner_login: check.ownerLogin,
      created_at: createdAt,
      payload,
    });
    check.reportSaved = true;
    check.step('report', 'done');
  }

  private skipPending(check: CheckRecord): void {
    for (const step of check.steps) {
      if (step.name === 'report') continue;
      if (step.state === 'pending' || step.state === 'running' || step.state === 'retrying' || step.state === 'waiting_user') {
        step.state = 'skipped';
      }
    }
  }

  private throwIfAborted(check: CheckRecord): void {
    if (check.aborted) throw abortError();
  }
}

function downloadFailureText(error: unknown): string {
  const base = 'Сбой скачивания файла после повторов';
  if (error instanceof AioDownloadError) {
    if (error.status !== null) return `${base}: HTTP ${error.status}`;
    if (error.message.includes('обрыв тела')) return `${base}: обрыв тела`;
    return `${base}: сеть`;
  }
  if (error instanceof Error && error.message === 'no-file') return `${base}: нет файла`;
  return base;
}

function readTexts(landingFolder: string): Array<{ path: string; text: string }> {
  return getAllFilesByExtensions(landingFolder, ['.html', '.php', '.css', '.js'])
    .slice(0, 40)
    .map((filePath) => ({
      path: relFromLanding(landingFolder, filePath),
      text: fs.readFileSync(filePath, 'utf8').slice(0, 100_000),
    }));
}

import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AiCallError, AiClient, completeFindings } from '../ai/ai.client';
import { AiMaterials, buildAiMaterials } from '../ai/materials';
import { captureOutletReference } from '../ai/outlet-capture';
import { matchOutlet } from '../ai/outlets';
import { QA_INSTRUCTION } from '../ai/qa-instruction';
import { AioClient, AioDownloadError } from '../aio/aio.client';
import { CostsService } from '../admin/admin.services';
import { RulesService } from '../admin/admin.services';
import { AppConfig } from '../config';
import { unpackZip } from '../files/unpack';
import { WorkdirService } from '../files/workdir.service';
import { LighthouseRunner } from '../lighthouse/lighthouse';
import { cloneRules, effectiveLanguages, expectFormMacroForLander } from '../rules/rules';
import { sanitizeReport } from '../redact';
import { ReportPayload } from '../reports/report.types';
import { APP_CONFIG, CHECK_ARCHIVES_REPO, REPORTS_REPO } from '../tokens';
import {
  AI_STATUS_ERROR,
  AI_STATUS_READY,
  AI_STATUS_SKIPPED,
  AI_STATUS_WAITING,
  LH_STATUS_DONE,
  LH_STATUS_ERROR,
  LH_STATUS_SKIPPED,
  STATIC_SUMMARY_INCOMPLETE,
} from '../tokens';
import { CheckArchivesRepo, ReportsRepo } from '../storage/repos';
import { StaticChecks, summarizeStatic } from '../static/static-checks';
import { captureStandJpeg, wantsVisualCapture } from '../stand/capture';
import { PreviewService } from '../stand/preview.service';
import { abortError, CheckRecord, isAbort } from './check.record';
import { ATTEMPTS, HaltAttempts, withAttempts } from './retry';

@Injectable()
export class CheckOrchestrator {
  private readonly logger = new Logger(CheckOrchestrator.name);

  constructor(
    @Inject(AioClient) private readonly aio: AioClient,
    @Inject(StaticChecks) private readonly staticChecks: StaticChecks,
    @Inject(AiClient) private readonly ai: AiClient,
    @Inject(LighthouseRunner) private readonly lighthouse: LighthouseRunner,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly rules: RulesService,
    private readonly costs: CostsService,
    private readonly workdir: WorkdirService,
    private readonly preview: PreviewService,
    @Inject(REPORTS_REPO) private readonly reports: ReportsRepo,
    @Inject(CHECK_ARCHIVES_REPO) private readonly archives: CheckArchivesRepo,
  ) {}

  async run(check: CheckRecord): Promise<void> {
    if (check.detached || (check.aborted && check.resumeArmed)) return;
    if (check.running) {
      check.rerun = true;
      return;
    }
    check.running = true;
    try {
      await this.execute(check);
    } catch (error) {
      if (!check.reportSaved && !check.detached) {
        this.skipPending(check);
        try {
          await this.saveReport(check);
        } catch (second) {
          if (!isAbort(error)) {
            const detail = second instanceof Error ? second.message : 'save failed';
            this.logger.error(`report save failed: ${detail}`);
            check.step('report', 'failed', 'Не удалось записать отчёт');
          }
        }
      }
    } finally {
      check.running = false;
      if (check.rerun && !check.detached) {
        check.rerun = false;
        await this.run(check);
      }
    }
  }

  private async execute(check: CheckRecord): Promise<void> {
    if (check.detached || check.reportSaved) return;
    this.throwIfAborted(check);
    if (this.failedStep(check)) {
      await this.saveReport(check);
      return;
    }
    if (this.needs(check, 'download_file')) await this.download(check);
    this.throwIfAborted(check);
    if (check.state('download_file') === 'done') await this.ensureFiles(check);
    this.throwIfAborted(check);
    if (this.needs(check, 'static')) await this.staticPhase(check);
    this.throwIfAborted(check);
    if (this.failedStep(check)) {
      await this.saveReport(check);
      return;
    }
    if (check.state('ai_gate') === 'pending') {
      const failed = check.staticBlock?.items.some((entry) => entry.status === 'failed') ?? false;
      if (failed) {
        check.aiBlock = { status: AI_STATUS_WAITING, findings: [], decision: null, mode: 'real' };
        check.step('ai_gate', 'waiting_user');
      } else {
        check.step('ai_gate', 'done');
      }
    }
    if (check.state('ai_gate') === 'waiting_user') {
      const decision = check.takeQueuedDecision();
      if (!decision) {
        check.resumeArmed = true;
        return;
      }
      check.resumeArmed = false;
      if (check.aiBlock) check.aiBlock.decision = decision;
      check.step('ai_gate', 'done');
      if (decision === 'deny') {
        check.step('stand', 'skipped');
        check.step('ai', 'skipped');
        check.step('lighthouse', 'skipped');
        await this.saveReport(check);
        return;
      }
    }
    let standOk = check.standReady;
    if (this.needs(check, 'stand')) standOk = await this.raiseStand(check);
    this.throwIfAborted(check);
    const screenshot = await this.captureVisual(check, standOk);
    if (standOk) {
      await Promise.all([this.runAi(check, screenshot), this.runLighthouse(check)]);
    } else if (this.needs(check, 'lighthouse') || check.state('lighthouse') === 'pending') {
      check.step('lighthouse', 'skipped', 'Стенд не поднят, прогон Lighthouse невозможен');
      await this.runAi(check, null);
    } else if (this.needs(check, 'ai')) {
      await this.runAi(check, null);
    }
    if (!check.reportSaved) await this.saveReport(check);
  }

  private needs(check: CheckRecord, name: Parameters<CheckRecord['state']>[0]): boolean {
    const state = check.state(name);
    return state === 'pending' || state === 'running' || state === 'retrying';
  }

  private failedStep(check: CheckRecord): boolean {
    return check.steps.some((step) => step.state === 'failed');
  }

  private async download(check: CheckRecord): Promise<void> {
    try {
      await withAttempts(ATTEMPTS, async (attempt) => {
        check.step('download_request', attempt === 1 ? 'running' : 'retrying');
        await this.aio.requestDownload(check.card.uuid);
      });
      check.step('download_request', 'done');
    } catch (error) {
      const detail = aioFailureDetail(error);
      check.step(
        'download_request',
        'failed',
        detail ? `Сбой запроса на скачивание после повторов: ${detail}` : 'Сбой запроса на скачивание после повторов',
      );
      throw new Error('download-request-failed');
    }
    let original: { read(signal?: AbortSignal): Promise<Buffer> } | null = null;
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
          if (check.aborted) throw new HaltAttempts(abortError());
          check.zip = await original.read(check.signal);
          await this.archives.put(check.id, check.zip);
        } catch (error) {
          if (check.aborted || isAbort(error)) throw new HaltAttempts(abortError());
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
        if (!check.zip) check.zip = await this.archives.get(check.id);
        if (!check.zip) throw new HaltAttempts(new Error('no-zip'));
        try {
          const unpacked = unpackZip(check.zip, this.workdir.directory(check.id));
          check.projectPath = unpacked.projectPath;
          check.landingFolder = unpacked.landingFolder;
        } catch (error) {
          if (permanentUnpackError(error)) throw new HaltAttempts(error);
          throw error;
        }
      });
      check.zip = null;
      check.step('unpack', 'done');
    } catch (error) {
      check.zip = null;
      check.step('unpack', 'failed', unpackFailureText(error));
      throw new Error('unpack-failed');
    }
  }

  private async staticPhase(check: CheckRecord): Promise<void> {
    const stored = await this.rules.current();
    const rules = cloneRules(stored);
    rules.expectFormMacro = expectFormMacroForLander(check.card.lander_type_name, stored.expectFormMacro);
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

  private async ensureFiles(check: CheckRecord): Promise<void> {
    if (check.landingFolder && fs.existsSync(check.landingFolder)) {
      if (check.state('unpack') === 'pending') check.step('unpack', 'done');
      return;
    }
    if (!check.zip) check.zip = await this.archives.get(check.id);
    if (!check.zip) return;
    const unpacked = unpackZip(check.zip, this.workdir.directory(check.id));
    check.projectPath = unpacked.projectPath;
    check.landingFolder = unpacked.landingFolder;
    check.zip = null;
    if (check.state('unpack') === 'pending' || check.state('unpack') === 'running' || check.state('unpack') === 'retrying') {
      check.step('unpack', 'done');
    }
  }

  private async raiseStand(check: CheckRecord): Promise<boolean> {
    try {
      await withAttempts(ATTEMPTS, async (attempt) => {
        check.step('stand', attempt === 1 ? 'running' : 'retrying');
        if (!check.landingFolder) throw new Error('no-landing');
        const indexName = fs.existsSync(path.join(check.landingFolder, 'index.html')) ? 'index.html' : 'index.php';
        if (!fs.existsSync(path.join(check.landingFolder, indexName))) throw new Error('no-index');
        check.standUrl = this.preview.standUrl(check.id, indexName, check.previewToken);
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

  private async captureVisual(check: CheckRecord, standOk: boolean): Promise<Buffer | null> {
    if (!standOk || !wantsVisualCapture(this.config.visualMode, check.standUrl)) return null;
    try {
      return await captureStandJpeg(check.standUrl as string, this.config.visualChromePath);
    } catch (error) {
      const detail = error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, '[url]') : 'capture failed';
      this.logger.error(`visual capture failed: ${detail}`);
      return null;
    }
  }

  private async runAi(check: CheckRecord, screenshot: Buffer | null): Promise<void> {
    if (check.state('ai') === 'done' || check.state('ai') === 'skipped' || check.state('ai') === 'failed') return;
    this.throwIfAborted(check);
    check.step('ai', 'running');
    const checkDate = new Date().toISOString().slice(0, 10);
    let materials: AiMaterials | null = null;
    try {
      if (check.landingFolder && fs.existsSync(check.landingFolder)) {
        materials = buildAiMaterials(check.landingFolder, check.card.name, checkDate);
      }
    } catch (error) {
      this.logger.error(`ai materials failed: ${error instanceof Error ? error.name : 'error'}`);
    }
    const outlet = materials ? matchOutlet(`${check.card.name}\n${materials.pageText}`) : null;
    const chromePath = this.config.aiMode === 'real' ? this.config.visualChromePath.trim() : '';
    const reference =
      outlet && chromePath
        ? await captureOutletReference({
            chromePath,
            outletUrl: outlet.url,
            standUrl: check.standUrl,
          })
        : null;
    if (outlet && chromePath && !reference) {
      this.logger.error(`outlet capture failed: ${outlet.name}`);
    }
    const outletRef =
      outlet && reference
        ? { name: outlet.name, url: outlet.url, header: reference.header, footer: reference.footer }
        : null;
    try {
      const result = await withAttempts(ATTEMPTS, async (attempt) => {
        if (check.aborted) throw new HaltAttempts(abortError());
        if (attempt > 1) check.step('ai', 'retrying');
        const rules = await this.rules.current();
        const languages = effectiveLanguages(check.card.languages, rules);
        check.effectiveLanguages = languages;
        return this.ai.review({
          name: check.card.name,
          languages,
          countries: check.card.countries,
          standUrl: check.standUrl,
          files: [],
          screenshot,
          checkDate,
          outlet: outletRef,
          landingFooter: reference?.landingFooter ?? null,
          ...(materials
            ? { pageText: materials.pageText, person: materials.person, images: materials.images }
            : {}),
        });
      });
      if (result.skipped) {
        check.aiBlock = {
          status: AI_STATUS_SKIPPED,
          findings: [],
          decision: check.aiBlock?.decision ?? null,
          mode: 'stub',
        };
        check.step('ai', 'skipped');
        return;
      }
      if (result.usage && typeof result.usage === 'object') {
        await this.costs.record(result.usage);
      }
      check.aiBlock = {
        status: AI_STATUS_READY,
        findings: completeFindings(result.findings),
        decision: check.aiBlock?.decision ?? null,
        mode: 'real',
      };
      if (result.report) {
        const { report_markdown, general, checks, clarifications } = result.report;
        const images = materials?.images ?? [];
        check.aiBlock = {
          ...check.aiBlock,
          schema_version: 2,
          report_markdown,
          general,
          checks,
          clarifications,
          meta: {
            instruction_sha: createHash('sha256').update(QA_INSTRUCTION).digest('hex'),
            images_sent: images.length,
            text_truncated: materials?.textTruncated ?? false,
            vision: images.length > 0 || !!screenshot || !!outletRef,
            outlet_url: outletRef?.url ?? null,
            person_from_name: materials?.person.from_land_name ?? null,
            person_from_text: materials?.person.from_page_text ?? null,
            person_conflict: materials?.person.conflict ?? false,
          },
        };
      }
      check.step('ai', 'done');
    } catch (error) {
      if (isAbort(error) || check.aborted) throw error instanceof Error ? error : abortError();
      check.aiBlock = {
        status: AI_STATUS_ERROR,
        findings: [],
        decision: check.aiBlock?.decision ?? null,
        mode: 'real',
      };
      const detail = error instanceof AiCallError ? error.detail : '';
      check.step('ai', 'failed', detail ? `Ошибка ИИ после повторов: ${detail}` : 'Ошибка ИИ после повторов');
    }
  }

  private async runLighthouse(check: CheckRecord): Promise<void> {
    if (check.state('lighthouse') === 'done' || check.state('lighthouse') === 'skipped' || check.state('lighthouse') === 'failed') {
      return;
    }
    this.throwIfAborted(check);
    if (this.lighthouse.mode() === 'stub') {
      check.lighthouseBlock = { status: LH_STATUS_SKIPPED, mobile: null, desktop: null, mode: 'stub' };
      check.step('lighthouse', 'skipped');
      return;
    }
    if (!check.standUrl) {
      check.lighthouseBlock = { status: LH_STATUS_ERROR, mobile: null, desktop: null };
      check.step('lighthouse', 'failed', 'Ошибка Lighthouse после повторов');
      return;
    }
    const url = check.standUrl;
    check.step('lighthouse', 'running');
    try {
      const mobile = await withAttempts(ATTEMPTS, async (attempt) => {
        if (check.aborted) throw new HaltAttempts(abortError());
        if (attempt > 1) check.step('lighthouse', 'retrying');
        return this.lighthouse.run(url, 'mobile');
      });
      const desktop = await withAttempts(ATTEMPTS, async (attempt) => {
        if (check.aborted) throw new HaltAttempts(abortError());
        if (attempt > 1) check.step('lighthouse', 'retrying');
        return this.lighthouse.run(url, 'desktop');
      });
      check.lighthouseBlock = { status: LH_STATUS_DONE, mobile, desktop, mode: 'real' };
      check.step('lighthouse', 'done');
    } catch (error) {
      if (isAbort(error) || check.aborted) throw error instanceof Error ? error : abortError();
      check.lighthouseBlock = { status: LH_STATUS_ERROR, mobile: null, desktop: null, mode: 'real' };
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

const PERMANENT_UNPACK_CODES = new Set(['EROFS', 'EPERM', 'EACCES', 'ENOSPC', 'ENOENT', 'ENOTDIR', 'EISDIR']);

function permanentUnpackError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (
    error.message === 'no-zip' ||
    error.message === 'Недопустимый путь в архиве' ||
    error.message === 'Не удалось определить каталог ленда'
  ) {
    return true;
  }
  const code = (error as NodeJS.ErrnoException).code;
  return !!code && PERMANENT_UNPACK_CODES.has(code);
}

function unpackFailureText(error: unknown): string {
  const base = 'Сбой распаковки после повторов';
  if (!(error instanceof Error)) return base;
  if (error.message === 'no-zip') return `${base}: нет архива`;
  if (error.message === 'Недопустимый путь в архиве' || error.message === 'Не удалось определить каталог ленда') {
    return `${base}: ${error.message}`;
  }
  const code = (error as NodeJS.ErrnoException).code;
  if (code && PERMANENT_UNPACK_CODES.has(code)) return `${base}: ${code}`;
  return base;
}

function aioFailureDetail(error: unknown): string {
  if (!(error instanceof Error) || !error.message.startsWith('Сбой вызова AIO')) return '';
  return error.message.slice('Сбой вызова AIO'.length).replace(/^:\s*/, '');
}

function downloadFailureText(error: unknown): string {
  const base = 'Сбой скачивания файла после повторов';
  if (error instanceof AioDownloadError) {
    if (error.status !== null) return `${base}: HTTP ${error.status}`;
    if (error.message.includes('обрыв тела')) return `${base}: обрыв тела`;
    if (error.message.includes('адрес отклонён')) return `${base}: адрес отклонён`;
    return `${base}: сеть`;
  }
  if (error instanceof Error && error.message === 'no-file') return `${base}: нет файла`;
  return base;
}
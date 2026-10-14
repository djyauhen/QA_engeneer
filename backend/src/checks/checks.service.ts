import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { waitUntil } from '@vercel/functions';
import { SessionUser } from '../config';
import { CatalogService } from '../catalog/catalog.service';
import { toChoiceRow } from '../catalog/map-row';
import { ACTIVE_CHECKS_REPO, FORBIDDEN_BODY } from '../tokens';
import { ActiveChecksRepo } from '../storage/repos';
import { CheckRecord } from './check.record';
import { CheckStore } from './check.store';
import { CheckOrchestrator } from './orchestrator';
import { leaseDeadline } from './check.store';
import { recordFromSnapshot, viewFromRecord, viewFromSnapshot } from './snapshot';

@Injectable()
export class ChecksService implements OnModuleInit {
  constructor(
    private readonly catalog: CatalogService,
    private readonly store: CheckStore,
    private readonly orchestrator: CheckOrchestrator,
    @Inject(ACTIVE_CHECKS_REPO) private readonly active: ActiveChecksRepo,
  ) {}

  onModuleInit(): void {
    this.store.setContinueListener((check) => {
      check.finished = this.orchestrator.run(check);
      waitUntil(check.finished);
    });
  }

  async start(user: SessionUser, body: unknown): Promise<{ check_id: string }> {
    const input = parseStart(body);
    const resolved = await this.catalog.resolve(input.human_id, input.uuid);
    if (resolved.kind === 'collision') {
      throw new ConflictException({
        error: 'collision',
        message: 'Несколько строк с одним human_id. Скачивание не начато.',
        rows: resolved.rows.map(toChoiceRow),
      });
    }
    if (resolved.kind === 'not_found') {
      throw new NotFoundException({
        error: 'not_found',
        message: 'Ленд не найден среди последних 300. Скачивание не начато.',
      });
    }
    if (resolved.kind === 'pair_not_found') {
      throw new NotFoundException({
        error: 'pair_not_found',
        message: 'Пара human_id и uuid не найдена в кэше. Скачивание не начато.',
      });
    }
    const check = new CheckRecord(user.login, user.role, resolved.card);
    const previous = await this.active.listByOwner(user.login);
    if (previous.length > 0) check.replaced_previous_stand = true;
    check.step('catalog', 'done');
    this.store.add(check);
    check.finished = this.orchestrator.run(check);
    // The response returns immediately. On Vercel the invocation is cancelled with it
    // unless this promise is registered; locally waitUntil is a no-op.
    // The run returns at the human gate, so the invocation does not stay open while QA decides.
    waitUntil(check.finished);
    return { check_id: check.id };
  }

  async view(user: SessionUser, id: string): Promise<Record<string, unknown>> {
    const existing = this.store.get(id);
    if (existing && existing.ownerLogin !== user.login) throw new ForbiddenException(FORBIDDEN_BODY);
    if (!existing) await this.adoptOrphan(user, id);
    const local = this.store.get(id);
    if (local) return viewFromRecord(local);
    const row = await this.stored(user, id);
    return viewFromSnapshot(id, row.payload);
  }

  async decide(user: SessionUser, id: string, body: unknown): Promise<{ decision: 'allow' | 'deny' }> {
    const local = this.localOwned(user, id);
    if (local) {
      this.assertWaiting(local.state('ai_gate') === 'waiting_user');
      const decision = parseDecision(body);
      local.armClearPending();
      local.queueDecision(decision);
      local.resumeArmed = false;
      local.submit(decision);
      this.store.requestContinue(local);
      return { decision };
    }
    const row = await this.stored(user, id);
    const gate = row.payload.steps.find((step) => step.name === 'ai_gate')?.state;
    this.assertWaiting(gate === 'waiting_user');
    const decision = parseDecision(body);
    await this.active.patchDecision(id, decision);
    await this.claimAndResume(id, row.owner_login, decision);
    return { decision };
  }

  async allowStand(user: SessionUser, id: string, body: unknown): Promise<{ actions_allowed: true }> {
    const local = this.localOwned(user, id);
    if (local) {
      this.assertAllow(body);
      if (!local.standReady) {
        throw new ConflictException({ error: 'stand_not_ready', message: 'Стенд ещё не готов' });
      }
      local.actionsAllowed = true;
      return { actions_allowed: true };
    }
    const row = await this.stored(user, id);
    this.assertAllow(body);
    if (!row.payload.standReady) {
      throw new ConflictException({ error: 'stand_not_ready', message: 'Стенд ещё не готов' });
    }
    await this.active.patchActionsAllowed(id);
    return { actions_allowed: true };
  }

  private async adoptOrphan(user: SessionUser, id: string): Promise<void> {
    const row = await this.active.get(id);
    if (!row) return;
    if (row.owner_login !== user.login) throw new ForbiddenException(FORBIDDEN_BODY);
    if (row.payload.reportSaved || row.payload.aborted) return;
    const gate = row.payload.steps.find((step) => step.name === 'ai_gate');
    const decision = row.payload.pendingDecision;
    const waiting = gate?.state === 'waiting_user' && (decision === 'allow' || decision === 'deny');
    const active = row.payload.steps.some((step) => step.state === 'running' || step.state === 'retrying');
    if (!waiting && !active) return;
    await this.claimAndResume(id, row.owner_login, waiting ? decision ?? undefined : undefined);
  }

  private async claimAndResume(id: string, ownerLogin: string, decision?: 'allow' | 'deny'): Promise<void> {
    if (this.store.get(id)) return;
    const claimed = await this.active.tryClaim(id, this.store.leaseOwner, leaseDeadline());
    if (!claimed) return;
    const fresh = await this.active.get(id);
    if (!fresh || fresh.owner_login !== ownerLogin) {
      await this.active.releaseLease(id, this.store.leaseOwner);
      return;
    }
    const check = recordFromSnapshot(id, fresh.payload);
    if (decision) {
      check.armClearPending();
      check.queueDecision(decision);
    }
    this.store.attachAdopted(check);
    this.store.requestContinue(check);
  }

  private localOwned(user: SessionUser, id: string): CheckRecord | null {
    const check = this.store.get(id);
    if (!check) return null;
    if (check.ownerLogin !== user.login) throw new ForbiddenException(FORBIDDEN_BODY);
    return check;
  }

  private async stored(user: SessionUser, id: string) {
    const row = await this.active.get(id);
    if (!row) throw new NotFoundException({ error: 'not_found' });
    if (row.owner_login !== user.login) throw new ForbiddenException(FORBIDDEN_BODY);
    return row;
  }

  private assertWaiting(waiting: boolean): void {
    if (waiting) return;
    throw new ConflictException({
      error: 'ai_decision_not_accepted',
      message: 'Решение по ИИ принимается только когда статика уже есть, в ней есть failed, а ИИ ещё не стартовал',
    });
  }

  private assertAllow(body: unknown): void {
    if (!body || typeof body !== 'object' || (body as { decision?: unknown }).decision !== 'allow') {
      throw new BadRequestException({ error: 'Некорректный запрос' });
    }
  }
}

function parseStart(body: unknown): { human_id: string; uuid?: string } {
  if (!body || typeof body !== 'object') throw new BadRequestException({ error: 'Некорректный запрос' });
  const record = body as Record<string, unknown>;
  if (typeof record.human_id !== 'string' || !record.human_id) {
    throw new BadRequestException({ error: 'Некорректный запрос' });
  }
  if (record.uuid != null && (typeof record.uuid !== 'string' || !record.uuid)) {
    throw new BadRequestException({ error: 'Некорректный запрос' });
  }
  return { human_id: record.human_id, uuid: typeof record.uuid === 'string' ? record.uuid : undefined };
}

function parseDecision(body: unknown): 'allow' | 'deny' {
  if (!body || typeof body !== 'object') throw new BadRequestException({ error: 'Некорректный запрос' });
  const decision = (body as { decision?: unknown }).decision;
  if (decision !== 'allow' && decision !== 'deny') {
    throw new BadRequestException({ error: 'Некорректный запрос' });
  }
  return decision;
}

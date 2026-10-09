import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ACTIVE_CHECKS_REPO } from '../tokens';
import { ActiveChecksRepo } from '../storage/repos';
import { CheckRecord } from './check.record';
import { toSnapshot } from './snapshot';

const ACTIONS_POLL_MS = 400;

@Injectable()
export class CheckStore implements OnModuleDestroy {
  private readonly logger = new Logger(CheckStore.name);
  private readonly byId = new Map<string, CheckRecord>();
  private readonly tails = new Map<string, Promise<void>>();
  private readonly actionTimers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(@Inject(ACTIVE_CHECKS_REPO) private readonly active: ActiveChecksRepo) {}

  add(check: CheckRecord): void {
    for (const existing of this.byId.values()) {
      if (existing.ownerLogin === check.ownerLogin && !existing.reportSaved) {
        existing.markAborted();
      }
    }
    this.bind(check);
    this.byId.set(check.id, check);
    this.armActionsPoll(check);
    this.schedulePersist(check);
  }

  get(id: string): CheckRecord | null {
    return this.byId.get(id) ?? null;
  }

  onModuleDestroy(): void {
    for (const timer of this.actionTimers.values()) clearInterval(timer);
    this.actionTimers.clear();
    for (const check of this.byId.values()) check.dispose();
    this.byId.clear();
  }

  private bind(check: CheckRecord): void {
    check.attach({
      persist: () => this.schedulePersist(check),
      pullDecision: () => this.pullDecision(check),
      onAbort: () => this.clearActions(check.id),
    });
  }

  private async pullDecision(check: CheckRecord): Promise<'allow' | 'deny' | null> {
    const row = await this.active.get(check.id);
    if (row?.payload.actionsAllowed) check.adoptActionsAllowed();
    const pending = row?.payload.pendingDecision;
    if (pending !== 'allow' && pending !== 'deny') return null;
    check.armClearPending();
    await this.enqueueAndWait(check);
    return pending;
  }

  private armActionsPoll(check: CheckRecord): void {
    const timer = setInterval(() => void this.pullActions(check), ACTIONS_POLL_MS);
    timer.unref();
    this.actionTimers.set(check.id, timer);
    void this.pullActions(check);
  }

  private async pullActions(check: CheckRecord): Promise<void> {
    if (check.aborted || check.actionsAllowed) {
      this.clearActions(check.id);
      return;
    }
    try {
      const row = await this.active.get(check.id);
      if (row?.payload.actionsAllowed) {
        check.adoptActionsAllowed();
        this.clearActions(check.id);
      }
    } catch (error) {
      this.logger.error(`active check flag read failed: ${messageOf(error)}`);
    }
  }

  private clearActions(id: string): void {
    const timer = this.actionTimers.get(id);
    if (!timer) return;
    clearInterval(timer);
    this.actionTimers.delete(id);
  }

  private schedulePersist(check: CheckRecord): void {
    const prev = this.tails.get(check.id) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(() => this.writeSnapshot(check))
      .catch((error: unknown) => {
        this.logger.error(`active check persist failed: ${messageOf(error)}`);
      });
    this.tails.set(check.id, next);
  }

  private enqueueAndWait(check: CheckRecord): Promise<void> {
    const prev = this.tails.get(check.id) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(() => this.writeSnapshot(check));
    this.tails.set(
      check.id,
      next.catch((error: unknown) => {
        this.logger.error(`active check persist failed: ${messageOf(error)}`);
      }),
    );
    return next;
  }

  private async writeSnapshot(check: CheckRecord): Promise<void> {
    await this.active.upsert(check.id, check.ownerLogin, toSnapshot(check));
    if (!check.actionsAllowed) {
      const stored = await this.active.get(check.id);
      if (stored?.payload.actionsAllowed) check.adoptActionsAllowed();
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'error';
}

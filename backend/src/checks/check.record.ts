import { randomBytes, randomUUID } from 'crypto';
import { CatalogCard } from '../catalog/map-row';
import { AiBlock, LighthouseBlock, StaticBlock, StepSnapshot } from '../reports/report.types';
import { STEP_NAMES, StepName, StepState } from '../tokens';

const FLUSH_MS = 400;
const DECISION_POLL_MS = 400;

export interface CheckHooks {
  persist: () => void;
  pullDecision: () => Promise<'allow' | 'deny' | null>;
  onAbort: () => void;
}

export class CheckRecord {
  readonly id: string;
  readonly steps: StepSnapshot[];
  previewToken: string;
  landingFolder: string | null = null;
  projectPath: string | null = null;
  zip: Buffer | null = null;
  effectiveLanguages: string[] | null = null;
  finished: Promise<void> = Promise.resolve();
  aborted = false;
  detached = false;
  running = false;
  rerun = false;
  resumeArmed = false;
  private queuedDecision: 'allow' | 'deny' | null = null;
  private readonly abortController = new AbortController();

  private _replacedPreviousStand = false;
  private _standReady = false;
  private _actionsAllowed = false;
  private _standUrl: string | null = null;
  private _staticBlock: StaticBlock | null = null;
  private _aiBlock: AiBlock | null = null;
  private _lighthouseBlock: LighthouseBlock | null = null;
  private _reportSaved = false;
  private clearPending = false;
  private hooks: CheckHooks | null = null;
  private decisionWait: ((decision: 'allow' | 'deny') => void) | null = null;
  private abortWait: (() => void) | null = null;
  private decisionTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private polling = false;

  constructor(
    readonly ownerLogin: string,
    readonly ownerRole: string,
    readonly card: CatalogCard,
    id?: string,
  ) {
    this.id = id ?? randomUUID();
    this.previewToken = randomBytes(16).toString('hex');
    this.steps = STEP_NAMES.map((name) => ({ name, state: 'pending' }));
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  queueDecision(decision: 'allow' | 'deny'): void {
    if (!this.queuedDecision) this.queuedDecision = decision;
  }

  takeQueuedDecision(): 'allow' | 'deny' | null {
    const decision = this.queuedDecision;
    this.queuedDecision = null;
    return decision;
  }

  attach(hooks: CheckHooks): void {
    this.hooks = hooks;
  }

  get replaced_previous_stand(): boolean {
    return this._replacedPreviousStand;
  }

  set replaced_previous_stand(value: boolean) {
    if (this._replacedPreviousStand === value) return;
    this._replacedPreviousStand = value;
    this.scheduleFlush();
  }

  get standReady(): boolean {
    return this._standReady;
  }

  set standReady(value: boolean) {
    if (this._standReady === value) return;
    this._standReady = value;
    this.scheduleFlush();
  }

  get actionsAllowed(): boolean {
    return this._actionsAllowed;
  }

  set actionsAllowed(value: boolean) {
    if (this._actionsAllowed === value) return;
    this._actionsAllowed = value;
    this.scheduleFlush();
  }

  get standUrl(): string | null {
    return this._standUrl;
  }

  set standUrl(value: string | null) {
    if (this._standUrl === value) return;
    this._standUrl = value;
    this.scheduleFlush();
  }

  get staticBlock(): StaticBlock | null {
    return this._staticBlock;
  }

  set staticBlock(value: StaticBlock | null) {
    this._staticBlock = value;
    this.scheduleFlush();
  }

  get aiBlock(): AiBlock | null {
    return this._aiBlock;
  }

  set aiBlock(value: AiBlock | null) {
    this._aiBlock = value;
    this.scheduleFlush();
  }

  get lighthouseBlock(): LighthouseBlock | null {
    return this._lighthouseBlock;
  }

  set lighthouseBlock(value: LighthouseBlock | null) {
    this._lighthouseBlock = value;
    this.scheduleFlush();
  }

  get reportSaved(): boolean {
    return this._reportSaved;
  }

  set reportSaved(value: boolean) {
    if (this._reportSaved === value) return;
    this._reportSaved = value;
    this.scheduleFlush();
  }

  wantsClearPending(): boolean {
    return this.clearPending;
  }

  armClearPending(): void {
    this.clearPending = true;
  }

  adoptActionsAllowed(): void {
    this._actionsAllowed = true;
  }

  step(name: StepName, state: StepState, message?: string): void {
    const current = this.steps.find((item) => item.name === name);
    if (!current) return;
    current.state = state;
    if (message) current.message = message;
    else delete current.message;
    this.notifyNow();
  }

  state(name: StepName): StepState {
    return this.steps.find((item) => item.name === name)?.state ?? 'pending';
  }

  waitDecision(): Promise<'allow' | 'deny'> {
    return new Promise((resolve, reject) => {
      this.decisionWait = resolve;
      this.abortWait = () => reject(abortError());
      if (!this.hooks) return;
      void this.pollRemoteDecision();
      this.decisionTimer = setInterval(() => void this.pollRemoteDecision(), DECISION_POLL_MS);
      this.decisionTimer.unref();
    });
  }

  submit(decision: 'allow' | 'deny'): void {
    this.clearPending = true;
    this.stopDecisionPoll();
    const wait = this.decisionWait;
    this.decisionWait = null;
    this.abortWait = null;
    this.notifyNow();
    wait?.(decision);
  }

  markAborted(): void {
    this.aborted = true;
    this.abortController.abort();
    this.stopDecisionPoll();
    const abort = this.abortWait;
    this.decisionWait = null;
    this.abortWait = null;
    abort?.();
    this.hooks?.onAbort();
    this.notifyNow();
  }

  dispose(): void {
    this.stopDecisionPoll();
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }

  private async pollRemoteDecision(): Promise<void> {
    if (this.polling || !this.decisionWait || !this.hooks) return;
    this.polling = true;
    try {
      const decision = await this.hooks.pullDecision();
      if (!decision || !this.decisionWait || this.aborted) return;
      this.submit(decision);
    } catch {
      /* The next tick tries again. A snapshot miss must not fail the check. */
    } finally {
      this.polling = false;
    }
  }

  private stopDecisionPoll(): void {
    if (this.decisionTimer) clearInterval(this.decisionTimer);
    this.decisionTimer = null;
  }

  private notifyNow(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.hooks?.persist();
  }

  private scheduleFlush(): void {
    if (!this.hooks || this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.hooks?.persist();
    }, FLUSH_MS);
    this.flushTimer.unref();
  }
}

export function abortError(): Error {
  const error = new Error('ABORTED');
  (error as Error & { code?: string }).code = 'ABORTED';
  return error;
}

export function isAbort(error: unknown): boolean {
  return error instanceof Error && (error as Error & { code?: string }).code === 'ABORTED';
}

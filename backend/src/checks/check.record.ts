import { randomUUID } from 'crypto';
import { CatalogCard } from '../catalog/map-row';
import { AiBlock, LighthouseBlock, StaticBlock, StepSnapshot } from '../reports/report.types';
import { STEP_NAMES, StepName, StepState } from '../tokens';

export class CheckRecord {
  readonly id = randomUUID();
  readonly steps: StepSnapshot[];
  replaced_previous_stand = false;
  standReady = false;
  actionsAllowed = false;
  standUrl: string | null = null;
  landingFolder: string | null = null;
  projectPath: string | null = null;
  zip: Buffer | null = null;
  staticBlock: StaticBlock | null = null;
  aiBlock: AiBlock | null = null;
  lighthouseBlock: LighthouseBlock | null = null;
  effectiveLanguages: string[] | null = null;
  reportSaved = false;
  aborted = false;
  finished: Promise<void> = Promise.resolve();
  private decisionWait: ((decision: 'allow' | 'deny') => void) | null = null;
  private abortWait: (() => void) | null = null;

  constructor(
    readonly ownerLogin: string,
    readonly ownerRole: string,
    readonly card: CatalogCard,
  ) {
    this.steps = STEP_NAMES.map((name) => ({ name, state: 'pending' }));
  }

  step(name: StepName, state: StepState, message?: string): void {
    const current = this.steps.find((item) => item.name === name);
    if (!current) return;
    current.state = state;
    if (message) current.message = message;
    else delete current.message;
  }

  state(name: StepName): StepState {
    return this.steps.find((item) => item.name === name)?.state ?? 'pending';
  }

  waitDecision(): Promise<'allow' | 'deny'> {
    return new Promise((resolve, reject) => {
      this.decisionWait = resolve;
      this.abortWait = () => reject(abortError());
    });
  }

  submit(decision: 'allow' | 'deny'): void {
    const wait = this.decisionWait;
    this.decisionWait = null;
    this.abortWait = null;
    wait?.(decision);
  }

  markAborted(): void {
    this.aborted = true;
    this.abortWait?.();
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

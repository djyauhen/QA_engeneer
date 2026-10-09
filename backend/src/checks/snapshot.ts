import { CheckRecord } from './check.record';
import { ActiveCheckSnapshot } from '../storage/repos';
import { AiBlock, LighthouseBlock, StaticBlock, StepSnapshot } from '../reports/report.types';

export function toSnapshot(check: CheckRecord): ActiveCheckSnapshot {
  const snapshot: ActiveCheckSnapshot = {
    ownerLogin: check.ownerLogin,
    ownerRole: check.ownerRole,
    human_id: check.card.human_id,
    name: check.card.name,
    preview_image: check.card.preview_image,
    steps: check.steps.map((step) => ({
      name: step.name,
      state: step.state,
      ...(step.message ? { message: step.message } : {}),
    })),
    static: cloneBlock(check.staticBlock),
    ai: cloneBlock(check.aiBlock),
    lighthouse: cloneBlock(check.lighthouseBlock),
    replaced_previous_stand: check.replaced_previous_stand,
    standReady: check.standReady,
    standUrl: check.standUrl,
    actionsAllowed: check.actionsAllowed,
    reportSaved: check.reportSaved,
    aborted: check.aborted,
    pendingDecision: null,
  };
  if (check.wantsClearPending()) {
    (snapshot as ActiveCheckSnapshot & { clearPending?: boolean }).clearPending = true;
  }
  return snapshot;
}

export function viewFromParts(input: {
  id: string;
  human_id: string;
  name: string;
  preview_image: string;
  ownerLogin: string;
  replaced_previous_stand: boolean;
  steps: StepSnapshot[];
  static: StaticBlock | null;
  ai: AiBlock | null;
  lighthouse: LighthouseBlock | null;
  standReady: boolean;
  standUrl: string | null;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    check_id: input.id,
    human_id: input.human_id,
    name: input.name,
    owner_login: input.ownerLogin,
    replaced_previous_stand: input.replaced_previous_stand,
    steps: input.steps.map((step) => ({
      name: step.name,
      state: step.state,
      ...(step.message ? { message: step.message } : {}),
    })),
    static: input.static,
    ai: input.ai,
    lighthouse: input.lighthouse,
  };
  const downloaded = input.steps.find((step) => step.name === 'download_file')?.state;
  if (downloaded === 'pending' || downloaded === 'running' || downloaded === 'retrying') {
    body.preview_image = input.preview_image;
  }
  if (input.standReady && input.standUrl) body.stand_url = input.standUrl;
  return body;
}

export function viewFromRecord(check: CheckRecord): Record<string, unknown> {
  return viewFromParts({
    id: check.id,
    human_id: check.card.human_id,
    name: check.card.name,
    preview_image: check.card.preview_image,
    ownerLogin: check.ownerLogin,
    replaced_previous_stand: check.replaced_previous_stand,
    steps: check.steps,
    static: check.staticBlock,
    ai: check.aiBlock,
    lighthouse: check.lighthouseBlock,
    standReady: check.standReady,
    standUrl: check.standUrl,
  });
}

export function viewFromSnapshot(id: string, snapshot: ActiveCheckSnapshot): Record<string, unknown> {
  return viewFromParts({
    id,
    human_id: snapshot.human_id,
    name: snapshot.name,
    preview_image: snapshot.preview_image,
    ownerLogin: snapshot.ownerLogin,
    replaced_previous_stand: snapshot.replaced_previous_stand,
    steps: snapshot.steps,
    static: snapshot.static,
    ai: snapshot.ai,
    lighthouse: snapshot.lighthouse,
    standReady: snapshot.standReady,
    standUrl: snapshot.standUrl,
  });
}

function cloneBlock<T>(value: T | null): T | null {
  if (!value) return null;
  return JSON.parse(JSON.stringify(value)) as T;
}

import { CatalogCard } from '../catalog/map-row';
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
    uuid: check.card.uuid,
    countries: [...check.card.countries],
    languages: [...check.card.languages],
    lander_type_name: check.card.lander_type_name,
    catalog_status: check.card.status,
    previewToken: check.previewToken,
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
  actionsAllowed: boolean;
  countries?: string[];
  languages?: string[];
  lander_type_name?: string;
  catalog_status?: string;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    check_id: input.id,
    human_id: input.human_id,
    name: input.name,
    owner_login: input.ownerLogin,
    replaced_previous_stand: input.replaced_previous_stand,
    actions_allowed: input.actionsAllowed,
    steps: input.steps.map((step) => ({
      name: step.name,
      state: step.state,
      ...(step.message ? { message: step.message } : {}),
    })),
    static: input.static,
    ai: input.ai,
    lighthouse: input.lighthouse,
  };
  if (input.countries && input.countries.length > 0) body.countries = [...input.countries];
  if (input.languages && input.languages.length > 0) body.languages = [...input.languages];
  if (input.lander_type_name) body.lander_type_name = input.lander_type_name;
  if (input.catalog_status) body.catalog_status = input.catalog_status;
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
    actionsAllowed: check.actionsAllowed,
    countries: check.card.countries,
    languages: check.card.languages,
    lander_type_name: check.card.lander_type_name,
    catalog_status: check.card.status,
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
    actionsAllowed: snapshot.actionsAllowed === true,
    countries: snapshot.countries,
    languages: snapshot.languages,
    lander_type_name: snapshot.lander_type_name,
    catalog_status: snapshot.catalog_status,
  });
}

export function cardFromSnapshot(snapshot: ActiveCheckSnapshot): CatalogCard {
  return {
    uuid: snapshot.uuid ?? '',
    human_id: snapshot.human_id,
    name: snapshot.name,
    created_at: '',
    countries: snapshot.countries ? [...snapshot.countries] : [],
    languages: snapshot.languages ? [...snapshot.languages] : [],
    lander_type_name: snapshot.lander_type_name ?? '',
    status: snapshot.catalog_status ?? '',
    preview_image: snapshot.preview_image,
    mvt_settings: '',
    owner: null,
    folder: null,
    shares: null,
    updated_at: '',
  };
}

export function recordFromSnapshot(id: string, snapshot: ActiveCheckSnapshot): CheckRecord {
  const check = new CheckRecord(snapshot.ownerLogin, snapshot.ownerRole, cardFromSnapshot(snapshot), id);
  if (snapshot.previewToken) check.previewToken = snapshot.previewToken;
  for (const step of snapshot.steps) {
    const current = check.steps.find((item) => item.name === step.name);
    if (!current) continue;
    current.state = step.state;
    if (step.message) current.message = step.message;
  }
  check.staticBlock = snapshot.static;
  check.aiBlock = snapshot.ai;
  check.lighthouseBlock = snapshot.lighthouse;
  check.replaced_previous_stand = snapshot.replaced_previous_stand;
  check.standReady = snapshot.standReady;
  check.standUrl = snapshot.standUrl;
  check.actionsAllowed = snapshot.actionsAllowed;
  check.reportSaved = snapshot.reportSaved;
  check.aborted = snapshot.aborted;
  return check;
}

function cloneBlock<T>(value: T | null): T | null {
  if (!value) return null;
  return JSON.parse(JSON.stringify(value)) as T;
}

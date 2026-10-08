export interface CatalogCard {
  uuid: string;
  human_id: string;
  name: string;
  created_at: string;
  countries: string[];
  languages: string[];
  lander_type_name: string;
  status: string;
  preview_image: string;
  mvt_settings: string;
  owner: unknown;
  folder: unknown;
  shares: unknown;
  updated_at: string;
}

export interface ScreenItem {
  uuid: string;
  human_id: string;
  name: string;
  created_at: string;
}

export function mapAioRow(row: unknown): CatalogCard | null {
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  const identity =
    record._identity && typeof record._identity === 'object'
      ? (record._identity as Record<string, unknown>)
      : {};
  const uuid =
    typeof identity.uuid === 'string' && identity.uuid
      ? identity.uuid
      : typeof record.uuid === 'string'
        ? record.uuid
        : '';
  const humanId = typeof identity.human_id === 'string' ? identity.human_id : '';
  if (!uuid || !humanId) return null;
  const landerType =
    identity.lander_type && typeof identity.lander_type === 'object'
      ? (identity.lander_type as Record<string, unknown>)
      : {};
  return {
    uuid,
    human_id: humanId,
    name: typeof identity.name === 'string' ? identity.name : '',
    created_at: topLevelCreatedAt(record),
    countries: stringList(identity.countries),
    languages: stringList(identity.languages),
    lander_type_name: typeof landerType.name === 'string' ? landerType.name : '',
    status: typeof identity.status === 'string' ? identity.status : '',
    preview_image: typeof identity.preview_image === 'string' ? identity.preview_image : '',
    mvt_settings: typeof identity.mvt_settings === 'string' ? identity.mvt_settings : '',
    owner: record.owner ?? null,
    folder: record.folder ?? null,
    shares: record.shares ?? null,
    updated_at: typeof record.updated_at === 'string' ? record.updated_at : '',
  };
}

function topLevelCreatedAt(record: Record<string, unknown>): string {
  if (!Object.prototype.hasOwnProperty.call(record, 'created_at')) return '';
  return typeof record.created_at === 'string' ? record.created_at : '';
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

export function mapCatalogRows(rows: unknown[]): CatalogCard[] {
  const cards: CatalogCard[] = [];
  for (const row of rows) {
    const card = mapAioRow(row);
    if (card) cards.push(card);
  }
  return cards;
}

export function sortByHumanIdDesc(cards: CatalogCard[]): CatalogCard[] {
  return cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => {
      const na = Number(a.card.human_id);
      const nb = Number(b.card.human_id);
      const aOk = Number.isFinite(na);
      const bOk = Number.isFinite(nb);
      if (aOk && bOk && na !== nb) return nb - na;
      if (aOk !== bOk) return aOk ? -1 : 1;
      return a.index - b.index;
    })
    .map((item) => item.card);
}

export function toScreenItem(card: CatalogCard): ScreenItem {
  return {
    uuid: card.uuid,
    human_id: card.human_id,
    name: card.name,
    created_at: card.created_at,
  };
}

export function toChoiceRow(card: CatalogCard) {
  return {
    uuid: card.uuid,
    human_id: card.human_id,
    name: card.name,
    created_at: card.created_at,
    preview_image: card.preview_image,
    countries: card.countries,
    languages: card.languages,
    lander_type_name: card.lander_type_name,
    status: card.status,
  };
}

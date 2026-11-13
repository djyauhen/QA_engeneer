export interface PersonFact {
  name: string;
  source: string;
  description: string;
  extract: string;
  born: string | null;
  age_on_check_date: number | null;
  citizenship: string[];
  positions: string[];
}

export interface FxRates {
  date: string;
  base: 'USD';
  /** Units of the currency for 1 USD. USD amount = local amount / rates[code]. */
  rates: Record<string, number>;
}

export interface FactSheet {
  person: PersonFact | null;
}

const USER_AGENT = 'QA-assistant/0.1 (landing fact check)';
const EXTRACT_LIMIT = 4000;
const CANDIDATE_LIMIT = 8;
const FRANKFURTER_URL = 'https://api.frankfurter.app/latest?from=USD';
const FALLBACK_FX_URL = 'https://open.er-api.com/v6/latest/USD';
const FACT_HOSTS = new Set(['www.wikidata.org', 'api.frankfurter.app', 'open.er-api.com']);

/** Wikipedia language subdomains. Fixed set: never taken from page content. */
const WIKI_LANGS = [
  'ar', 'bg', 'ca', 'cs', 'da', 'de', 'el', 'en', 'es', 'eu', 'fa', 'fi', 'fr', 'gl', 'he', 'hi', 'hr', 'hu',
  'id', 'it', 'ja', 'ko', 'ms', 'nl', 'nn', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sr', 'sv', 'th', 'tr',
  'uk', 'vi', 'zh',
] as const;
const WIKI_LANG_SET = new Set<string>(WIKI_LANGS);
const WIKI_ALIAS: Record<string, string> = { nb: 'no' };

const GEO_NAMES: readonly (readonly string[])[] = [
  ['nl', 'nld', 'netherlands', 'the netherlands', 'holland', 'nederland', 'nederlanden', 'нидерланды', 'нидерландов', 'голландия'],
  ['de', 'deu', 'germany', 'deutschland', 'германия', 'германии'],
  ['fr', 'fra', 'france', 'frankreich', 'франция', 'франции'],
  ['pl', 'pol', 'poland', 'polska', 'польша', 'польши'],
  ['gb', 'gbr', 'uk', 'united kingdom', 'great britain', 'britain', 'england', 'великобритания', 'великобритании'],
  ['ch', 'che', 'switzerland', 'schweiz', 'suisse', 'svizzera', 'швейцария', 'швейцарии'],
  ['us', 'usa', 'united states', 'united states of america', 'сша'],
  ['ca', 'can', 'canada', 'канада'],
  ['es', 'esp', 'spain', 'españa', 'espana', 'испания'],
  ['it', 'ita', 'italy', 'italia', 'италия'],
  ['se', 'swe', 'sweden', 'sverige', 'швеция'],
  ['no', 'nor', 'norway', 'norge', 'норвегия'],
  ['dk', 'dnk', 'denmark', 'danmark', 'дания'],
];
const GEO_BY_NAME = new Map<string, readonly string[]>();
for (const names of GEO_NAMES) {
  for (const name of names) GEO_BY_NAME.set(name, names);
}

const FX_CODES = new Set([
  'AED', 'ALL', 'AUD', 'AZN', 'BAM', 'BDT', 'BGN', 'BRL', 'BYN', 'CAD', 'CHF', 'CLP', 'CNY', 'COP', 'CZK', 'DKK', 'EGP',
  'EUR', 'GBP', 'GEL', 'HKD', 'HUF', 'IDR', 'ILS', 'INR', 'ISK', 'JPY', 'KES', 'KRW', 'KZT', 'MAD', 'MDL', 'MKD', 'MXN',
  'MYR', 'NGN', 'NOK', 'NZD', 'PEN', 'PHP', 'PKR', 'PLN', 'RON', 'RSD', 'SAR', 'SEK', 'SGD', 'THB', 'TRY', 'UAH', 'VND',
  'ZAR',
]);

export function wikiLangsFor(languages: readonly string[] | null | undefined): string[] {
  const out: string[] = [];
  const add = (raw: string) => {
    const primary = raw.trim().toLowerCase().split(/[-_]/)[0] ?? '';
    const code = WIKI_ALIAS[primary] ?? primary;
    if (!WIKI_LANG_SET.has(code) || out.includes(code)) return;
    out.push(code);
  };
  for (const language of languages ?? []) add(language);
  add('en');
  return out;
}

export function isAllowedFactUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false;
  if (parsed.port && parsed.port !== '443') return false;
  if (FACT_HOSTS.has(parsed.hostname)) return true;
  return isWikipediaHost(parsed.hostname);
}

export function isPersonName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 5 || trimmed.length > 80) return false;
  return /^[\p{L}][\p{L}\p{M}'’.\- ]{2,78}[\p{L}.]$/u.test(trimmed);
}

export function titleMatchesPerson(name: string, title: string): boolean {
  const wanted = name.toLowerCase().split(/[^\p{L}\p{M}]+/u).filter((token) => token.length > 2);
  if (!wanted.length) return false;
  const have = new Set(title.toLowerCase().split(/[^\p{L}\p{M}]+/u).filter(Boolean));
  return wanted.every((token) => have.has(token));
}

export function ageOn(bornIso: string, onIso: string): number | null {
  const born = parseDate(bornIso);
  const on = parseDate(onIso);
  if (!born || !on) return null;
  let age = on.year - born.year;
  if (on.month < born.month || (on.month === born.month && on.day < born.day)) age -= 1;
  if (age < 0 || age > 120) return null;
  return age;
}

export function readSummary(
  name: string,
  body: unknown,
): { title: string; description: string; extract: string; source: string; qid: string | null } | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  if (record.type !== 'standard') return null;
  const title = typeof record.title === 'string' ? record.title.trim() : '';
  const description = typeof record.description === 'string' ? record.description.trim() : '';
  const extract = typeof record.extract === 'string' ? record.extract.trim() : '';
  if (!title || !description || !extract || !titleMatchesPerson(name, title)) return null;
  const source = wikipediaSource(record);
  if (!source) return null;
  const qid = typeof record.wikibase_item === 'string' && /^Q\d+$/.test(record.wikibase_item) ? record.wikibase_item : null;
  return { title, description, extract: extract.slice(0, EXTRACT_LIMIT), source, qid };
}

export function readOpenSearchTitle(body: unknown): string | null {
  if (!Array.isArray(body) || !Array.isArray(body[1])) return null;
  const title = body[1][0];
  return typeof title === 'string' && title.trim() ? title.trim() : null;
}

export function readOpenSearchTitles(body: unknown): string[] {
  if (!Array.isArray(body) || !Array.isArray(body[1])) return [];
  const titles: string[] = [];
  for (const entry of body[1]) {
    if (titles.length >= 5) break;
    if (typeof entry !== 'string') continue;
    const title = entry.trim();
    if (!title || titles.includes(title)) continue;
    titles.push(title);
  }
  return titles;
}

export function readWikidataSearch(
  body: unknown,
  name: string,
): { id: string; label: string; description: string } | null {
  return readWikidataMatches(body, name)[0] ?? null;
}

function readWikidataMatches(
  body: unknown,
  name: string,
): { id: string; label: string; description: string }[] {
  if (!body || typeof body !== 'object') return [];
  const search = (body as Record<string, unknown>).search;
  if (!Array.isArray(search)) return [];
  const matches: { id: string; label: string; description: string }[] = [];
  for (const row of search) {
    if (matches.length >= 5) break;
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const id = record.id;
    const label = record.label;
    if (typeof id !== 'string' || !/^Q\d+$/.test(id) || typeof label !== 'string' || !label.trim()) continue;
    if (!titleMatchesPerson(name, label)) continue;
    if (matches.some((match) => match.id === id)) continue;
    const description = typeof record.description === 'string' ? record.description.trim() : '';
    matches.push({ id, label: label.trim(), description });
  }
  return matches;
}

export function readSitelink(
  body: unknown,
  qid: string,
  languages: readonly string[],
): { lang: string; title: string } | null {
  const entity = entityOf(body, qid);
  if (!entity) return null;
  const sitelinks = entity.sitelinks;
  if (!sitelinks || typeof sitelinks !== 'object') return null;
  for (const lang of languages) {
    const link = (sitelinks as Record<string, unknown>)[`${lang}wiki`];
    if (!link || typeof link !== 'object') continue;
    const title = (link as Record<string, unknown>).title;
    if (typeof title === 'string' && title.trim()) return { lang, title: title.trim() };
  }
  return null;
}

export function readBirth(body: unknown): { iso: string; precision: number } | null {
  return readTimeClaim(body, 'P569');
}

function readTimeClaim(body: unknown, property: string): { iso: string; precision: number } | null {
  if (!body || typeof body !== 'object') return null;
  const claims = (body as Record<string, unknown>).claims;
  if (!claims || typeof claims !== 'object') return null;
  const rows = (claims as Record<string, unknown>)[property];
  if (!Array.isArray(rows) || !rows[0] || typeof rows[0] !== 'object') return null;
  const snak = (rows[0] as Record<string, unknown>).mainsnak;
  if (!snak || typeof snak !== 'object') return null;
  const datavalue = (snak as Record<string, unknown>).datavalue;
  if (!datavalue || typeof datavalue !== 'object') return null;
  const value = (datavalue as Record<string, unknown>).value;
  if (!value || typeof value !== 'object') return null;
  const time = (value as Record<string, unknown>).time;
  const precision = (value as Record<string, unknown>).precision;
  if (typeof time !== 'string' || typeof precision !== 'number') return null;
  const match = /^\+(\d{4})-(\d{2})-(\d{2})T/.exec(time);
  if (!match || precision < 9 || precision > 11) return null;
  const year = match[1];
  const month = precision >= 10 ? match[2] : '01';
  const day = precision >= 11 ? match[3] : '01';
  if (month === '00' || day === '00') return null;
  return { iso: `${year}-${month}-${day}`, precision };
}

export function readIntro(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const query = (body as Record<string, unknown>).query;
  if (!query || typeof query !== 'object') return null;
  const pages = (query as Record<string, unknown>).pages;
  if (!pages || typeof pages !== 'object') return null;
  const page = Object.values(pages as Record<string, unknown>)[0];
  if (!page || typeof page !== 'object') return null;
  const extract = (page as Record<string, unknown>).extract;
  if (typeof extract !== 'string') return null;
  const text = extract.trim();
  return text ? text.slice(0, EXTRACT_LIMIT) : null;
}

export function readEntityIds(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const claims = (body as Record<string, unknown>).claims;
  if (!claims || typeof claims !== 'object') return [];
  const rows = Object.values(claims as Record<string, unknown>).find(Array.isArray);
  if (!Array.isArray(rows)) return [];
  const ids: string[] = [];
  const ranked = [...rows].sort((a, b) => rankWeight(b) - rankWeight(a));
  for (const row of ranked) {
    if (rankWeight(row) < 0) continue;
    const id = entityIdOf(row);
    if (!id || ids.includes(id)) continue;
    ids.push(id);
    if (ids.length >= 8) break;
  }
  return ids;
}

export function readLabels(body: unknown, languages: readonly string[] = ['en']): Record<string, string> {
  if (!body || typeof body !== 'object') return {};
  const entities = (body as Record<string, unknown>).entities;
  if (!entities || typeof entities !== 'object') return {};
  const wanted = [...languages, 'en'].map((lang) => lang.toLowerCase());
  const labels: Record<string, string> = {};
  for (const [id, entity] of Object.entries(entities as Record<string, unknown>)) {
    if (!entity || typeof entity !== 'object') continue;
    const bag = (entity as Record<string, unknown>).labels;
    if (!bag || typeof bag !== 'object') continue;
    for (const lang of wanted) {
      const entry = (bag as Record<string, unknown>)[lang];
      const value = entry && typeof entry === 'object' ? (entry as Record<string, unknown>).value : undefined;
      if (typeof value === 'string' && value.trim()) {
        labels[id] = value.trim();
        break;
      }
    }
  }
  return labels;
}

export function readFrankfurter(body: unknown): FxRates | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  if (record.base !== 'USD' || typeof record.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.date)) return null;
  if (!record.rates || typeof record.rates !== 'object' || Array.isArray(record.rates)) return null;
  const rates: Record<string, number> = {};
  for (const [code, value] of Object.entries(record.rates as Record<string, unknown>)) {
    if (!FX_CODES.has(code)) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
    rates[code] = value;
  }
  return Object.keys(rates).length ? { date: record.date, base: 'USD', rates } : null;
}

/** Fallback FX payload. A non-USD base is converted into units of currency per 1 USD. */
export function readFallbackFx(body: unknown): FxRates | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (typeof record.result === 'string' && record.result !== 'success') return null;
  const date = readFxDate(record);
  if (!date) return null;
  const baseRaw = typeof record.base_code === 'string' ? record.base_code : typeof record.base === 'string' ? record.base : '';
  const base = baseRaw.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(base)) return null;
  if (!record.rates || typeof record.rates !== 'object' || Array.isArray(record.rates)) return null;
  const raw: Record<string, number> = {};
  for (const [code, value] of Object.entries(record.rates as Record<string, unknown>)) {
    const upper = code.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(upper)) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
    raw[upper] = value;
  }
  if (base !== 'USD' && !(typeof raw.USD === 'number' && raw.USD > 0)) return null;
  const usdPerBase = base === 'USD' ? 1 : raw.USD;
  const rates: Record<string, number> = {};
  for (const code of new Set([...Object.keys(raw), base])) {
    if (!FX_CODES.has(code)) continue;
    const perBase = code === base ? 1 : raw[code];
    if (typeof perBase !== 'number' || !Number.isFinite(perBase) || perBase <= 0) continue;
    const perUsd = perBase / usdPerBase;
    if (!Number.isFinite(perUsd) || perUsd <= 0) continue;
    rates[code] = perUsd;
  }
  return Object.keys(rates).length ? { date, base: 'USD', rates } : null;
}

export async function loadFactSheet(
  options: { person: string | null; checkDate: string; languages?: readonly string[]; countries?: readonly string[] },
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{ person: PersonFact | null; fx: FxRates | null }> {
  const [person, fx] = await Promise.all([
    options.person
      ? fetchPerson(options.person, options.checkDate, options.languages ?? [], options.countries ?? [], fetchImpl)
      : Promise.resolve(null),
    fetchFx(fetchImpl),
  ]);
  return { person, fx };
}

interface FoundPerson {
  name: string;
  source: string;
  description: string;
  extract: string;
  qid: string | null;
  wiki: { lang: string; title: string } | null;
}

async function fetchPerson(
  name: string,
  checkDate: string,
  languages: readonly string[],
  countries: readonly string[],
  fetchImpl: typeof fetch,
): Promise<PersonFact | null> {
  const trimmed = name.trim();
  if (!isPersonName(trimmed)) return null;
  const langs = wikiLangsFor(languages);
  try {
    const found = await findPerson(trimmed, langs, checkDate, countries, fetchImpl);
    if (!found) return null;
    const [birthBody, introBody, citizenshipBody, positionBody] = await Promise.all([
      found.qid ? getJsonRetry(claimsUrl(found.qid, 'P569'), fetchImpl) : Promise.resolve(null),
      found.wiki ? getJsonRetry(introUrl(found.wiki.lang, found.wiki.title), fetchImpl) : Promise.resolve(null),
      found.qid ? getJsonRetry(claimsUrl(found.qid, 'P27'), fetchImpl) : Promise.resolve(null),
      found.qid ? getJsonRetry(claimsUrl(found.qid, 'P39'), fetchImpl) : Promise.resolve(null),
    ]);
    const birth = readBirth(birthBody);
    const exact = birth && birth.precision >= 11 ? birth.iso : null;
    const citizenshipIds = readEntityIds(citizenshipBody);
    const positionIds = readEntityIds(positionBody);
    const ids = uniqueIds([...citizenshipIds, ...positionIds]);
    const labels = ids.length ? readLabels(await getJsonRetry(labelsUrl(ids, langs), fetchImpl), langs) : {};
    const intro = readIntro(introBody);
    return {
      name: found.name,
      source: found.source,
      description: found.description,
      extract: (intro ?? found.extract).slice(0, EXTRACT_LIMIT),
      born: exact,
      age_on_check_date: exact ? ageOn(exact, checkDate) : null,
      citizenship: labelsOf(citizenshipIds, labels),
      positions: labelsOf(positionIds, labels),
    };
  } catch {
    return null;
  }
}

async function findPerson(
  name: string,
  langs: string[],
  checkDate: string,
  countries: readonly string[],
  fetchImpl: typeof fetch,
): Promise<FoundPerson | null> {
  const geo = geoTokens(countries);
  const seen = new Set<string>();
  let count = 0;
  const consider = async (candidate: FoundPerson | null): Promise<FoundPerson | null> => {
    if (!candidate || count >= CANDIDATE_LIMIT) return null;
    const keys = candidateKeys(candidate);
    if (keys.some((key) => seen.has(key))) return null;
    for (const key of keys) seen.add(key);
    count += 1;
    if (!(await acceptsPerson(candidate, checkDate, geo, langs, fetchImpl))) return null;
    return candidate;
  };

  for (const lang of langs) {
    if (count >= CANDIDATE_LIMIT) return null;
    const direct = await consider(await summaryOf(lang, name, name, fetchImpl));
    if (direct) return direct;
    if (count >= CANDIDATE_LIMIT) return null;
    const titles = readOpenSearchTitles(await getJsonRetry(searchUrl(lang, name), fetchImpl));
    for (const title of titles) {
      if (!titleMatchesPerson(name, title) || seen.has(`${lang}:${title}`)) continue;
      if (count >= CANDIDATE_LIMIT) return null;
      const searched = await consider(await summaryOf(lang, title, name, fetchImpl));
      if (searched) return searched;
      if (count >= CANDIDATE_LIMIT) return null;
    }
  }

  for (const lang of langs) {
    if (count >= CANDIDATE_LIMIT) return null;
    const hits = readWikidataMatches(await getJsonRetry(wikidataSearchUrl(name, lang), fetchImpl), name);
    for (const hit of hits) {
      if (seen.has(hit.id)) continue;
      if (count >= CANDIDATE_LIMIT) return null;
      const fromData = await consider(await personFromWikidata(hit, name, langs, fetchImpl));
      if (fromData) return fromData;
      if (count >= CANDIDATE_LIMIT) return null;
    }
  }
  return null;
}

async function personFromWikidata(
  hit: { id: string; label: string; description: string },
  name: string,
  langs: string[],
  fetchImpl: typeof fetch,
): Promise<FoundPerson | null> {
  const entity = await getJsonRetry(entityUrl(hit.id, langs), fetchImpl);
  const sitelink = readSitelink(entity, hit.id, langs);
  if (sitelink) {
    const fromLink = await summaryOf(sitelink.lang, sitelink.title, name, fetchImpl);
    if (fromLink) return { ...fromLink, qid: fromLink.qid ?? hit.id };
  }
  const description = readEntityDescription(entity, hit.id, langs) || hit.description;
  const source = canonicalFactSource(`https://www.wikidata.org/wiki/${hit.id}`);
  if (!description || !source) return null;
  return {
    name: hit.label,
    source,
    description,
    extract: description.slice(0, EXTRACT_LIMIT),
    qid: hit.id,
    wiki: null,
  };
}

async function acceptsPerson(
  found: FoundPerson,
  checkDate: string,
  geo: ReadonlySet<string>,
  langs: readonly string[],
  fetchImpl: typeof fetch,
): Promise<boolean> {
  if (found.qid && (await diedOnOrBefore(found.qid, checkDate, fetchImpl))) return false;
  if (geo.size === 0) return true;
  if (!found.qid) return false;
  const body = await getJsonRetry(claimsUrl(found.qid, 'P27'), fetchImpl);
  if (body == null) return false;
  return citizenshipMatches(readEntityIds(body), geo, langs, fetchImpl);
}

async function diedOnOrBefore(qid: string, checkDate: string, fetchImpl: typeof fetch): Promise<boolean> {
  const body = await getJsonRetry(claimsUrl(qid, 'P570'), fetchImpl);
  if (body == null) return false;
  const death = readTimeClaim(body, 'P570');
  if (!death) return false;
  return isoOnOrBefore(death.iso, checkDate);
}

async function citizenshipMatches(
  ids: readonly string[],
  geo: ReadonlySet<string>,
  langs: readonly string[],
  fetchImpl: typeof fetch,
): Promise<boolean> {
  if (!ids.length) return false;
  const coded = await Promise.all(
    ids.map(async (id) => ({
      id,
      code: readCountryCode(await getJsonRetry(claimsUrl(id, 'P297'), fetchImpl)),
    })),
  );
  const needLabels: string[] = [];
  for (const row of coded) {
    if (row.code) {
      if (geo.has(row.code.toLowerCase())) return true;
      continue;
    }
    needLabels.push(row.id);
  }
  if (!needLabels.length) return false;
  const labels = readLabelLists(await getJsonRetry(labelsUrl(needLabels, langs), fetchImpl));
  for (const id of needLabels) {
    for (const label of labels[id] ?? []) {
      if (geo.has(normalizeGeo(label))) return true;
    }
  }
  return false;
}

function candidateKeys(candidate: FoundPerson): string[] {
  const keys: string[] = [];
  if (candidate.qid) keys.push(candidate.qid);
  if (candidate.wiki) keys.push(`${candidate.wiki.lang}:${candidate.wiki.title}`);
  if (!keys.length) keys.push(candidate.name.toLowerCase());
  return keys;
}

function geoTokens(countries: readonly string[]): Set<string> {
  const tokens = new Set<string>();
  for (const country of countries) {
    if (typeof country !== 'string') continue;
    const norm = normalizeGeo(country);
    if (!norm) continue;
    const names = GEO_BY_NAME.get(norm);
    if (!names) {
      tokens.add(norm);
      continue;
    }
    for (const name of names) tokens.add(name);
  }
  return tokens;
}

function normalizeGeo(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[_|/]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function isoOnOrBefore(iso: string, onIso: string): boolean {
  const left = parseDate(iso);
  const right = parseDate(onIso);
  if (!left || !right) return false;
  if (left.year !== right.year) return left.year < right.year;
  if (left.month !== right.month) return left.month < right.month;
  return left.day <= right.day;
}

function readCountryCode(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const claims = (body as Record<string, unknown>).claims;
  if (!claims || typeof claims !== 'object') return null;
  const rows = (claims as Record<string, unknown>).P297;
  if (!Array.isArray(rows)) return null;
  let bestRank = -1;
  let code: string | null = null;
  for (const row of rows) {
    const rank = rankWeight(row);
    if (rank < 0) continue;
    if (code !== null && rank <= bestRank) continue;
    const value = stringClaim(row);
    if (!value || !/^[A-Za-z]{2}$/.test(value)) continue;
    bestRank = rank;
    code = value.toUpperCase();
  }
  return code;
}

function stringClaim(row: unknown): string | null {
  if (!row || typeof row !== 'object') return null;
  const snak = (row as Record<string, unknown>).mainsnak;
  if (!snak || typeof snak !== 'object') return null;
  const datavalue = (snak as Record<string, unknown>).datavalue;
  if (!datavalue || typeof datavalue !== 'object') return null;
  const value = (datavalue as Record<string, unknown>).value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function readLabelLists(body: unknown): Record<string, string[]> {
  if (!body || typeof body !== 'object') return {};
  const entities = (body as Record<string, unknown>).entities;
  if (!entities || typeof entities !== 'object') return {};
  const labels: Record<string, string[]> = {};
  for (const [id, entity] of Object.entries(entities as Record<string, unknown>)) {
    if (!entity || typeof entity !== 'object') continue;
    const bag = (entity as Record<string, unknown>).labels;
    if (!bag || typeof bag !== 'object') continue;
    const values: string[] = [];
    for (const entry of Object.values(bag as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object') continue;
      const value = (entry as Record<string, unknown>).value;
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (trimmed && !values.includes(trimmed)) values.push(trimmed);
    }
    if (values.length) labels[id] = values;
  }
  return labels;
}

async function summaryOf(lang: string, title: string, wanted: string, fetchImpl: typeof fetch): Promise<FoundPerson | null> {
  const summary = readSummary(wanted, await getJsonRetry(summaryUrl(lang, title), fetchImpl));
  if (!summary) return null;
  const sourceLang = langFromSource(summary.source) ?? lang;
  return {
    name: summary.title,
    source: summary.source,
    description: summary.description,
    extract: summary.extract,
    qid: summary.qid,
    wiki: { lang: sourceLang, title: summary.title },
  };
}

async function fetchFx(fetchImpl: typeof fetch): Promise<FxRates | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const rates = readFrankfurter(await getJsonOnce(FRANKFURTER_URL, fetchImpl));
    if (rates) return rates;
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const rates = readFallbackFx(await getJsonOnce(FALLBACK_FX_URL, fetchImpl));
    if (rates) return rates;
  }
  return null;
}

function summaryUrl(lang: string, title: string): string {
  return `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

function searchUrl(lang: string, name: string): string {
  return `https://${lang}.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(name)}&limit=5&namespace=0&format=json`;
}

function introUrl(lang: string, title: string): string {
  return `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&titles=${encodeURIComponent(title)}&format=json`;
}

function wikidataSearchUrl(name: string, lang: string): string {
  return `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=${encodeURIComponent(lang)}&type=item&limit=5&format=json`;
}

function entityUrl(qid: string, languages: readonly string[]): string {
  const langs = languages.join('|');
  const sites = languages.map((lang) => `${lang}wiki`).join('|');
  return `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=sitelinks|descriptions&sitefilter=${sites}&languages=${langs}&format=json`;
}

function claimsUrl(qid: string, property: string): string {
  return `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${qid}&property=${property}&format=json`;
}

function labelsUrl(ids: string[], languages: readonly string[]): string {
  const langs = [...new Set([...languages, 'en'])].join('|');
  return `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join('|')}&props=labels&languages=${langs}&format=json`;
}

function entityIdOf(row: unknown): string | null {
  if (!row || typeof row !== 'object') return null;
  const snak = (row as Record<string, unknown>).mainsnak;
  if (!snak || typeof snak !== 'object') return null;
  const datavalue = (snak as Record<string, unknown>).datavalue;
  if (!datavalue || typeof datavalue !== 'object') return null;
  const value = (datavalue as Record<string, unknown>).value;
  if (!value || typeof value !== 'object') return null;
  const id = (value as Record<string, unknown>).id;
  return typeof id === 'string' && /^Q\d+$/.test(id) ? id : null;
}

function rankWeight(row: unknown): number {
  if (!row || typeof row !== 'object') return 0;
  const rank = (row as Record<string, unknown>).rank;
  if (rank === 'preferred') return 2;
  if (rank === 'normal') return 1;
  if (rank === 'deprecated') return -1;
  return 0;
}

function labelsOf(ids: string[], labels: Record<string, string>): string[] {
  return ids.map((id) => labels[id]).filter((label): label is string => !!label);
}

function uniqueIds(ids: string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

function entityOf(body: unknown, qid: string): Record<string, unknown> | null {
  if (!body || typeof body !== 'object') return null;
  const entities = (body as Record<string, unknown>).entities;
  if (!entities || typeof entities !== 'object') return null;
  const entity = (entities as Record<string, unknown>)[qid];
  if (!entity || typeof entity !== 'object') return null;
  return entity as Record<string, unknown>;
}

function readEntityDescription(body: unknown, qid: string, languages: readonly string[]): string {
  const entity = entityOf(body, qid);
  if (!entity) return '';
  const descriptions = entity.descriptions;
  if (!descriptions || typeof descriptions !== 'object') return '';
  for (const lang of [...languages, 'en']) {
    const entry = (descriptions as Record<string, unknown>)[lang];
    if (!entry || typeof entry !== 'object') continue;
    const value = (entry as Record<string, unknown>).value;
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

async function getJsonRetry(url: string, fetchImpl: typeof fetch): Promise<unknown | null> {
  const first = await getJsonOnce(url, fetchImpl);
  if (first != null) return first;
  return getJsonOnce(url, fetchImpl);
}

async function getJsonOnce(url: string, fetchImpl: typeof fetch): Promise<unknown | null> {
  try {
    return await getJson(url, fetchImpl);
  } catch {
    return null;
  }
}

async function getJson(url: string, fetchImpl: typeof fetch): Promise<unknown | null> {
  if (!isAllowedFactUrl(url)) return null;
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(8000),
    headers: { accept: 'application/json', 'user-agent': USER_AGENT },
  });
  if (!response.ok) return null;
  return response.json();
}

function wikipediaSource(record: Record<string, unknown>): string | null {
  const content = record.content_urls;
  if (!content || typeof content !== 'object') return null;
  const desktop = (content as Record<string, unknown>).desktop;
  if (!desktop || typeof desktop !== 'object') return null;
  const page = (desktop as Record<string, unknown>).page;
  if (typeof page !== 'string') return null;
  return canonicalFactSource(page);
}

function canonicalFactSource(page: string): string | null {
  let url: URL;
  try {
    url = new URL(page);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
  if (url.port && url.port !== '443') return null;
  if (isWikipediaHost(url.hostname)) {
    if (!url.pathname.startsWith('/wiki/')) return null;
    return url.origin + url.pathname;
  }
  if (url.hostname === 'www.wikidata.org' && /^\/wiki\/Q\d+$/.test(url.pathname)) return url.origin + url.pathname;
  return null;
}

function isWikipediaHost(hostname: string): boolean {
  const match = /^([a-z0-9-]+)\.wikipedia\.org$/.exec(hostname);
  return !!match && WIKI_LANG_SET.has(match[1]);
}

function langFromSource(source: string): string | null {
  try {
    const match = /^([a-z0-9-]+)\.wikipedia\.org$/.exec(new URL(source).hostname);
    return match && WIKI_LANG_SET.has(match[1]) ? match[1] : null;
  } catch {
    return null;
  }
}

function readFxDate(record: Record<string, unknown>): string | null {
  if (typeof record.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(record.date)) return record.date;
  if (typeof record.time_last_update_unix === 'number') return dateFromUnix(record.time_last_update_unix);
  return null;
}

function dateFromUnix(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function parseDate(iso: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

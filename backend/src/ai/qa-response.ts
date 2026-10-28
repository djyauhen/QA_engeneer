import { OUTLET_FOOTER_REF, OUTLET_HEADER_REF } from './outlets';
import { CommentAvatarOccurrence } from './materials';
import { AiCheck, AiFinding, AiGeneral } from '../reports/report.types';

export interface QaReportFields {
  report_markdown?: string;
  general?: AiGeneral;
  checks?: AiCheck[];
  clarifications?: string[];
}

export interface QaParseOptions {
  /** Visible page text. When non-empty, findings whose quote is not in it are dropped. */
  pageText?: string;
  /** Screenshot label ("desktop", "I1"...) to data URL. */
  screenshots?: Record<string, string>;
}

export interface QaParseResult {
  findings: Array<Partial<AiFinding>>;
  /** Present only when the model answered in the report shape (report_markdown or checks). */
  report?: QaReportFields;
}

const GENERAL_KEYS = ['geo', 'language', 'outlet', 'main_person', 'offer', 'currency', 'min_deposit'] as const;
const PRIORITIES = new Set(['critical', 'major', 'minor']);

export function normalizeWhitespace(text: string): string {
  return text.replace(/[\s\u00a0]+/g, ' ').trim();
}

/** Removes the «Общий результат» line from the instruction §13 report; the product has no overall verdict. */
export function stripOverallLine(markdown: string): string {
  return markdown
    .replace(/^[^\S\n]*[*_>#\-\s]*Общий\s+результат[^\n]*(?:\n|$)/gimu, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function normalizeCategory(value: unknown): number | undefined {
  const num = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
  return typeof num === 'number' && Number.isInteger(num) && num >= 1 && num <= 11 ? num : undefined;
}

function normalizeStatus(value: unknown): AiCheck['status'] | undefined {
  if (typeof value !== 'string') return undefined;
  const upper = value.trim().toUpperCase().replace(/\s+/g, '');
  if (upper === 'PASS') return 'PASS';
  if (upper === 'FAIL') return 'FAIL';
  if (upper === 'N/A' || upper === 'NA' || upper === 'N\\A') return 'N/A';
  return undefined;
}

function mapFinding(raw: unknown, screenshots: Record<string, string>): Partial<AiFinding> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const file = str(item.file);
  const quote = str(item.quote);
  const shotRaw = str(item.screenshot_ref) ?? str(item.screenshot);
  if (!file || !quote || !shotRaw) return null;
  const label = shotRaw.trim();
  if (label === OUTLET_HEADER_REF || label === OUTLET_FOOTER_REF) return null;
  const finding: Partial<AiFinding> = {
    file,
    quote,
    screenshot: Object.prototype.hasOwnProperty.call(screenshots, label) ? screenshots[label] : shotRaw,
  };
  const category = normalizeCategory(item.category);
  if (category !== undefined) finding.category = category;
  const priority = typeof item.priority === 'string' ? item.priority.trim().toLowerCase() : '';
  if (PRIORITIES.has(priority)) finding.priority = priority as AiFinding['priority'];
  for (const key of ['where', 'problem', 'expected'] as const) {
    const value = str(item[key]);
    if (value) finding[key] = value;
  }
  return finding;
}

function mapChecks(raw: unknown, findings: Array<Partial<AiFinding>>): AiCheck[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const withFinding = new Set(findings.map((finding) => finding.category).filter((c): c is number => typeof c === 'number'));
  const seen = new Set<number>();
  const out: AiCheck[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const item = entry as Record<string, unknown>;
    const category = normalizeCategory(item.category);
    const status = normalizeStatus(item.status);
    if (category === undefined || status === undefined || seen.has(category)) continue;
    seen.add(category);
    const note = str(item.note);
    if (status === 'FAIL' && !withFinding.has(category)) {
      out.push({ category, status: 'N/A', note: note ? `${note} (нет подтверждённой находки)` : 'Нет подтверждённой находки' });
    } else {
      out.push({ category, status, ...(note ? { note } : {}) });
    }
  }
  return out.sort((a, b) => a.category - b.category);
}

function mapGeneral(raw: unknown): AiGeneral | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const source = raw as Record<string, unknown>;
  const out: AiGeneral = {};
  for (const key of GENERAL_KEYS) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) out[key] = value.trim();
    else if (typeof value === 'number') out[key] = String(value);
  }
  return Object.keys(out).length ? out : undefined;
}

export function mapQaResponse(parsed: unknown, options: QaParseOptions = {}): QaParseResult {
  const body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  const screenshots = options.screenshots ?? {};
  const haystack = normalizeWhitespace(options.pageText ?? '');
  const rawFindings = Array.isArray(body.findings) ? body.findings : [];
  const findings: Array<Partial<AiFinding>> = [];
  for (const raw of rawFindings) {
    const finding = mapFinding(raw, screenshots);
    if (!finding) continue;
    if (haystack && !haystack.includes(normalizeWhitespace(finding.quote as string))) continue;
    findings.push(finding);
  }

  const isReport = typeof body.report_markdown === 'string' || Array.isArray(body.checks);
  if (!isReport) return { findings };

  const report: QaReportFields = {};
  const markdown = typeof body.report_markdown === 'string' ? stripOverallLine(body.report_markdown) : '';
  if (markdown) report.report_markdown = markdown;
  const general = mapGeneral(body.general);
  if (general) report.general = general;
  const checks = mapChecks(body.checks, findings);
  if (checks) report.checks = checks;
  if (Array.isArray(body.clarifications)) {
    report.clarifications = body.clarifications
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim());
  }
  return { findings, report };
}

/** One checklist item. Status must be top-level: a missing status is not a verdict. */
export function mapCategoryResponse(
  category: number,
  parsed: unknown,
  options: QaParseOptions = {},
): { accepted: boolean; result: QaParseResult; imageChecks?: unknown } {
  const body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  const status = normalizeStatus(body.status);
  if (status === undefined) return { accepted: false, result: { findings: [] } };
  const rawFindings = Array.isArray(body.findings) ? body.findings : [];
  const findings = rawFindings.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
    return { ...(entry as Record<string, unknown>), category };
  });
  const result = mapQaResponse(
    {
      checks: [{ category, status, note: body.note }],
      findings,
      clarifications: body.clarifications,
      general: body.general,
    },
    options,
  );
  const imageChecks = category === 3 ? body.image_checks : undefined;
  return { accepted: true, result, ...(imageChecks !== undefined ? { imageChecks } : {}) };
}

/** Image the model was asked to match to a named public person. */
export interface CorrespondenceImage {
  ref: string;
  file: string;
  alt: string;
  caption: string;
  context: string;
  claims_person: string | null;
}

export interface ImageCorrespondenceOptions {
  pageText?: string;
  screenshots?: Record<string, string>;
  images?: CorrespondenceImage[];
  imageChecks?: unknown;
}

type ImageMatch = 'match' | 'mismatch' | 'uncertain';

const MATCH_TOKENS = new Set(['match', 'соответствует', 'совпадает']);
const MISMATCH_TOKENS = new Set(['mismatch', 'несоответствие', 'не соответствует']);
const UNCERTAIN_TOKENS = new Set(['uncertain', 'не уверен', 'неясно']);

function normalizeMatch(value: unknown): ImageMatch | undefined {
  if (typeof value !== 'string') return undefined;
  const token = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (MATCH_TOKENS.has(token)) return 'match';
  if (MISMATCH_TOKENS.has(token)) return 'mismatch';
  if (UNCERTAIN_TOKENS.has(token)) return 'uncertain';
  return undefined;
}

function indexImageChecks(raw: unknown): Map<string, { match: ImageMatch; note?: string }> {
  const out = new Map<string, { match: ImageMatch; note?: string }>();
  if (!Array.isArray(raw)) return out;
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const item = entry as Record<string, unknown>;
    const ref = typeof item.ref === 'string' ? item.ref.trim() : '';
    const match = normalizeMatch(item.match);
    if (!ref || !match || out.has(ref)) continue;
    const note = str(item.note);
    out.set(ref, note ? { match, note } : { match });
  }
  return out;
}

function verbatimInPage(pageText: string, candidate: string): string | null {
  const raw = candidate.trim();
  if (!raw) return null;
  if (pageText.includes(raw)) return raw;
  const needle = normalizeWhitespace(raw);
  if (needle && normalizeWhitespace(pageText).includes(needle)) return needle;
  return null;
}

function quoteForImage(pageText: string, image: CorrespondenceImage): string | null {
  for (const candidate of [image.caption, image.claims_person, image.context, image.alt]) {
    if (!candidate) continue;
    const quote = verbatimInPage(pageText, candidate);
    if (quote) return quote;
  }
  return null;
}

function findingCovers(findings: Array<Partial<AiFinding>>, ref: string, dataUrl: string | undefined): boolean {
  return findings.some((finding) => {
    const shot = finding.screenshot?.trim();
    return shot === ref || (!!dataUrl && shot === dataUrl);
  });
}

function alreadyMentioned(list: string[], ref: string): boolean {
  return list.some((item) => item.startsWith(`${ref} `) || item.startsWith(`${ref}:`));
}

function pushClarification(result: QaParseResult, text: string): void {
  const report = result.report ?? {};
  const list = report.clarifications ?? [];
  list.push(text);
  report.clarifications = list;
  result.report = report;
}

function ensureCategoryFail(report: QaReportFields, category: number, note: string): void {
  const checks = report.checks ?? [];
  const current = checks.find((item) => item.category === category);
  if (!current) {
    checks.push({ category, status: 'FAIL', note });
    checks.sort((a, b) => a.category - b.category);
    report.checks = checks;
    return;
  }
  if (current.status !== 'FAIL') {
    current.status = 'FAIL';
    current.note = note;
  }
}

/**
 * A claimed image must come back as match, mismatch, or uncertain.
 * mismatch becomes a category-10 finding when the page contains a quote; otherwise it stays a clarification.
 * uncertain and a missing verdict stay clarifications and do not become FAIL.
 */
export function enforceImageCorrespondence(result: QaParseResult, options: ImageCorrespondenceOptions = {}): QaParseResult {
  const claimed = (options.images ?? []).filter((image): image is CorrespondenceImage & { claims_person: string } => !!image.claims_person);
  if (!claimed.length) return result;
  const checks = indexImageChecks(options.imageChecks);
  const screenshots = options.screenshots ?? {};
  const pageText = options.pageText ?? '';
  for (const image of claimed) {
    const verdict = checks.get(image.ref);
    const dataUrl = screenshots[image.ref];
    const covered = findingCovers(result.findings, image.ref, dataUrl);
    if (!verdict) {
      if (covered) continue;
      const text = `${image.ref} (${image.file}): соответствие «${image.claims_person}» — не проверено`;
      const list = result.report?.clarifications ?? [];
      if (!alreadyMentioned(list, image.ref)) pushClarification(result, text);
      continue;
    }
    if (verdict.match === 'match') continue;
    if (verdict.match === 'uncertain') {
      const reason = verdict.note ? `не подтверждено. ${verdict.note}` : 'не подтверждено';
      const text = `${image.ref} (${image.file}): соответствие «${image.claims_person}» — ${reason}`;
      const list = result.report?.clarifications ?? [];
      if (!alreadyMentioned(list, image.ref)) pushClarification(result, text);
      continue;
    }
    if (covered) continue;
    const quote = quoteForImage(pageText, image);
    if (!quote || !dataUrl) {
      const reason = verdict.note
        ? `несоответствие, находка не собрана. ${verdict.note}`
        : 'несоответствие, находка не собрана';
      const text = `${image.ref} (${image.file}): соответствие «${image.claims_person}» — ${reason}`;
      const list = result.report?.clarifications ?? [];
      if (!alreadyMentioned(list, image.ref)) pushClarification(result, text);
      continue;
    }
    result.findings.push({
      file: 'index.html',
      quote,
      screenshot: dataUrl,
      category: 3,
      priority: 'major',
      where: image.file,
      problem: verdict.note || `На изображении не ${image.claims_person}`,
      expected: `Изображение ${image.claims_person}`,
    });
    if (result.report?.checks) {
      ensureCategoryFail(result.report, 3, `Изображение ${image.ref} не соответствует «${image.claims_person}»`);
    }
  }
  return result;
}

export interface CommentAvatarOptions {
  pageText?: string;
  avatars?: CommentAvatarOccurrence[];
}

function distinctNames(group: CommentAvatarOccurrence[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const avatar of group) {
    if (seen.has(avatar.nameKey)) continue;
    seen.add(avatar.nameKey);
    names.push(avatar.name);
  }
  return names;
}

function joinNames(names: string[]): string {
  const quoted = names.map((name) => `«${name}»`);
  if (quoted.length <= 1) return quoted[0] ?? '';
  if (quoted.length === 2) return `${quoted[0]} и ${quoted[1]}`;
  return `${quoted.slice(0, -1).join(', ')} и ${quoted[quoted.length - 1]}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Name as it appears in page text, or null when the page does not contain it. */
function quoteAppearingInPage(pageText: string, name: string): string | null {
  const raw = name.trim();
  if (!raw || !pageText) return null;
  if (pageText.includes(raw)) return raw;
  const needle = normalizeWhitespace(raw);
  if (!needle) return null;
  const pattern = needle.split(' ').map(escapeRegExp).join('\\s+');
  const found = new RegExp(pattern).exec(pageText);
  if (found) return found[0];
  if (normalizeWhitespace(pageText).includes(needle)) return needle;
  return null;
}

function quoteForNames(pageText: string, names: string[]): string {
  for (const name of names) {
    const quote = quoteAppearingInPage(pageText, name);
    if (quote) return quote;
  }
  return names[0] ?? '';
}

function alreadyHasPhotoConflict(findings: Array<Partial<AiFinding>>, names: string[]): boolean {
  return findings.some((finding) => {
    if (finding.category !== 9) return false;
    const problem = (finding.problem ?? '').toLocaleLowerCase();
    if (!problem.includes('одно и то же фото')) return false;
    return names.every((name) => problem.includes(name.toLocaleLowerCase()));
  });
}

function alreadyHasNameConflict(findings: Array<Partial<AiFinding>>, name: string): boolean {
  const key = name.toLocaleLowerCase();
  return findings.some((finding) => {
    if (finding.category !== 9) return false;
    const problem = (finding.problem ?? '').toLocaleLowerCase();
    return problem.includes('разные фото') && problem.includes(key);
  });
}

/**
 * Exact avatar reuse is decided from the HTML occurrences, not from the model.
 * One finding per shared photo, listing every distinct name. One finding per name
 * that has two different non-placeholder photos. A photo shared by several names
 * does not also emit a name finding: each of those names still has a single photo.
 */
export function enforceCommentAvatars(result: QaParseResult, options: CommentAvatarOptions = {}): QaParseResult {
  const avatars = (options.avatars ?? []).filter((avatar) => !avatar.placeholder && avatar.nameKey && avatar.photoKey && avatar.screenshot);
  if (!avatars.length) return result;
  const pageText = options.pageText ?? '';
  let noted = false;
  const fail = (note: string): void => {
    if (!result.report || noted) return;
    ensureCategoryFail(result.report, 9, note);
    noted = true;
  };

  const byPhoto = new Map<string, CommentAvatarOccurrence[]>();
  for (const avatar of avatars) {
    const list = byPhoto.get(avatar.photoKey) ?? [];
    list.push(avatar);
    byPhoto.set(avatar.photoKey, list);
  }
  for (const group of byPhoto.values()) {
    const names = distinctNames(group);
    if (names.length < 2) continue;
    if (alreadyHasPhotoConflict(result.findings, names)) {
      fail(`Одно фото у комментаторов ${joinNames(names)}`);
      continue;
    }
    const sample = group[0];
    result.findings.push({
      file: sample.file,
      quote: quoteForNames(pageText, names),
      screenshot: sample.screenshot,
      category: 9,
      priority: 'major',
      where: `Комментарии ${joinNames(names)}`,
      problem: `Одно и то же фото у комментаторов ${joinNames(names)}.`,
      expected: 'У разных имён разные фото.',
    });
    fail(`Одно фото у комментаторов ${joinNames(names)}`);
  }

  const byName = new Map<string, CommentAvatarOccurrence[]>();
  for (const avatar of avatars) {
    const list = byName.get(avatar.nameKey) ?? [];
    list.push(avatar);
    byName.set(avatar.nameKey, list);
  }
  for (const group of byName.values()) {
    const photoKeys = new Set(group.map((avatar) => avatar.photoKey));
    if (photoKeys.size < 2) continue;
    const name = group[0].name;
    if (alreadyHasNameConflict(result.findings, name)) {
      fail(`У комментатора «${name}» разные фото`);
      continue;
    }
    const sample = group[0];
    result.findings.push({
      file: sample.file,
      quote: quoteForNames(pageText, [name]),
      screenshot: sample.screenshot,
      category: 9,
      priority: 'major',
      where: `Комментарии «${name}»`,
      problem: `У комментатора «${name}» разные фото.`,
      expected: 'У одного имени одно фото.',
    });
    fail(`У комментатора «${name}» разные фото`);
  }
  return result;
}

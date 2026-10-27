import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { safeResolveUnderLanding } from '../static/landing-utils';

export const MAX_PAGE_TEXT_CHARS = 200_000;
export const MAX_AI_IMAGES = 8;
export const MIN_IMAGE_BYTES = 2048;
export const MAX_IMAGE_BYTES = 350_000;
const CONTEXT_RADIUS = 90;

export type ImageKind = 'content' | 'comment';
export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export interface PersonClaim {
  from_land_name: string | null;
  from_page_text: string | null;
  resolved: string | null;
  conflict: boolean;
}

export interface MaterialImage {
  ref: string;
  file: string;
  alt: string;
  caption: string;
  context: string;
  kind: ImageKind;
  claims_person: string | null;
  mime: ImageMime;
  buffer: Buffer;
}

export interface AiMaterials {
  pageText: string;
  textTruncated: boolean;
  person: PersonClaim;
  images: MaterialImage[];
}

const NAME_RE = /\p{Lu}\p{Ll}+(?:[-\s]+\p{Lu}\p{Ll}+){1,3}/u;
const SKIP_NAME_RE = /favicon|pixel|spacer|sprite|blank|logo|icon/i;
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);
const MARK_OPEN = '\uE000';
const MARK_CLOSE = '\uE001';
const MARK_RE = /\uE000\d+\uE001/g;
const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;

const EMPTY_PERSON: PersonClaim = { from_land_name: null, from_page_text: null, resolved: null, conflict: false };

export function buildAiMaterials(landingFolder: string, landName: string, _checkDateIso?: string): AiMaterials {
  const html = readIndexHtml(landingFolder);
  if (html === null) {
    const person = resolvePerson(landName, null, '');
    return { pageText: '', textTruncated: false, person, images: [] };
  }
  const cleaned = cleanHtml(html);
  const parsed = parseTags(cleaned);
  const fullText = collapse(decodeEntities(parsed.marked.replace(MARK_RE, ' ')));
  const textTruncated = fullText.length > MAX_PAGE_TEXT_CHARS;
  const pageText = textTruncated ? fullText.slice(0, MAX_PAGE_TEXT_CHARS) : fullText;
  const person = resolvePerson(landName, firstH1(cleaned), pageText);
  const images = selectImages(landingFolder, cleaned, parsed, person.resolved);
  return { pageText, textTruncated, person, images };
}

function readIndexHtml(landingFolder: string): string | null {
  for (const name of ['index.html', 'index.php']) {
    const file = path.join(landingFolder, name);
    try {
      if (fs.statSync(file).isFile()) return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

function cleanHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\?[\s\S]*?\?>/g, ' ')
    .replace(/<head\b[\s\S]*?<\/head>/gi, ' ')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg\s*>/gi, ' ');
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&#x27;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
}

function collapse(text: string): string {
  return text.replace(/[\s\u00a0]+/g, ' ').trim();
}

function firstH1(cleaned: string): string | null {
  const match = /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(cleaned);
  if (!match) return null;
  const text = collapse(decodeEntities(match[1].replace(TAG_RE, ' ')));
  return text || null;
}

interface RawImg {
  tag: string;
  offset: number;
  inComment: boolean;
}

interface ParsedTags {
  marked: string;
  imgs: RawImg[];
}

function parseTags(cleaned: string): ParsedTags {
  const imgs: RawImg[] = [];
  const stack: Array<{ name: string; comment: boolean }> = [];
  const marked = cleaned.replace(TAG_RE, (full: string, slash: string, name: string, attrs: string, offset: number) => {
    const tag = name.toLowerCase();
    if (tag === 'img') {
      imgs.push({ tag: full, offset, inComment: stack.some((entry) => entry.comment) });
      return ` ${MARK_OPEN}${imgs.length - 1}${MARK_CLOSE} `;
    }
    if (VOID_TAGS.has(tag) || full.endsWith('/>')) return ' ';
    if (slash) {
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i].name === tag) {
          stack.length = i;
          break;
        }
      }
      return ' ';
    }
    const marker = `${attrOf(attrs, 'class') ?? ''} ${attrOf(attrs, 'id') ?? ''}`;
    stack.push({ name: tag, comment: /comment/i.test(marker) });
    return ' ';
  });
  return { marked, imgs };
}

function attrOf(source: string, name: string): string | null {
  const re = new RegExp(`(?:^|[\\s"'/])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const match = re.exec(source);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? '';
}

function tokens(name: string): string[] {
  return name.split(/[-\s]+/).filter(Boolean);
}

function personKey(name: string): string {
  return tokens(name).join(' ').toLowerCase();
}

function resolvePerson(landName: string, h1: string | null, pageText: string): PersonClaim {
  const normalizedLand = collapse((landName ?? '').replace(/[_|]/g, ' '));
  let fromLand = NAME_RE.exec(normalizedLand)?.[0] ?? null;
  const fromPage = (h1 && NAME_RE.exec(h1)?.[0]) || NAME_RE.exec(pageText)?.[0] || null;
  if (fromLand && fromPage) {
    // The land name often ends with the offer (PL_Andrzej_Duda_Mifix); keep only the part the page confirms.
    const land = tokens(fromLand);
    const page = tokens(fromPage).map((token) => token.toLowerCase());
    if (land.length > page.length) {
      for (let i = 0; i + page.length <= land.length; i += 1) {
        if (page.every((token, j) => land[i + j].toLowerCase() === token)) {
          fromLand = land.slice(i, i + page.length).join(' ');
          break;
        }
      }
    }
  }
  if (!fromLand && !fromPage) return { ...EMPTY_PERSON };
  const resolved = collapse(fromLand ?? fromPage ?? '');
  const conflict = !!fromLand && !!fromPage && personKey(fromLand) !== personKey(fromPage);
  return {
    from_land_name: fromLand ? collapse(fromLand) : null,
    from_page_text: fromPage ? collapse(fromPage) : null,
    resolved: resolved || null,
    conflict,
  };
}

function sniffMime(buffer: Buffer, ext: string): ImageMime | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('latin1') === '\x89PNG') return 'image/png';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  if (buffer.length >= 4 && buffer.subarray(0, 3).toString('latin1') === 'GIF') return 'image/gif';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return null;
}

function resolveImageFile(landingFolder: string, raw: string): string | null {
  let ref = decodeEntities(raw.trim());
  ref = ref.replace(/^\{\{[^}]*\}\}\/?/, '');
  ref = ref.split('#')[0].split('?')[0].trim();
  ref = ref.replace(/^\.\//, '');
  if (/^\/(?!\/)/.test(ref)) ref = ref.replace(/^\/+/, '');
  try {
    ref = decodeURIComponent(ref);
  } catch {
    /* keep raw reference */
  }
  if (!ref || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref)) return null;
  const resolved = safeResolveUnderLanding(landingFolder, ref);
  if (!resolved) return null;
  const ext = path.extname(resolved).toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) return null;
  if (SKIP_NAME_RE.test(path.basename(resolved))) return null;
  return resolved;
}

function candidateSources(tag: string): string[] {
  const out: string[] = [];
  const src = attrOf(tag, 'src');
  const dataSrc = attrOf(tag, 'data-src');
  const srcset = attrOf(tag, 'srcset');
  if (src) out.push(src);
  if (dataSrc) out.push(dataSrc);
  const first = srcset?.split(',')[0]?.trim().split(/\s+/)[0];
  if (first) out.push(first);
  return out;
}

interface Candidate {
  file: string;
  alt: string;
  caption: string;
  context: string;
  kind: ImageKind;
  buffer: Buffer;
  mime: ImageMime;
  order: number;
}

function figureCaption(cleaned: string, ranges: Array<[number, number]>, offset: number): string {
  const range = ranges.find(([start, end]) => offset > start && offset < end);
  if (!range) return '';
  const inner = cleaned.slice(range[0], range[1]);
  const match = /<figcaption\b[^>]*>([\s\S]*?)<\/figcaption\s*>/i.exec(inner);
  return match ? collapse(decodeEntities(match[1].replace(TAG_RE, ' '))) : '';
}

function selectImages(landingFolder: string, cleaned: string, parsed: ParsedTags, resolved: string | null): MaterialImage[] {
  const figureRanges: Array<[number, number]> = [];
  const figureRe = /<figure\b[\s\S]*?<\/figure\s*>/gi;
  let figure: RegExpExecArray | null;
  while ((figure = figureRe.exec(cleaned)) !== null) figureRanges.push([figure.index, figure.index + figure[0].length]);

  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  parsed.imgs.forEach((img, order) => {
    for (const source of candidateSources(img.tag)) {
      const file = resolveImageFile(landingFolder, source);
      if (!file) continue;
      let buffer: Buffer;
      try {
        const stat = fs.statSync(file);
        if (!stat.isFile() || stat.size < MIN_IMAGE_BYTES || stat.size > MAX_IMAGE_BYTES) continue;
        buffer = fs.readFileSync(file);
      } catch {
        continue;
      }
      const mime = sniffMime(buffer, path.extname(file).toLowerCase());
      if (!mime) continue;
      const hash = createHash('sha256').update(buffer).digest('hex');
      if (seen.has(hash)) return;
      seen.add(hash);
      const marker = `${MARK_OPEN}${order}${MARK_CLOSE}`;
      const at = parsed.marked.indexOf(marker);
      const before = parsed.marked.slice(Math.max(0, at - CONTEXT_RADIUS * 4), at).replace(MARK_RE, ' ');
      const after = parsed.marked.slice(at + marker.length, at + marker.length + CONTEXT_RADIUS * 4).replace(MARK_RE, ' ');
      const beforeText = collapse(decodeEntities(before)).slice(-CONTEXT_RADIUS);
      const afterText = collapse(decodeEntities(after)).slice(0, CONTEXT_RADIUS);
      const alt = collapse(decodeEntities(attrOf(img.tag, 'alt') ?? ''));
      const title = collapse(decodeEntities(attrOf(img.tag, 'title') ?? ''));
      candidates.push({
        file: path.relative(landingFolder, file).split(path.sep).join('/'),
        alt,
        caption: figureCaption(cleaned, figureRanges, img.offset) || title,
        context: collapse(`${beforeText} ${afterText}`),
        kind: img.inComment ? 'comment' : 'content',
        buffer,
        mime,
        order,
      });
      return;
    }
  });

  const mentions = (candidate: Candidate): boolean =>
    !!resolved && `${candidate.alt} ${candidate.caption} ${candidate.context}`.toLowerCase().includes(resolved.toLowerCase());
  const content = candidates.filter((candidate) => candidate.kind === 'content');
  const comments = candidates.filter((candidate) => candidate.kind === 'comment');
  const ordered = [
    ...content.filter(mentions),
    ...content.filter((candidate) => !mentions(candidate)),
    ...comments,
  ].slice(0, MAX_AI_IMAGES);

  return ordered.map((candidate, index) => ({
    ref: `I${index + 1}`,
    file: candidate.file,
    alt: candidate.alt,
    caption: candidate.caption,
    context: candidate.context,
    kind: candidate.kind,
    claims_person: !resolved ? null : candidate.kind === 'content' || mentions(candidate) ? resolved : null,
    mime: candidate.mime,
    buffer: candidate.buffer,
  }));
}

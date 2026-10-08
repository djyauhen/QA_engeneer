import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { AdminRules } from '../rules/rules';
import { StaticItem } from '../reports/report.types';
import {
  STATIC_SUMMARY_FAILED,
  STATIC_SUMMARY_INCOMPLETE,
  STATIC_SUMMARY_PASSED,
  STATIC_SUMMARY_WARNING,
} from '../tokens';
import {
  formatLinesSuffix,
  getAllFilesByExtensions,
  lineNumberAtIndex,
  linesForRegexMatches,
  linesForSubstring,
  readFileUtf8Safe,
  relFromLanding,
  resolveLandingFolder,
  safeResolveUnderLanding,
  isPathInsideRoot,
  walkFilesByExtensions,
} from './landing-utils';

export const EXPECTED_SVG_SCRIPT_SHA256 =
  '1fdc077086ee808c187d7a613348f197ba0f15625c70090b2d43e8983ad4ff50';

export const STATIC_CHECK_NAMES = {
  structure: 'Проверка структуры',
  php: 'Проверка отсутствия PHP',
  images: 'Проверка размеров изображений',
  linked: 'Проверка подключенных файлов',
  external: 'Проверка внешних ссылок',
  dates: 'Проверка дат в индексе',
  utf8: 'Проверка UTF-8 meta-тега',
  favicon: 'Проверка фавикона',
  stealer: 'Проверка запрещённых файлов стиллера',
  style: 'Проверка тега <style>',
  legacy: 'Проверка устаревших макросов',
  form: 'Проверка макросов трекинга и формы',
  tracker: 'Проверка макросов tracker_protection',
  svg: 'Проверка защитного скрипта в SVG',
  cache: 'Проверка cache-buster ?v',
  scripts: 'Проверка больших скриптов в HTML/PHP',
  css: 'Проверка размеров CSS',
  unwanted: 'Проверка запрещённых элементов',
  base64: 'Проверка base64 и atob',
  cdn: 'Проверка префикса {{cdn}}/ в CSS/JS',
} as const;

export function summarizeStatic(items: StaticItem[]): string {
  if (items.some((entry) => entry.status === 'failed')) return STATIC_SUMMARY_FAILED;
  if (items.some((entry) => entry.status === 'warning')) return STATIC_SUMMARY_WARNING;
  if (items.length > 0 && items.every((entry) => entry.status === 'passed')) return STATIC_SUMMARY_PASSED;
  return STATIC_SUMMARY_INCOMPLETE;
}

export abstract class StaticChecks {
  abstract run(projectPath: string, rules: AdminRules): Promise<StaticItem[]>;
}

export class AioStaticChecks extends StaticChecks {
  async run(projectPath: string, rules: AdminRules): Promise<StaticItem[]> {
    return runStaticChecks(projectPath, rules);
  }
}

function item(name: string, status: StaticItem['status'], messages: string[]): StaticItem {
  const findings = status === 'passed' ? [] : messages.filter(Boolean).map(toFinding);
  return { name, status, findings };
}

function toFinding(text: string): { text: string; file?: string } {
  const match = text.match(/^([^:\s][^:]*):/);
  if (match && !match[1].includes(' ')) return { text, file: match[1] };
  return { text };
}

export async function runStaticChecks(projectPath: string, rules: AdminRules): Promise<StaticItem[]> {
  const structure = checkStructure(projectPath);
  if (structure.status === 'failed') return [structure];
  const rest = await Promise.all([
    Promise.resolve(checkPhp(projectPath)),
    Promise.resolve(checkImages(projectPath, rules)),
    Promise.resolve(checkLinkedFiles(projectPath)),
    Promise.resolve(checkExternal(projectPath, rules)),
    Promise.resolve(checkDates(projectPath)),
    Promise.resolve(checkUtf8(projectPath)),
    Promise.resolve(checkFavicon(projectPath)),
    Promise.resolve(checkStealer(projectPath, rules)),
    Promise.resolve(checkStyleTags(projectPath)),
    Promise.resolve(checkLegacy(projectPath, rules)),
    Promise.resolve(checkFormMacros(projectPath, rules)),
    Promise.resolve(checkTracker(projectPath)),
    Promise.resolve(checkSvg(projectPath)),
    Promise.resolve(checkCacheBuster(projectPath)),
    Promise.resolve(checkLargeScripts(projectPath, rules)),
    Promise.resolve(checkCss(projectPath, rules)),
    Promise.resolve(checkUnwanted(projectPath, rules)),
    Promise.resolve(checkBase64(projectPath, rules)),
    Promise.resolve(checkCdn(projectPath)),
  ]);
  return [structure, ...rest];
}

const IGNORED = ['.DS_Store', 'Thumbs.db', '.idea', '.vscode', 'node_modules'];
const REQUIRED_FILES = ['index.html', 'index.php'];
const REQUIRED_FOLDERS = ['img', 'images', 'css', 'styles'];
const OPTIONAL_FOLDERS = ['fonts', 'font', 'js', 'video'];
const ALLOWED_EXT: Record<string, string[]> = {
  img: ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.avif'],
  images: ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.avif'],
  css: ['.css'],
  styles: ['.css'],
  fonts: ['.woff', '.woff2', '.ttf', '.otf', '.eot'],
  font: ['.woff', '.woff2', '.ttf', '.otf', '.eot'],
  js: ['.js'],
  video: ['.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv', '.mpeg', '.mpg', '.3gp'],
  favicon: ['.ico', '.png', '.svg', '.jpg', '.jpeg', '.webp'],
};

function checkStructure(projectPath: string): StaticItem {
  const errors: string[] = [];
  const resolved = resolveLandingFolder(projectPath);
  if (!resolved.ok) return item(STATIC_CHECK_NAMES.structure, 'failed', resolved.errors);
  const contents = fs.readdirSync(resolved.landingFolder);
  const filtered = contents.filter((entry) => !IGNORED.includes(entry));
  if (!REQUIRED_FILES.some((file) => filtered.includes(file))) {
    errors.push('В папке лендинга отсутствуют файлы index.html или index.php');
  }
  if (!REQUIRED_FOLDERS.some((folder) => filtered.includes(folder))) {
    errors.push('В папке лендинга отсутствуют папки img/images или css/styles');
  }
  for (const folder of [...REQUIRED_FOLDERS, ...OPTIONAL_FOLDERS]) {
    if (!filtered.includes(folder)) continue;
    const folderPath = path.join(resolved.landingFolder, folder);
    const validFiles = fs.readdirSync(folderPath).filter((file) => !IGNORED.includes(file));
    let validExtensions = ALLOWED_EXT[folder] ?? [];
    if (folder === 'img' || folder === 'images') {
      validExtensions = [...new Set([...validExtensions, ...ALLOWED_EXT.favicon])];
    }
    const invalid = validFiles.filter((file) => !validExtensions.includes(path.extname(file).toLowerCase()));
    if (invalid.length > 0) {
      errors.push(`В папке ${folder} обнаружены файлы с неподходящими расширениями: ${invalid.join(', ')}`);
    }
  }
  const faviconFound = ['', 'img', 'images'].some((folder) => {
    const folderPath = folder ? path.join(resolved.landingFolder, folder) : resolved.landingFolder;
    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) return false;
    return fs.readdirSync(folderPath).some((file) => ALLOWED_EXT.favicon.includes(path.extname(file).toLowerCase()));
  });
  if (!faviconFound) errors.push('Фавикон отсутствует в корне или в папках img/images.');
  const allowed = new Set([
    ...REQUIRED_FILES,
    ...REQUIRED_FOLDERS,
    ...OPTIONAL_FOLDERS,
    ...filtered.filter((file) => ALLOWED_EXT.favicon.includes(path.extname(file).toLowerCase())),
  ]);
  const extra = filtered.filter((entry) => !allowed.has(entry));
  if (extra.length > 0) {
    errors.push(`В корне папки лендинга обнаружены лишние файлы или папки: ${extra.join(', ')}`);
  }
  return item(STATIC_CHECK_NAMES.structure, errors.length ? 'failed' : 'passed', errors);
}

function checkPhp(projectPath: string): StaticItem {
  const errors: string[] = [];
  const resolved = resolveLandingFolder(projectPath);
  if (!resolved.ok) return item(STATIC_CHECK_NAMES.php, 'failed', resolved.errors);
  walkFilesByExtensions(resolved.landingFolder, ['.html', '.php'], (filePath) => {
    const rel = relFromLanding(resolved.landingFolder, filePath);
    const read = readFileUtf8Safe(filePath);
    if (!read.ok) {
      errors.push(`${rel}: не удалось прочитать файл`);
      return;
    }
    const lines = linesForRegexMatches(read.content, /<\?(php|=)/gi);
    if (lines.length > 0) {
      errors.push(`${rel}: обнаружены вставки PHP (<?php / <?=)${formatLinesSuffix(lines)}`);
    }
  });
  return item(STATIC_CHECK_NAMES.php, errors.length ? 'failed' : 'passed', errors);
}

function checkImages(projectPath: string, rules: AdminRules): StaticItem {
  const errors: string[] = [];
  const warnings: string[] = [];
  const resolved = resolveLandingFolder(projectPath);
  if (!resolved.ok) return item(STATIC_CHECK_NAMES.images, 'failed', resolved.errors);
  const failedBytes = rules.image_failed_kb * 1024;
  const warningBytes = rules.image_warning_kb * 1024;
  for (const imagePath of getAllFilesByExtensions(resolved.landingFolder, [
    '.jpg',
    '.jpeg',
    '.png',
    '.gif',
    '.webp',
    '.svg',
    '.avif',
  ])) {
    const size = fs.statSync(imagePath).size;
    const rel = relFromLanding(resolved.landingFolder, imagePath);
    if (size > failedBytes) errors.push(`${rel} — размер больше ${rules.image_failed_kb} KB (${(size / 1024).toFixed(1)} KB)`);
    else if (size > warningBytes) {
      warnings.push(
        `${rel} — размер больше ${rules.image_warning_kb} KB и не больше ${rules.image_failed_kb} KB (${(size / 1024).toFixed(1)} KB)`,
      );
    }
  }
  const status = errors.length ? 'failed' : warnings.length ? 'warning' : 'passed';
  return item(STATIC_CHECK_NAMES.images, status, [...warnings, ...errors]);
}

/**
 * The aio-checker module loads the index in Puppeteer and reads link[href] and script[src].
 * Chrome is not required here: the same tags are read from the file. Tags injected only
 * after client-side script execution are not visible to this parser.
 */
function checkLinkedFiles(projectPath: string): StaticItem {
  const errors: string[] = [];
  const resolved = resolveLandingFolder(projectPath);
  if (!resolved.ok) return item(STATIC_CHECK_NAMES.linked, 'failed', resolved.errors);
  const indexFile = fs.readdirSync(resolved.landingFolder).find((file) => REQUIRED_FILES.includes(file));
  if (!indexFile) return item(STATIC_CHECK_NAMES.linked, 'failed', ['Не найден файл index.html или index.php']);
  const read = readFileUtf8Safe(path.join(resolved.landingFolder, indexFile));
  const source = read.ok ? read.content : '';
  const tagRe = /<(link|script)\b([^>]*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(source)) !== null) {
    const tag = match[1].toLowerCase();
    const attrs = match[2];
    const attr = tag === 'link' ? 'href' : 'src';
    const valueMatch = attrs.match(new RegExp(`${attr}\\s*=\\s*(['"])(.*?)\\1`, 'i'));
    const file = valueMatch?.[2];
    if (!file || file.startsWith('http') || file.startsWith('//')) continue;
    const refBase = file.split('?')[0];
    const lineSuffix = formatLinesSuffix(linesForSubstring(source, refBase, 25));
    const safePath = safeResolveUnderLanding(resolved.landingFolder, file);
    if (safePath == null) {
      errors.push(`${tag.toUpperCase()}: ${file} — недопустимый путь (выход за пределы лендинга или абсолютный URL пути)${lineSuffix}`);
      continue;
    }
    if (!fs.existsSync(safePath)) {
      errors.push(`${tag.toUpperCase()}: ${file} — файл не найден (${relFromLanding(resolved.landingFolder, safePath)})${lineSuffix}`);
    }
  }
  return item(STATIC_CHECK_NAMES.linked, errors.length ? 'failed' : 'passed', errors);
}

function checkExternal(projectPath: string, rules: AdminRules): StaticItem {
  const resolved = resolveLandingFolder(projectPath);
  if (!resolved.ok) return item(STATIC_CHECK_NAMES.external, 'failed', resolved.errors);
  const errors: string[] = [];
  const httpRegex = /https?:\/\/[^\s"'<>]+/g;
  for (const file of getAllFilesByExtensions(resolved.landingFolder, ['.html', '.php', '.css', '.js'])) {
    const rel = relFromLanding(resolved.landingFolder, file);
    const read = readFileUtf8Safe(file);
    if (!read.ok) {
      errors.push(`${rel}: не удалось прочитать файл`);
      continue;
    }
    const content = read.content.replace(/<svg[\s\S]*?<\/svg>/gi, '');
    const matches = content.match(httpRegex) ?? [];
    for (const url of matches) {
      const cleanUrl = url.trim().replace(/\/+$/, '');
      if (rules.allowed_external_prefixes.some((prefix) => cleanUrl.startsWith(prefix))) continue;
      const lines = linesForSubstring(read.content, url, 20);
      errors.push(`${rel} содержит внешнюю ссылку: ${url}${formatLinesSuffix(lines)}`);
    }
  }
  return item(STATIC_CHECK_NAMES.external, errors.length ? 'failed' : 'passed', errors);
}

function checkDates(projectPath: string): StaticItem {
  const resolved = resolveLandingFolder(projectPath);
  if (!resolved.ok) return item(STATIC_CHECK_NAMES.dates, 'failed', [resolved.errors.join('; ')]);
  const indexFile = fs.readdirSync(resolved.landingFolder).find((file) => file === 'index.html' || file === 'index.php');
  if (!indexFile) return item(STATIC_CHECK_NAMES.dates, 'failed', ['Файл index.html или index.php не найден']);
  const read = readFileUtf8Safe(path.join(resolved.landingFolder, indexFile));
  if (!read.ok) return item(STATIC_CHECK_NAMES.dates, 'failed', [`Не удалось прочитать ${indexFile}`]);
  const withoutSvg = read.content.replace(/<svg[\s\S]*?<\/svg>/gi, '');
  const withoutAttributes = withoutSvg.replace(/<[^>]*=["'].*?\b\d+[./\s]\d+.*?["'][^>]*>/gi, '');
  const dateRegex =
    /\b(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:,\s*\d{4})?)\b(?![-\d\s]{2,})/gi;
  const phoneRegex = /\b\d{1,3}[-\s]\d{1,3}[-\s]\d{1,4}\b/;
  const dates = (withoutAttributes.match(dateRegex) ?? []).filter((date) => !phoneRegex.test(date));
  if (dates.length === 0) return item(STATIC_CHECK_NAMES.dates, 'passed', []);
  const lineSet = new Set<number>();
  for (const date of dates) {
    for (const line of linesForSubstring(read.content, date, 40)) lineSet.add(line);
  }
  const lines = [...lineSet].sort((a, b) => a - b);
  return item(STATIC_CHECK_NAMES.dates, 'failed', [
    `Обнаружены статические даты (${dates.join(', ')}). Все даты должны быть подключены через JavaScript.${formatLinesSuffix(lines)}`,
  ]);
}

function checkUtf8(projectPath: string): StaticItem {
  const resolved = resolveLandingFolder(projectPath);
  if (!resolved.ok) return item(STATIC_CHECK_NAMES.utf8, 'failed', resolved.errors);
  const indexFiles = ['index.html', 'index.php']
    .map((name) => path.join(resolved.landingFolder, name))
    .filter((filePath) => fs.existsSync(filePath));
  if (indexFiles.length === 0) {
    return item(STATIC_CHECK_NAMES.utf8, 'failed', ['Файл index.html или index.php не найден']);
  }
  const errors: string[] = [];
  for (const filePath of indexFiles) {
    const fileName = path.basename(filePath);
    const read = readFileUtf8Safe(filePath);
    if (!read.ok) {
      errors.push(`${fileName}: не удалось прочитать файл`);
      continue;
    }
    const tags = collectMeta(read.content);
    const valid = tags.some((tag) => hasValidUtf8Meta(tag.tag));
    if (valid) continue;
    const charsets = declaredCharsets(tags.map((tag) => tag.tag));
    const details =
      charsets.length > 0
        ? ` Обнаружены charset: ${charsets.join(', ')}.`
        : ' Тег <meta charset="UTF-8"> или эквивалент через http-equiv не найден.';
    errors.push(`${fileName}:${details}${formatLinesSuffix(tags.map((tag) => tag.line))}`);
  }
  return item(STATIC_CHECK_NAMES.utf8, errors.length ? 'failed' : 'passed', errors);
}

const META_TAG_REGEX = /<meta\b[^>]*>/gi;
const CHARSET_ATTR_REGEX = /\bcharset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;
const HTTP_EQUIV_ATTR_REGEX = /\bhttp-equiv\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;
const CONTENT_ATTR_REGEX = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;

function attrValue(tag: string, regex: RegExp): string {
  const match = tag.match(regex);
  if (!match) return '';
  return String(match[1] || match[2] || match[3] || '').trim();
}

function hasValidUtf8Meta(tag: string): boolean {
  if (attrValue(tag, CHARSET_ATTR_REGEX).toLowerCase() === 'utf-8') return true;
  if (attrValue(tag, HTTP_EQUIV_ATTR_REGEX).toLowerCase() !== 'content-type') return false;
  return /\bcharset\s*=\s*utf-8\b/i.test(attrValue(tag, CONTENT_ATTR_REGEX).toLowerCase());
}

function declaredCharsets(tags: string[]): string[] {
  const charsets: string[] = [];
  for (const tag of tags) {
    const direct = attrValue(tag, CHARSET_ATTR_REGEX);
    if (direct) {
      charsets.push(direct.toLowerCase());
      continue;
    }
    if (attrValue(tag, HTTP_EQUIV_ATTR_REGEX).toLowerCase() !== 'content-type') continue;
    const content = attrValue(tag, CONTENT_ATTR_REGEX).toLowerCase();
    const match = content.match(/\bcharset\s*=\s*([^\s;]+)/i);
    if (match?.[1]) charsets.push(match[1].toLowerCase());
  }
  return [...new Set(charsets)];
}

function collectMeta(content: string): Array<{ tag: string; line: number }> {
  const tags: Array<{ tag: string; line: number }> = [];
  const re = new RegExp(META_TAG_REGEX.source, 'gi');
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    tags.push({ tag: match[0], line: lineNumberAtIndex(content, match.index) });
  }
  return tags;
}

function checkFavicon(projectPath: string): StaticItem {
  const resolved = resolveLandingFolder(projectPath);
  if (!resolved.ok) return item(STATIC_CHECK_NAMES.favicon, 'warning', [resolved.errors.join('; ')]);
  const indexFile = fs.readdirSync(resolved.landingFolder).find((file) => file === 'index.html' || file === 'index.php');
  if (!indexFile) return item(STATIC_CHECK_NAMES.favicon, 'failed', ['Файл index.html или index.php не найден']);
  const read = readFileUtf8Safe(path.join(resolved.landingFolder, indexFile));
  if (!read.ok) return item(STATIC_CHECK_NAMES.favicon, 'failed', [`Не удалось прочитать ${indexFile}`]);
  const warnings: string[] = [];
  const linkRe = /<link\s+[^>]*rel=["'](?:icon|shortcut icon)["'][^>]*>/i;
  const linkMatch = read.content.match(linkRe);
  const hrefMatch = linkMatch?.[0].match(/href=["']([^"']+)["']/i);
  const faviconPath = hrefMatch?.[1];
  if (!faviconPath) {
    const headIdx = read.content.search(/<head\b/i);
    const suffix = headIdx >= 0 ? formatLinesSuffix([lineNumberAtIndex(read.content, headIdx)]) : '';
    warnings.push(`Тег <link rel='icon'> или <link rel='shortcut icon'> не найден в <head>.${suffix}`);
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(faviconPath)) {
    const linkIdx = read.content.search(linkRe);
    const suffix = linkIdx >= 0 ? formatLinesSuffix([lineNumberAtIndex(read.content, linkIdx)]) : '';
    warnings.push(`Фавикон указан как внешний URL (${faviconPath}); проверка файла на диске пропущена.${suffix}`);
  } else {
    const sanitized = faviconPath.split('?')[0];
    let exists = false;
    const rootResolved = safeResolveUnderLanding(resolved.landingFolder, sanitized);
    if (rootResolved && fs.existsSync(rootResolved)) exists = true;
    else {
      for (const folder of ['img', 'images']) {
        const folderPath = path.resolve(resolved.landingFolder, folder, path.basename(sanitized));
        if (isPathInsideRoot(resolved.landingFolder, folderPath) && fs.existsSync(folderPath)) {
          exists = true;
          break;
        }
      }
    }
    const ext = path.extname(sanitized).toLowerCase();
    if (!exists || !['.ico', '.png', '.svg', '.jpg', '.jpeg', '.webp'].includes(ext)) {
      const linkIdx = read.content.search(linkRe);
      const suffix = linkIdx >= 0 ? formatLinesSuffix([lineNumberAtIndex(read.content, linkIdx)]) : '';
      warnings.push(`Фавикон указан как ${faviconPath}, но файл отсутствует или имеет недопустимое расширение.${suffix}`);
    }
  }
  return item(STATIC_CHECK_NAMES.favicon, warnings.length ? 'warning' : 'passed', warnings);
}

function fileMarkers(rules: AdminRules): string[] {
  return rules.forbidden_script_markers.filter((marker) => /^[^<>\s]+\.[a-z0-9]+$/i.test(marker));
}

function checkStealer(projectPath: string, rules: AdminRules): StaticItem {
  const resolved = resolveLandingFolder(projectPath);
  if (!resolved.ok) return item(STATIC_CHECK_NAMES.stealer, 'failed', [resolved.errors.join('; ')]);
  const indexFile = fs.readdirSync(resolved.landingFolder).find((file) => file === 'index.html' || file === 'index.php');
  if (!indexFile) return item(STATIC_CHECK_NAMES.stealer, 'failed', ['Файл index.html или index.php не найден']);
  const forbidden = new Set(fileMarkers(rules).map((name) => name.toLowerCase()));
  const errors: string[] = [];
  const walk = (dir: string) => {
    for (const itemName of fs.readdirSync(dir)) {
      const itemPath = path.join(dir, itemName);
      if (fs.statSync(itemPath).isDirectory()) walk(itemPath);
      else if (forbidden.has(itemName.toLowerCase())) {
        errors.push(`Запрещённый файл стиллера: ${relFromLanding(resolved.landingFolder, itemPath)}`);
      }
    }
  };
  walk(resolved.landingFolder);
  return item(STATIC_CHECK_NAMES.stealer, errors.length ? 'failed' : 'passed', errors);
}

function checkStyleTags(projectPath: string): StaticItem {
  const errors: string[] = [];
  const resolved = resolveLandingFolder(projectPath);
  if (!resolved.ok) return item(STATIC_CHECK_NAMES.style, 'failed', resolved.errors);
  walkFilesByExtensions(resolved.landingFolder, ['.html', '.php'], (filePath) => {
    const rel = relFromLanding(resolved.landingFolder, filePath);
    const read = readFileUtf8Safe(filePath);
    if (!read.ok) {
      errors.push(`${rel}: не удалось прочитать файл`);
      return;
    }
    const lines = linesForRegexMatches(read.content, /<style\b[^>]*>/gi);
    if (lines.length > 0) {
      errors.push(`${rel}: запрещён тег <style> (подключайте стили через внешние .css)${formatLinesSuffix(lines)}`);
    }
  });
  return item(STATIC_CHECK_NAMES.style, errors.length ? 'failed' : 'passed', errors);
}

function checkLegacy(projectPath: string, rules: AdminRules): StaticItem {
  const resolved = resolveLandingFolder(projectPath);
  if (!resolved.ok) return item(STATIC_CHECK_NAMES.legacy, 'failed', resolved.errors);
  const errors: string[] = [];
  for (const filePath of getAllFilesByExtensions(resolved.landingFolder, ['.html', '.php', '.js', '.css'])) {
    const rel = relFromLanding(resolved.landingFolder, filePath);
    const read = readFileUtf8Safe(filePath);
    if (!read.ok) {
      errors.push(`${rel}: не удалось прочитать файл`);
      continue;
    }
    const base = path.basename(filePath).toLowerCase();
    const skipOffer = rules.expectFormMacro && (base === 'index.html' || base === 'index.php');
    for (const macro of rules.forbidden_macros) {
      if (macro === '{offer}' && skipOffer) continue;
      if (!read.content.includes(macro)) continue;
      const lines = linesForSubstring(read.content, macro, 50);
      errors.push(`${rel}: запрещён устаревший макрос ${macro}${formatLinesSuffix(lines)}`);
    }
  }
  return item(STATIC_CHECK_NAMES.legacy, errors.length ? 'failed' : 'passed', errors);
}

function checkFormMacros(projectPath: string, rules: AdminRules): StaticItem {
  const resolved = resolveLandingFolder(projectPath);
  if (!resolved.ok) return item(STATIC_CHECK_NAMES.form, 'failed', resolved.errors);
  const errors: string[] = [];
  const indexFiles = ['index.html', 'index.php']
    .map((name) => path.join(resolved.landingFolder, name))
    .filter((filePath) => fs.existsSync(filePath));
  let indexContent = '';
  for (const filePath of indexFiles) {
    const read = readFileUtf8Safe(filePath);
    if (read.ok) indexContent += read.content;
  }
  const hasForm = indexContent.includes('{{form}}');
  if (rules.expectFormMacro && !hasForm) {
    errors.push('В конфиге expectFormMacro: true, но в index не найден макрос {{form}}');
  }
  if (rules.expectFormMacro && indexContent.includes('{{link}}')) {
    errors.push(`В index при expectFormMacro: true запрещён макрос {{link}}${formatLinesSuffix(linesForSubstring(indexContent, '{{link}}', 50))}`);
  }
  if (rules.expectFormMacro && indexContent.includes('{offer}')) {
    errors.push(
      `В index при expectFormMacro: true не допускается устаревший макрос {offer} (контекст шаблона с {{form}})${formatLinesSuffix(linesForSubstring(indexContent, '{offer}', 50))}`,
    );
  }
  if (!rules.expectFormMacro && hasForm) {
    errors.push('Макрос {{form}} найден в index, а в конфиге expectFormMacro: false');
  }
  if (!rules.expectFormMacro && !indexContent.includes('{{link}}')) {
    errors.push('В конфиге expectFormMacro: false, но в index не найден обязательный макрос {{link}}');
  }
  if (indexFiles.length > 0 && !indexContent.includes('{{aio.visit.fields.offer_name.for_visitors}}')) {
    errors.push('В index не найден обязательный макрос {{aio.visit.fields.offer_name.for_visitors}}');
  }
  return item(STATIC_CHECK_NAMES.form, errors.length ? 'failed' : 'passed', errors);
}

const TRACKER_MACROS = [
  '{{aio:macros:tracker_protection_1}}',
  '{{aio:macros:tracker_protection_2}}',
  '{{aio:macros:tracker_protection_3}}',
];

function checkTracker(projectPath: string): StaticItem {
  const resolved = resolveLandingFolder(projectPath);
  if (!resolved.ok) return item(STATIC_CHECK_NAMES.tracker, 'failed', resolved.errors);
  const htmlFiles = getAllFilesByExtensions(resolved.landingFolder, ['.html']);
  if (htmlFiles.length === 0) {
    return item(STATIC_CHECK_NAMES.tracker, 'failed', [
      'HTML-файлы не найдены: требуются макросы tracker_protection_1/2/3 в одном файле',
    ]);
  }
  const partial: string[] = [];
  for (const filePath of htmlFiles) {
    const rel = relFromLanding(resolved.landingFolder, filePath);
    const read = readFileUtf8Safe(filePath);
    if (!read.ok) {
      partial.push(`${rel}: не удалось прочитать файл`);
      continue;
    }
    const missing = TRACKER_MACROS.filter((macro) => !read.content.includes(macro));
    if (missing.length === 0) return item(STATIC_CHECK_NAMES.tracker, 'passed', []);
    const present = TRACKER_MACROS.filter((macro) => read.content.includes(macro));
    if (present.length > 0) partial.push(`${rel}: найдены ${present.join(', ')}, не хватает ${missing.join(', ')}`);
  }
  if (partial.length > 0) {
    return item(STATIC_CHECK_NAMES.tracker, 'failed', [
      `Ни один HTML-файл не содержит все три макроса tracker_protection. ${partial.join('; ')}`,
    ]);
  }
  return item(STATIC_CHECK_NAMES.tracker, 'failed', [
    `Ни один HTML-файл не содержит макросы ${TRACKER_MACROS.join(', ')} (все три должны быть в одном файле)`,
  ]);
}

function checkSvg(projectPath: string): StaticItem {
  const resolved = resolveLandingFolder(projectPath);
  if (!resolved.ok) return item(STATIC_CHECK_NAMES.svg, 'failed', resolved.errors);
  const indexFile = fs.readdirSync(resolved.landingFolder).find((file) => file === 'index.html' || file === 'index.php');
  if (!indexFile) return item(STATIC_CHECK_NAMES.svg, 'failed', ['Файл index.html или index.php не найден']);
  const indexRead = readFileUtf8Safe(path.join(resolved.landingFolder, indexFile));
  if (!indexRead.ok) return item(STATIC_CHECK_NAMES.svg, 'failed', [`${indexFile}: не удалось прочитать файл`]);
  const refs = new Set<string>();
  const refRe = /[^\s"'<>]+\.svg(?:\?[^\s"'<>]*)?/gi;
  let refMatch: RegExpExecArray | null;
  while ((refMatch = refRe.exec(indexRead.content)) !== null) refs.add(refMatch[0]);
  if (refs.size === 0) {
    return item(STATIC_CHECK_NAMES.svg, 'failed', [`${indexFile}: не найдено ссылок на SVG с защитным скриптом`]);
  }
  const errors: string[] = [];
  const mismatches: string[] = [];
  let found = false;
  for (const reference of refs) {
    const svgPath = safeResolveUnderLanding(resolved.landingFolder, reference);
    const rel = reference.split('?')[0].replace(/^\.\//, '');
    if (!svgPath || !fs.existsSync(svgPath)) {
      errors.push(`${indexFile}: SVG из index не найден на диске: ${rel}`);
      continue;
    }
    const read = readFileUtf8Safe(svgPath);
    if (!read.ok) {
      errors.push(`${rel}: не удалось прочитать файл`);
      continue;
    }
    const bodies: string[] = [];
    const scriptRe = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;
    let scriptMatch: RegExpExecArray | null;
    while ((scriptMatch = scriptRe.exec(read.content)) !== null) {
      const cdata = scriptMatch[1].match(/<!\[CDATA\[\*\/([\s\S]*?)\/\*\]\]>/);
      if (cdata) bodies.push(cdata[1]);
    }
    const hasMarkers = read.content.includes('checkProtection_v2') || read.content.includes('landProtection');
    if (bodies.length === 0 && !hasMarkers) {
      mismatches.push(`${rel}: SVG подключён в ${indexFile}, но не содержит защитный скрипт`);
      continue;
    }
    const exact = bodies.some(
      (body) => crypto.createHash('sha256').update(body, 'utf8').digest('hex') === EXPECTED_SVG_SCRIPT_SHA256,
    );
    if (exact) {
      found = true;
      continue;
    }
    mismatches.push(`${rel}: защитный скрипт найден, но его содержимое отличается от эталонного`);
  }
  if (!found) {
    if (mismatches.length) errors.push(mismatches.join('; '));
    errors.push(`Ни один SVG, подключённый в ${indexFile}, не содержит требуемый защитный скрипт`);
  }
  return item(STATIC_CHECK_NAMES.svg, errors.length ? 'failed' : 'passed', errors);
}

function hasVersionCacheBusterQuery(fullRef: string): boolean {
  const noHash = fullRef.split('#')[0];
  const q = noHash.indexOf('?');
  if (q < 0) return false;
  return /(?:^|[&])v(?:=|(?=&)|$)/.test(noHash.slice(q + 1));
}

function isExternalOrIgnored(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return true;
  if (trimmed.startsWith('//') || trimmed.startsWith('#')) return true;
  return false;
}

function checkCacheBuster(projectPath: string): StaticItem {
  const resolved = resolveLandingFolder(projectPath);
  if (!resolved.ok) return item(STATIC_CHECK_NAMES.cache, 'failed', resolved.errors);
  const errors: string[] = [];
  const resourceExt =
    'png|jpe?g|webp|gif|svg|avif|bmp|ico|mp4|webm|m4v|mov|ogv|mp3|wav|m4a|ogg|flac|woff2?|ttf|otf|eot|pdf';
  const push = (rel: string, content: string, refs: Array<{ value: string; index: number }>) => {
    const linesByValue = new Map<string, Set<number>>();
    for (const ref of refs) {
      if (isExternalOrIgnored(ref.value.split('#')[0].split('?')[0])) continue;
      if (safeResolveUnderLanding(resolved.landingFolder, ref.value) == null) continue;
      if (!hasVersionCacheBusterQuery(ref.value)) continue;
      const bucket = linesByValue.get(ref.value) ?? new Set<number>();
      bucket.add(lineNumberAtIndex(content, ref.index));
      linesByValue.set(ref.value, bucket);
    }
    for (const [value, lines] of linesByValue) {
      errors.push(
        `${rel}: в относительном пути к ресурсу запрещён cache-buster «?v» (проблемы Docker/архива): «${value}»${formatLinesSuffix([...lines].sort((a, b) => a - b))}`,
      );
    }
  };
  for (const filePath of getAllFilesByExtensions(resolved.landingFolder, ['.html', '.php'])) {
    const rel = relFromLanding(resolved.landingFolder, filePath);
    const read = readFileUtf8Safe(filePath);
    if (!read.ok) {
      errors.push(`${rel}: не удалось прочитать файл`);
      continue;
    }
    const refs: Array<{ value: string; index: number }> = [];
    const re = /(?:href|src)\s*=\s*(["'])((?:(?!\1).)*)\1/gi;
    let match: RegExpExecArray | null;
    while ((match = re.exec(read.content)) !== null) refs.push({ value: match[2].trim(), index: match.index });
    push(rel, read.content, refs);
  }
  for (const filePath of getAllFilesByExtensions(resolved.landingFolder, ['.css'])) {
    const rel = relFromLanding(resolved.landingFolder, filePath);
    const read = readFileUtf8Safe(filePath);
    if (!read.ok) {
      errors.push(`${rel}: не удалось прочитать файл`);
      continue;
    }
    push(rel, read.content, collectCssRefs(read.content));
  }
  const jsRe = new RegExp(`(['"\`])([^'"\`\\r\\n]*?\\.(?:${resourceExt})(?:\\?[^'"\`\\r\\n]*)?)\\1`, 'gi');
  for (const filePath of getAllFilesByExtensions(resolved.landingFolder, ['.js'])) {
    const rel = relFromLanding(resolved.landingFolder, filePath);
    const read = readFileUtf8Safe(filePath);
    if (!read.ok) {
      errors.push(`${rel}: не удалось прочитать файл`);
      continue;
    }
    const refs: Array<{ value: string; index: number }> = [];
    jsRe.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = jsRe.exec(read.content)) !== null) refs.push({ value: match[2].trim(), index: match.index });
    push(rel, read.content, refs);
  }
  return item(STATIC_CHECK_NAMES.cache, errors.length ? 'failed' : 'passed', errors);
}

function collectCssRefs(content: string): Array<{ value: string; index: number }> {
  const refs: Array<{ value: string; index: number }> = [];
  const urlRe = /url\(\s*(?:'([^']*)'|"([^"]*)"|([^)'"\s][^)]*?))\s*\)/g;
  const importRe = /@import\s+(?:url\(\s*)?(?:'([^']*)'|"([^"]*)")\s*\)?/g;
  let match: RegExpExecArray | null;
  while ((match = urlRe.exec(content)) !== null) {
    refs.push({ value: (match[1] ?? match[2] ?? match[3] ?? '').trim(), index: match.index });
  }
  while ((match = importRe.exec(content)) !== null) {
    refs.push({ value: (match[1] ?? match[2] ?? '').trim(), index: match.index });
  }
  return refs;
}

function checkLargeScripts(projectPath: string, rules: AdminRules): StaticItem {
  const resolved = resolveLandingFolder(projectPath);
  if (!resolved.ok) return item(STATIC_CHECK_NAMES.scripts, 'failed', resolved.errors);
  const errors: string[] = [];
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  walkFilesByExtensions(resolved.landingFolder, ['.html', '.php'], (filePath) => {
    const rel = relFromLanding(resolved.landingFolder, filePath);
    const read = readFileUtf8Safe(filePath);
    if (!read.ok) {
      errors.push(`${rel}: не удалось прочитать файл`);
      return;
    }
    scriptRe.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = scriptRe.exec(read.content)) !== null) {
      if (/class=["'].*\bwhitelist\b.*["']/.test(match[1])) continue;
      const lines = match[2].split('\n').filter((line) => line.trim().length > 0);
      if (lines.length > rules.inline_script_max_nonempty_lines) {
        errors.push(
          `${rel}: встроенный <script> без class="whitelist" содержит более ${rules.inline_script_max_nonempty_lines} непустых строк (${lines.length})${formatLinesSuffix([lineNumberAtIndex(read.content, match.index)])}`,
        );
      }
    }
  });
  return item(STATIC_CHECK_NAMES.scripts, errors.length ? 'failed' : 'passed', errors);
}

function checkCss(projectPath: string, rules: AdminRules): StaticItem {
  const resolved = resolveLandingFolder(projectPath);
  if (!resolved.ok) return item(STATIC_CHECK_NAMES.css, 'failed', [resolved.errors.join('; ')]);
  const warnings: string[] = [];
  const errors: string[] = [];
  const walk = (dir: string) => {
    for (const itemName of fs.readdirSync(dir)) {
      const itemPath = path.join(dir, itemName);
      const stats = fs.statSync(itemPath);
      if (stats.isDirectory()) walk(itemPath);
      else if (path.extname(itemPath).toLowerCase() === '.css') {
        const sizeKb = stats.size / 1024;
        const rel = relFromLanding(resolved.landingFolder, itemPath);
        if (sizeKb >= rules.css_ok_kb && sizeKb <= rules.css_failed_kb) {
          warnings.push(`${rel} — ${sizeKb.toFixed(2)} KB (допустимо до ${rules.css_ok_kb} KB без предупреждения)`);
        } else if (sizeKb > rules.css_failed_kb) {
          errors.push(`${rel} — ${sizeKb.toFixed(2)} KB (лимит ${rules.css_failed_kb} KB)`);
        }
      }
    }
  };
  walk(resolved.landingFolder);
  if (errors.length) return item(STATIC_CHECK_NAMES.css, 'failed', [`CSS превышает ${rules.css_failed_kb} KB: ${errors.join('; ')}`]);
  if (warnings.length) {
    return item(STATIC_CHECK_NAMES.css, 'warning', [`CSS ${rules.css_ok_kb}–${rules.css_failed_kb} KB (предупреждение): ${warnings.join('; ')}`]);
  }
  return item(STATIC_CHECK_NAMES.css, 'passed', []);
}

function checkUnwanted(projectPath: string, rules: AdminRules): StaticItem {
  const resolved = resolveLandingFolder(projectPath);
  if (!resolved.ok) return item(STATIC_CHECK_NAMES.unwanted, 'failed', resolved.errors);
  const errors: string[] = [];
  const allowedObjects = [
    /<object[^>]*data="(?:img|images)\/secimg\.svg\?o=\{offer_id}&l=\{landing_id}"[^>]*>/i,
    /<img[^>]*src="(?:img|images)\/secimg\.svg"[^>]*>/i,
    /<object[^>]*type="image\/svg\+xml"[^>]*>/i,
  ];
  const patterns = rules.forbidden_script_markers
    .filter((marker) => marker.startsWith('<') || marker === 'onload=' || marker === 'base64,')
    .map((marker) => {
      if (marker === 'onload=') return { name: 'onload attribute', regex: /\bonload=["'].*?["']/gi };
      if (marker === 'base64,') return { name: 'base64 string', regex: /base64,/gi };
      const tag = marker.slice(1);
      return { name: tag, regex: new RegExp(`<${tag}\\b[^>]*>`, 'gi') };
    });
  for (const file of getAllFilesByExtensions(resolved.landingFolder, ['.html', '.php'])) {
    const rel = relFromLanding(resolved.landingFolder, file);
    const read = readFileUtf8Safe(file);
    if (!read.ok) {
      errors.push(`${rel}: не удалось прочитать файл`);
      continue;
    }
    let content = read.content.replace(/<svg[\s\S]*?<\/svg>/gi, '');
    content = allowedObjects.reduce((acc, allowed) => acc.replace(allowed, ''), content);
    for (const pattern of patterns) {
      pattern.regex.lastIndex = 0;
      if (!pattern.regex.test(content)) continue;
      pattern.regex.lastIndex = 0;
      const lines = linesForRegexMatches(content, pattern.regex);
      errors.push(`${rel}: запрещённый элемент — ${pattern.name}${formatLinesSuffix(lines)}`);
    }
  }
  return item(STATIC_CHECK_NAMES.unwanted, errors.length ? 'failed' : 'passed', errors);
}

function checkBase64(projectPath: string, rules: AdminRules): StaticItem {
  const resolved = resolveLandingFolder(projectPath);
  if (!resolved.ok) return item(STATIC_CHECK_NAMES.base64, 'failed', resolved.errors);
  const errors: string[] = [];
  const patterns = [
    rules.forbidden_script_markers.includes('base64,') ? { name: 'base64', regex: /base64,/gi } : null,
    rules.forbidden_script_markers.includes('atob') ? { name: 'atob', regex: /\batob\b/gi } : null,
  ].filter((pattern): pattern is { name: string; regex: RegExp } => pattern != null);
  for (const file of getAllFilesByExtensions(resolved.landingFolder, ['.html', '.php', '.js', '.css'])) {
    const rel = relFromLanding(resolved.landingFolder, file);
    const read = readFileUtf8Safe(file);
    if (!read.ok) {
      errors.push(`${rel}: не удалось прочитать файл`);
      continue;
    }
    for (const pattern of patterns) {
      pattern.regex.lastIndex = 0;
      if (!pattern.regex.test(read.content)) continue;
      pattern.regex.lastIndex = 0;
      errors.push(`${rel} содержит использование ${pattern.name}${formatLinesSuffix(linesForRegexMatches(read.content, pattern.regex))}`);
    }
  }
  return item(STATIC_CHECK_NAMES.base64, errors.length ? 'failed' : 'passed', errors);
}

function checkCdn(projectPath: string): StaticItem {
  const resolved = resolveLandingFolder(projectPath);
  if (!resolved.ok) return item(STATIC_CHECK_NAMES.cdn, 'failed', resolved.errors);
  const errors: string[] = [];
  const styleExt = ['.css', '.scss', '.sass', '.less'];
  const scriptExt = ['.js', '.mjs', '.cjs', '.ts'];
  const resourceExt =
    'png|jpe?g|webp|gif|svg|avif|bmp|ico|mp4|webm|m4v|mov|ogv|mp3|wav|m4a|ogg|flac|woff2?|ttf|otf|eot|pdf';
  const jsRe = new RegExp(`(['"\`])([^'"\`\\r\\n]*?\\.(?:${resourceExt})(?:\\?[^'"\`\\r\\n]*)?)\\1`, 'gi');
  for (const filePath of getAllFilesByExtensions(resolved.landingFolder, [...styleExt, ...scriptExt])) {
    const rel = relFromLanding(resolved.landingFolder, filePath);
    const read = readFileUtf8Safe(filePath);
    if (!read.ok) {
      errors.push(`${rel}: не удалось прочитать файл`);
      continue;
    }
    const ext = path.extname(filePath).toLowerCase();
    let refs: Array<{ value: string; index: number }>;
    if (styleExt.includes(ext)) refs = collectCssRefs(read.content);
    else {
      refs = [];
      jsRe.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = jsRe.exec(read.content)) !== null) refs.push({ value: match[2].trim(), index: match.index });
    }
    const linesByPath = new Map<string, Set<number>>();
    for (const ref of refs) {
      if (isExternalOrIgnored(ref.value) || ref.value.startsWith('{{cdn}}/')) continue;
      const bucket = linesByPath.get(ref.value) ?? new Set<number>();
      bucket.add(lineNumberAtIndex(read.content, ref.index));
      linesByPath.set(ref.value, bucket);
    }
    for (const [value, lines] of linesByPath) {
      errors.push(
        `${rel}: ссылка «${value}» не начинается с «{{cdn}}/»${formatLinesSuffix([...lines].sort((a, b) => a - b))}`,
      );
    }
  }
  return item(STATIC_CHECK_NAMES.cdn, errors.length ? 'failed' : 'passed', errors);
}

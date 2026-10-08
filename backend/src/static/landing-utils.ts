import fs from 'fs';
import path from 'path';

export function resolveLandingFolder(
  projectPath: string,
): { ok: true; landingFolder: string } | { ok: false; errors: string[] } {
  let items: string[];
  try {
    items = fs.readdirSync(projectPath);
  } catch {
    return { ok: false, errors: [`Не удалось прочитать каталог: ${projectPath}`] };
  }
  const folders = items.filter((item) => {
    try {
      return fs.statSync(path.join(projectPath, item)).isDirectory();
    } catch {
      return false;
    }
  });
  if (folders.length !== 1) {
    return {
      ok: false,
      errors: [`Ожидается одна папка с лендингом в «${projectPath}», найдено подпапок: ${folders.length}`],
    };
  }
  return { ok: true, landingFolder: path.join(projectPath, folders[0]) };
}

export function isPathInsideRoot(rootDir: string, candidatePath: string): boolean {
  const root = path.resolve(rootDir);
  const candidate = path.resolve(candidatePath);
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function safeResolveUnderLanding(landingFolder: string, unsafeRelativePath: string | null): string | null {
  if (unsafeRelativePath == null || typeof unsafeRelativePath !== 'string') return null;
  const cleaned = unsafeRelativePath.split('?')[0].split('#')[0].trim();
  if (!cleaned) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(cleaned)) return null;
  if (cleaned.startsWith('//')) return null;
  if (path.isAbsolute(cleaned)) return null;
  const joined = path.resolve(landingFolder, cleaned);
  if (!isPathInsideRoot(landingFolder, joined)) return null;
  return joined;
}

export function relFromLanding(landingFolder: string, filePath: string): string {
  return path.relative(landingFolder, filePath).split(path.sep).join('/');
}

export function getAllFilesByExtensions(rootDir: string, extensions: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let items: string[];
    try {
      items = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const item of items) {
      const itemPath = path.join(dir, item);
      let stats: fs.Stats;
      try {
        stats = fs.statSync(itemPath);
      } catch {
        continue;
      }
      if (stats.isDirectory()) walk(itemPath);
      else if (extensions.includes(path.extname(item).toLowerCase())) out.push(itemPath);
    }
  };
  walk(rootDir);
  return out;
}

export function walkFilesByExtensions(dir: string, extensions: string[], onFile: (filePath: string) => void): void {
  let items: string[];
  try {
    items = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const item of items) {
    const itemPath = path.join(dir, item);
    let stats: fs.Stats;
    try {
      stats = fs.statSync(itemPath);
    } catch {
      continue;
    }
    if (stats.isDirectory()) walkFilesByExtensions(itemPath, extensions, onFile);
    else if (extensions.includes(path.extname(item).toLowerCase())) onFile(itemPath);
  }
}

export function readFileUtf8Safe(filePath: string): { ok: true; content: string } | { ok: false; error: string } {
  try {
    return { ok: true, content: fs.readFileSync(filePath, 'utf-8') };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'read-failed' };
  }
}

export function lineNumberAtIndex(content: string, index: number): number {
  const i = Math.max(0, Math.min(index, content.length));
  return content.slice(0, i).split(/\r?\n/).length;
}

export function linesForRegexMatches(content: string, regex: RegExp, maxMatches = 200): number[] {
  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
  const re = new RegExp(regex.source, flags);
  const lines = new Set<number>();
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    lines.add(lineNumberAtIndex(content, match.index));
    count += 1;
    if (count >= maxMatches) break;
    if (match[0].length === 0) {
      re.lastIndex += 1;
      if (re.lastIndex > content.length) break;
    }
  }
  return [...lines].sort((a, b) => a - b);
}

export function linesForSubstring(content: string, sub: string, maxOccurrences = 50): number[] {
  if (!sub) return [];
  const lines = new Set<number>();
  let from = 0;
  let occ = 0;
  while (from <= content.length && occ < maxOccurrences) {
    const index = content.indexOf(sub, from);
    if (index < 0) break;
    lines.add(lineNumberAtIndex(content, index));
    from = index + Math.max(1, sub.length);
    occ += 1;
  }
  return [...lines].sort((a, b) => a - b);
}

export function formatLinesSuffix(lineNumbers: number[]): string {
  if (!lineNumbers || lineNumbers.length === 0) return '';
  const unique = [...new Set(lineNumbers)].sort((a, b) => a - b);
  if (unique.length <= 8) return ` (стр. ${unique.join(', ')})`;
  return ` (стр. ${unique.slice(0, 8).join(', ')} … +${unique.length - 8})`;
}

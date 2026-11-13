import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { MAX_UNPACK_BYTES, MAX_UNPACK_ENTRIES } from '../aio/aio.client';
import { resolveLandingFolder } from '../static/landing-utils';

export const UNPACK_TOO_LARGE = 'Архив слишком большой';

export function unpackZip(
  buffer: Buffer,
  currentDir: string,
  limits?: { maxEntries?: number; maxBytes?: number },
): { projectPath: string; landingFolder: string } {
  const maxEntries = limits?.maxEntries ?? MAX_UNPACK_ENTRIES;
  const maxBytes = limits?.maxBytes ?? MAX_UNPACK_BYTES;
  const rawDir = path.join(currentDir, 'raw');
  fs.rmSync(rawDir, { recursive: true, force: true });
  fs.mkdirSync(rawDir, { recursive: true });
  const zip = new AdmZip(buffer);
  const root = path.resolve(rawDir);
  const planned: Array<{ entry: AdmZip.IZipEntry; target: string; directory: boolean }> = [];
  let total = 0;
  for (const entry of zip.getEntries()) {
    const name = entry.entryName.replace(/\\/g, '/');
    if (!name || name.startsWith('__MACOSX/')) continue;
    if (name.includes('..')) throw new Error('Недопустимый путь в архиве');
    const target = path.resolve(root, name);
    const rel = path.relative(root, target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Недопустимый путь в архиве');
    if (planned.length >= maxEntries) throw new Error(UNPACK_TOO_LARGE);
    const directory = entry.isDirectory;
    if (!directory) {
      const size = declaredSize(entry);
      if (size > maxBytes || total > maxBytes - size) throw new Error(UNPACK_TOO_LARGE);
      total += size;
    }
    planned.push({ entry, target, directory });
  }
  for (const item of planned) {
    if (item.directory) {
      fs.mkdirSync(item.target, { recursive: true });
      continue;
    }
    const data = item.entry.getData();
    if (data.length > declaredSize(item.entry)) throw new Error(UNPACK_TOO_LARGE);
    fs.mkdirSync(path.dirname(item.target), { recursive: true });
    fs.writeFileSync(item.target, data);
  }
  const projectPath = normalizeProject(rawDir, currentDir);
  const resolved = resolveLandingFolder(projectPath);
  if (!resolved.ok) throw new Error('Не удалось определить каталог ленда');
  return { projectPath, landingFolder: resolved.landingFolder };
}

function declaredSize(entry: AdmZip.IZipEntry): number {
  const size = entry.header.size;
  if (!Number.isFinite(size) || size < 0) return Number.POSITIVE_INFINITY;
  return size;
}

function normalizeProject(rawDir: string, currentDir: string): string {
  const items = fs.readdirSync(rawDir).filter((name) => name !== '__MACOSX' && name !== '.DS_Store');
  const dirs = items.filter((name) => fs.statSync(path.join(rawDir, name)).isDirectory());
  const files = items.filter((name) => !fs.statSync(path.join(rawDir, name)).isDirectory());
  if (dirs.length === 1 && files.length === 0) return rawDir;
  const project = path.join(currentDir, 'project');
  const landing = path.join(project, 'landing');
  fs.rmSync(project, { recursive: true, force: true });
  fs.mkdirSync(landing, { recursive: true });
  for (const name of items) {
    fs.renameSync(path.join(rawDir, name), path.join(landing, name));
  }
  return project;
}

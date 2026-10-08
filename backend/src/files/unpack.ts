import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { resolveLandingFolder } from '../static/landing-utils';

export function unpackZip(buffer: Buffer, currentDir: string): { projectPath: string; landingFolder: string } {
  const rawDir = path.join(currentDir, 'raw');
  fs.rmSync(rawDir, { recursive: true, force: true });
  fs.mkdirSync(rawDir, { recursive: true });
  const zip = new AdmZip(buffer);
  const root = path.resolve(rawDir);
  for (const entry of zip.getEntries()) {
    const name = entry.entryName.replace(/\\/g, '/');
    if (!name || name.startsWith('__MACOSX/')) continue;
    if (name.includes('..')) throw new Error('Недопустимый путь в архиве');
    const target = path.resolve(root, name);
    const rel = path.relative(root, target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Недопустимый путь в архиве');
    if (entry.isDirectory) {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.getData());
  }
  const projectPath = normalizeProject(rawDir, currentDir);
  const resolved = resolveLandingFolder(projectPath);
  if (!resolved.ok) throw new Error('Не удалось определить каталог ленда');
  return { projectPath, landingFolder: resolved.landingFolder };
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

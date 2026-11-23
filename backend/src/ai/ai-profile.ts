import fs from 'fs';
import os from 'os';
import path from 'path';
import { AiProfileRef } from '../reports/report.types';
import { GrokLoginSpawn, GrokSpawn, spawnGrok, spawnGrokLogin } from './grok.spawn';

export const DEFAULT_GROK_MODEL = 'grok-4.7';
export const DEEPSEEK_PROFILE: AiProfileRef = { id: 'deepseek', label: 'DeepSeek' };

export const GROK_PROBE = 'GROK_PROBE';

export interface GrokProbe {
  command(): string | null;
  /** True when the OS user already has a Grok Build session file. The token is not read. */
  session(): boolean;
  spawn: GrokSpawn;
  spawnLogin: GrokLoginSpawn;
}

export function grokLabel(slug: string): string {
  const model = slug.trim() || DEFAULT_GROK_MODEL;
  return model === DEFAULT_GROK_MODEL ? 'Grok 4.7' : `Grok ${model}`;
}

export function listAiProfiles(
  config: { aiMode: 'stub' | 'real'; aiApiKey: string; grokModel: string },
  probe: { command: boolean; session: boolean },
): AiProfileRef[] {
  const profiles: AiProfileRef[] = [];
  if (config.aiMode === 'real' && config.aiApiKey.trim()) profiles.push(DEEPSEEK_PROFILE);
  if (probe.command && probe.session) profiles.push({ id: 'grok', label: grokLabel(config.grokModel) });
  return profiles;
}

/**
 * Omitted profile: DeepSeek when it is available, otherwise the only available profile.
 * An empty list still resolves to the DeepSeek stub so existing checks can start.
 * An explicit id must be one of the available profiles. A free model slug is refused.
 */
export function chooseAiProfile(requested: string | undefined, available: readonly AiProfileRef[]): AiProfileRef | null {
  if (requested == null) {
    return available.find((item) => item.id === 'deepseek') ?? (available.length === 1 ? available[0] : DEEPSEEK_PROFILE);
  }
  return available.find((item) => item.id === requested) ?? null;
}

export function profileFromSnapshot(snapshot: { ai_profile?: { id?: unknown; label?: unknown } | null }): AiProfileRef {
  const raw = snapshot.ai_profile;
  if (!raw || (raw.id !== 'deepseek' && raw.id !== 'grok')) return DEEPSEEK_PROFILE;
  const label = typeof raw.label === 'string' ? raw.label.trim() : '';
  if (!label) return raw.id === 'grok' ? { id: 'grok', label: grokLabel(DEFAULT_GROK_MODEL) } : DEEPSEEK_PROFILE;
  return { id: raw.id, label };
}

export function grokHome(env: NodeJS.ProcessEnv = process.env, homedir: string = os.homedir()): string {
  const set = typeof env.GROK_HOME === 'string' ? env.GROK_HOME.trim() : '';
  if (set) return set;
  return path.join(homedir, '.grok');
}

/** Session file exists and is non-empty. Contents stay on disk. */
export function grokSessionPresent(env: NodeJS.ProcessEnv = process.env, homedir: string = os.homedir()): boolean {
  try {
    const stat = fs.statSync(path.join(grokHome(env, homedir), 'auth.json'));
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function grokFileNames(): string[] {
  return process.platform === 'win32' ? ['grok.exe', 'grok.cmd', 'grok'] : ['grok'];
}

function isFile(candidate: string): boolean {
  try {
    return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function shebangLine(candidate: string): string {
  let fd: number | null = null;
  try {
    fd = fs.openSync(candidate, 'r');
    const buf = Buffer.alloc(128);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const text = buf.subarray(0, n).toString('utf8');
    if (!text.startsWith('#!')) return '';
    return text.split(/\r?\n/, 1)[0];
  } catch {
    return '';
  } finally {
    if (fd != null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

/** Local and global npm cmd shims both point at the package's node entry. */
function nodeEntryNearShim(shimPath: string): string | null {
  const dir = path.dirname(shimPath);
  const candidates = [
    path.join(dir, '..', '@xai-official', 'grok', 'bin', 'grok'),
    path.join(dir, 'node_modules', '@xai-official', 'grok', 'bin', 'grok'),
  ];
  for (const candidate of candidates) {
    if (isFile(candidate)) return candidate;
  }
  return null;
}

function launchPath(candidate: string): string | null {
  if (!isFile(candidate)) return null;
  if (process.platform === 'win32' && candidate.toLowerCase().endsWith('.cmd')) return nodeEntryNearShim(candidate);
  if (process.platform === 'win32' && /\/bin\/(?:sh|bash)\b/.test(shebangLine(candidate))) return null;
  return candidate;
}

function grokInDir(dir: string): string | null {
  for (const name of grokFileNames()) {
    const found = launchPath(path.join(dir, name));
    if (found) return found;
  }
  return null;
}

/**
 * Package install first (`node_modules/.bin`, then `@xai-official/grok/bin`), then PATH.
 * The VPS unit runs `node dist/main.js` and does not put `node_modules/.bin` on PATH.
 * `dist/ai` and `src/ai` are both two levels below `backend/`.
 */
export function findGrokCommand(
  env: NodeJS.ProcessEnv = process.env,
  localBinDir: string = path.join(__dirname, '..', '..', 'node_modules', '.bin'),
): string | null {
  const packaged = grokInDir(localBinDir) ?? grokInDir(path.join(localBinDir, '..', '@xai-official', 'grok', 'bin'));
  if (packaged) return packaged;
  const pathValue = env.PATH ?? env.Path ?? '';
  if (!pathValue) return null;
  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir) continue;
    const found = grokInDir(dir);
    if (found) return found;
  }
  return null;
}

export function realGrokProbe(): GrokProbe {
  return {
    command: () => findGrokCommand(),
    session: () => grokSessionPresent(),
    spawn: spawnGrok,
    spawnLogin: spawnGrokLogin,
  };
}

export function disabledGrokProbe(): GrokProbe {
  return {
    command: () => null,
    session: () => false,
    spawn: async () => {
      throw new Error('grok spawn is disabled');
    },
    spawnLogin: async () => {
      throw new Error('grok login is disabled');
    },
  };
}

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

export function findGrokCommand(env: NodeJS.ProcessEnv = process.env): string | null {
  const pathValue = env.PATH ?? env.Path ?? '';
  if (!pathValue) return null;
  const dirs = pathValue.split(path.delimiter).filter((dir) => dir.length > 0);
  const names = process.platform === 'win32' ? ['grok.exe', 'grok'] : ['grok'];
  for (const name of names) {
    for (const dir of dirs) {
      const candidate = path.join(dir, name);
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
      } catch {
        continue;
      }
    }
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

import { Role } from './roles';

export interface AppConfig {
  storage: 'neon' | 'memory';
  databaseUrl: string;
  aioToken: string;
  aioBaseUrl: string;
  tlLogin: string;
  tlPassword: string;
  workDir: string;
  port: number;
  publicBaseUrl: string;
  frontendOrigin: string[];
  standFormHtml: string;
  standBrandName: string;
  standCdnBase: string;
  catalogAutoRefresh: boolean;
  aioNotifyPollMs: number;
  aioNotifyPollsPerAttempt: number;
  aiMode: 'stub' | 'real';
  aiBaseUrl: string;
  aiApiKey: string;
  aiModel: string;
  lighthouseMode: 'stub' | 'real';
  lighthouseChromePath: string;
  bcryptRounds: number;
}

export interface SessionUser {
  login: string;
  role: Role;
  source: 'environment' | 'neon';
}

export function secretList(config: AppConfig): string[] {
  return [config.aioToken, config.tlPassword, config.tlLogin, config.aiApiKey, config.databaseUrl].filter(
    (value) => typeof value === 'string' && value.length >= 8,
  );
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const storage = env.STORAGE === 'memory' ? 'memory' : 'neon';
  const tlLogin = env.TL_LOGIN ?? '';
  const tlPassword = env.TL_PASSWORD ?? '';
  const aioToken = env.AIO_TOKEN ?? '';
  const databaseUrl = env.DATABASE_URL ?? '';
  if (!tlLogin || !tlPassword) {
    throw new Error('TL_LOGIN and TL_PASSWORD are required');
  }
  if (!aioToken) {
    throw new Error('AIO_TOKEN is required');
  }
  if (storage === 'neon' && !databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  const port = Number(env.PORT ?? 3000);
  return {
    storage,
    databaseUrl,
    aioToken,
    aioBaseUrl: (env.AIO_BASE_URL ?? 'https://app.aio.tech').replace(/\/$/, ''),
    tlLogin,
    tlPassword,
    workDir: env.WORK_DIR ?? './data/workdir',
    port: Number.isFinite(port) ? port : 3000,
    publicBaseUrl: (env.PUBLIC_BASE_URL ?? `http://127.0.0.1:${Number.isFinite(port) ? port : 3000}`).replace(
      /\/$/,
      '',
    ),
    frontendOrigin: parseFrontendOrigin(env.FRONTEND_ORIGIN),
    standFormHtml: env.STAND_FORM_HTML ?? '<div data-stand-form="1"></div>',
    standBrandName: env.STAND_BRAND_NAME ?? 'Brand',
    standCdnBase: env.STAND_CDN_BASE ?? '',
    catalogAutoRefresh: env.VERCEL === '1' ? false : env.CATALOG_AUTO_REFRESH !== '0',
    aioNotifyPollMs: positiveInt(env.AIO_NOTIFY_POLL_MS, 2000),
    aioNotifyPollsPerAttempt: positiveInt(env.AIO_NOTIFY_POLLS_PER_ATTEMPT, 5),
    aiMode: env.AI_MODE === 'real' ? 'real' : 'stub',
    aiBaseUrl: (env.GEMINI_API_BASE ?? env.AI_BASE_URL ?? 'https://generativelanguage.googleapis.com').replace(
      /\/$/,
      '',
    ),
    aiApiKey: env.GEMINI_API_KEY || env.AI_API_KEY || '',
    aiModel: env.AI_MODEL ?? 'gemini-3.5-flash-lite',
    lighthouseMode: env.LIGHTHOUSE_MODE === 'real' ? 'real' : 'stub',
    lighthouseChromePath: env.LIGHTHOUSE_CHROME_PATH ?? '',
    bcryptRounds: positiveInt(env.BCRYPT_ROUNDS, 10),
  };
}

function parseFrontendOrigin(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => origin.length > 0);
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

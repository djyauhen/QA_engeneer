import { Role } from './roles';
import { configuredStandFormHtml } from './stand/form-html';

export interface AppConfig {
  storage: 'neon' | 'memory';
  databaseUrl: string;
  aioToken: string;
  aioBaseUrl: string;
  aioStorageHosts: string[];
  /** AIO campaign used only to mint a Landing Preview Link. Empty skips the call. */
  aioPreviewCampaignUuid: string;
  /** AIO source used only to mint a Landing Preview Link. Empty skips the call. */
  aioPreviewSourceUuid: string;
  /** AIO domain used only to mint a Landing Preview Link. Empty skips the call. */
  aioPreviewDomainUuid: string;
  /** Sent as x-tenant-id only on the link-generator call. Empty omits the header. */
  aioTenantId: string;
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
  lighthouseNoSandbox: boolean;
  visualMode: 'stub' | 'real';
  visualChromePath: string;
  bcryptRounds: number;
  poolMax: number;
  /** HMAC key for the env team-lead password fingerprint. Not stored in sessions. */
  fingerprintKey: string;
}

export interface SessionUser {
  login: string;
  role: Role;
  source: 'environment' | 'neon';
}

export function secretList(config: AppConfig): string[] {
  return [config.aioToken, config.tlPassword, config.tlLogin, config.aiApiKey, config.databaseUrl, config.aioTenantId, config.fingerprintKey].filter(
    (value) => typeof value === 'string' && value.length >= 8,
  );
}

/** False when any of the three preview UUIDs is missing. Link generation must not run. */
export function previewLinkConfigured(config: AppConfig): boolean {
  return (
    config.aioPreviewCampaignUuid.length > 0 &&
    config.aioPreviewSourceUuid.length > 0 &&
    config.aioPreviewDomainUuid.length > 0
  );
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const storage = env.STORAGE === 'memory' ? 'memory' : 'neon';
  const tlLogin = env.TL_LOGIN ?? '';
  const tlPassword = env.TL_PASSWORD ?? '';
  const aioToken = unwrapEnv(env.AIO_TOKEN);
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
  const publicBaseUrl = (env.PUBLIC_BASE_URL ?? `http://127.0.0.1:${Number.isFinite(port) ? port : 3000}`).replace(
    /\/$/,
    '',
  );
  const frontendOrigin = parseFrontendOrigin(env.FRONTEND_ORIGIN);
  if (frontendOrigin.length === 0 && !isLoopbackUrl(publicBaseUrl)) {
    throw new Error('FRONTEND_ORIGIN is required');
  }
  const fingerprintKey = unwrapEnv(env.FINGERPRINT_KEY);
  if (!fingerprintKey) {
    throw new Error('FINGERPRINT_KEY is required');
  }
  if (env.AI_MODE === 'real' && !(unwrapEnv(env.DEEPSEEK_API_KEY) || unwrapEnv(env.AI_API_KEY))) {
    throw new Error('DEEPSEEK_API_KEY is required');
  }
  const lighthouseChromePath = unwrapEnv(env.LIGHTHOUSE_CHROME_PATH);
  const visualChromePath = unwrapEnv(env.VISUAL_CHROME_PATH);
  const chromePath = unwrapEnv(env.CHROME_PATH);
  return {
    storage,
    databaseUrl,
    aioToken,
    aioBaseUrl: (unwrapEnv(env.AIO_BASE_URL) || 'https://app.aio.tech').replace(/\/$/, ''),
    aioStorageHosts: parseFrontendOrigin(env.AIO_STORAGE_HOSTS),
    aioPreviewCampaignUuid: unwrapEnv(env.AIO_PREVIEW_CAMPAIGN_UUID),
    aioPreviewSourceUuid: unwrapEnv(env.AIO_PREVIEW_SOURCE_UUID),
    aioPreviewDomainUuid: unwrapEnv(env.AIO_PREVIEW_DOMAIN_UUID),
    aioTenantId: unwrapEnv(env.AIO_TENANT_ID),
    tlLogin,
    tlPassword,
    workDir: resolveWorkDir(env),
    port: Number.isFinite(port) ? port : 3000,
    publicBaseUrl,
    frontendOrigin,
    standFormHtml: configuredStandFormHtml(env.STAND_FORM_HTML),
    standBrandName: env.STAND_BRAND_NAME ?? 'Brand',
    standCdnBase: env.STAND_CDN_BASE ?? '',
    catalogAutoRefresh: env.CATALOG_AUTO_REFRESH !== '0',
    aioNotifyPollMs: positiveInt(env.AIO_NOTIFY_POLL_MS, 2000),
    aioNotifyPollsPerAttempt: positiveInt(env.AIO_NOTIFY_POLLS_PER_ATTEMPT, 5),
    aiMode: env.AI_MODE === 'real' ? 'real' : 'stub',
    aiBaseUrl: (unwrapEnv(env.AI_BASE_URL) || 'https://api.deepseek.com').replace(/\/$/, ''),
    aiApiKey: unwrapEnv(env.DEEPSEEK_API_KEY) || unwrapEnv(env.AI_API_KEY),
    aiModel: unwrapEnv(env.AI_MODEL) || 'deepseek-v4-pro',
    lighthouseMode: env.LIGHTHOUSE_MODE === 'real' ? 'real' : 'stub',
    lighthouseChromePath: lighthouseChromePath || visualChromePath || chromePath,
    lighthouseNoSandbox: env.LIGHTHOUSE_NO_SANDBOX === '1',
    visualMode: env.VISUAL_MODE === 'real' ? 'real' : 'stub',
    visualChromePath: visualChromePath || lighthouseChromePath || chromePath,
    bcryptRounds: positiveInt(env.BCRYPT_ROUNDS, 10),
    poolMax: 10,
    fingerprintKey,
  };
}

function resolveWorkDir(env: NodeJS.ProcessEnv): string {
  return env.WORK_DIR?.trim() || './data/workdir';
}

export function isLoopbackUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

function parseFrontendOrigin(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => origin.length > 0);
}

function unwrapEnv(value: string | undefined): string {
  let text = (value ?? '').trim();
  if (text.length >= 2) {
    const quote = text[0];
    if ((quote === '"' || quote === "'") && text.endsWith(quote)) text = text.slice(1, -1).trim();
  }
  return text;
}

/** Public TLS ends at nginx. The Node process stays on loopback. */
export function listenHost(env: NodeJS.ProcessEnv): string {
  const host = unwrapEnv(env.LISTEN_HOST);
  if (!host || host === '127.0.0.1' || host === 'localhost' || host === '::1') return '127.0.0.1';
  throw new Error('LISTEN_HOST must be 127.0.0.1');
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

import { spawn, SpawnOptions } from 'child_process';
import fs from 'fs';
import path from 'path';
import { AppConfig } from '../config';
import { LighthouseMetrics } from '../reports/report.types';

export abstract class LighthouseRunner {
  abstract run(url: string, formFactor: 'mobile' | 'desktop'): Promise<LighthouseMetrics>;

  mode(): 'stub' | 'real' {
    return 'real';
  }
}

export class StubLighthouseRunner extends LighthouseRunner {
  override mode(): 'stub' | 'real' {
    return 'stub';
  }

  async run(_url: string, formFactor: 'mobile' | 'desktop'): Promise<LighthouseMetrics> {
    const desktop = formFactor === 'desktop';
    return {
      performance_score: desktop ? 0.62 : 0.48,
      first_contentful_paint: desktop ? 1100 : 1800,
      largest_contentful_paint: desktop ? 2000 : 3100,
      total_blocking_time: desktop ? 40 : 180,
      cumulative_layout_shift: desktop ? 0.02 : 0.08,
      speed_index: desktop ? 1600 : 2700,
      time_to_interactive: desktop ? 2200 : 3600,
      screenshot: null,
    };
  }
}

export class CliLighthouseRunner extends LighthouseRunner {
  constructor(private readonly config: AppConfig) {
    super();
  }

  async run(url: string, formFactor: 'mobile' | 'desktop'): Promise<LighthouseMetrics> {
    const args = [
      '--yes',
      'lighthouse',
      url,
      '--quiet',
      `--chrome-flags=--headless${this.config.lighthouseNoSandbox ? ' --no-sandbox' : ''}`,
      '--only-categories=performance',
      `--form-factor=${formFactor}`,
      '--output=json',
      '--output-path=stdout',
    ];
    if (formFactor === 'desktop') args.push('--preset=desktop');
    if (this.config.lighthouseChromePath) {
      args.push(`--chrome-path=${this.config.lighthouseChromePath}`);
    }
    const stdout = await exec(args);
    return parseLighthouse(stdout);
  }
}

export interface LighthouseSpawnSpec {
  command: string;
  args: string[];
  options: Pick<SpawnOptions, 'shell' | 'windowsVerbatimArguments'>;
}

/**
 * `spawn('npx', { shell: false })` fails on Windows because npx is npx.cmd.
 * Prefer node plus the npm cli script so a Chrome path with spaces stays one argument.
 * The cmd.exe fallback is only used when that script is not next to node.
 */
export function lighthouseSpawnSpec(
  npxArgs: string[],
  env: {
    platform?: NodeJS.Platform;
    execPath?: string;
    fileExists?: (candidate: string) => boolean;
    comSpec?: string;
  } = {},
): LighthouseSpawnSpec {
  const platform = env.platform ?? process.platform;
  if (platform !== 'win32') {
    return { command: 'npx', args: npxArgs, options: { shell: false } };
  }
  const execPath = env.execPath ?? process.execPath;
  const fileExists = env.fileExists ?? fs.existsSync;
  const npxCli = path.win32.join(path.win32.dirname(execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
  if (fileExists(npxCli)) {
    return { command: execPath, args: [npxCli, ...npxArgs], options: { shell: false } };
  }
  const comSpec = env.comSpec || process.env.ComSpec || 'cmd.exe';
  const inner = ['npx.cmd', ...npxArgs].map(quoteCmdArg).join(' ');
  return {
    command: comSpec,
    args: ['/d', '/s', '/c', `"${inner}"`],
    options: { shell: false, windowsVerbatimArguments: true },
  };
}

function quoteCmdArg(value: string): string {
  if (/[\0\r\n]/.test(value)) throw new Error('Сбой Lighthouse');
  const escaped = value.replace(/%/g, '%%').replace(/"/g, '""');
  if (value.length === 0 || /[\s"&<>|^%]/.test(value)) return `"${escaped}"`;
  return value;
}

interface LighthouseAuditDetails {
  data?: unknown;
  items?: unknown;
  screenshot?: unknown;
}

interface LighthouseJson {
  categories?: { performance?: { score?: number | null } };
  audits?: Record<string, { numericValue?: number; details?: LighthouseAuditDetails }>;
  fullPageScreenshot?: { screenshot?: unknown; data?: unknown } | null;
}

export function parseLighthouse(stdout: string): LighthouseMetrics {
  const jsonStart = stdout.indexOf('{');
  const parsed = JSON.parse(stdout.slice(jsonStart)) as LighthouseJson;
  const audit = (id: string): number | null => {
    const value = parsed.audits?.[id]?.numericValue;
    return typeof value === 'number' ? value : null;
  };
  const score = parsed.categories?.performance?.score;
  return {
    performance_score: typeof score === 'number' ? score : null,
    first_contentful_paint: audit('first-contentful-paint'),
    largest_contentful_paint: audit('largest-contentful-paint'),
    total_blocking_time: audit('total-blocking-time'),
    cumulative_layout_shift: audit('cumulative-layout-shift'),
    speed_index: audit('speed-index'),
    time_to_interactive: audit('interactive'),
    screenshot: lighthouseScreenshot(parsed),
  };
}

function lighthouseScreenshot(parsed: LighthouseJson): string | null {
  const audits = parsed.audits;
  return (
    dataImageUrl(audits?.['final-screenshot']?.details) ??
    dataImageUrl(audits?.['screenshot-thumbnails']?.details) ??
    dataImageUrl(parsed.fullPageScreenshot?.screenshot) ??
    dataImageUrl(parsed.fullPageScreenshot)
  );
}

/** Keep a data URL. Raw base64 and `{ data, width, height }` become `data:image/...`. */
function dataImageUrl(value: unknown, depth = 0): string | null {
  if (depth > 4 || value == null) return null;
  if (typeof value === 'string') return dataImageFromString(value);
  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const found = dataImageUrl(value[index], depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === 'object') {
    const record = value as { data?: unknown; screenshot?: unknown; items?: unknown };
    return (
      dataImageUrl(record.data, depth + 1) ??
      dataImageUrl(record.screenshot, depth + 1) ??
      dataImageUrl(record.items, depth + 1)
    );
  }
  return null;
}

function dataImageFromString(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^data:image\//i.test(trimmed)) return trimmed;
  const compact = trimmed.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const mime = mimeForImageBase64(compact);
  if (!mime) return null;
  return `data:${mime};base64,${compact}`;
}

function mimeForImageBase64(value: string): string | null {
  if (value.startsWith('/9j/')) return 'image/jpeg';
  if (value.startsWith('iVBORw0KGgo')) return 'image/png';
  if (value.startsWith('R0lGOD')) return 'image/gif';
  if (value.startsWith('UklGR')) return 'image/webp';
  return null;
}

function exec(args: string[]): Promise<string> {
  const spec = lighthouseSpawnSpec(args);
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, spec.options);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Сбой Lighthouse'));
    }, 90_000);
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', () => {
      clearTimeout(timer);
      reject(new Error('Сбой Lighthouse'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      void stderr;
      if (code !== 0) reject(new Error('Сбой Lighthouse'));
      else resolve(Buffer.concat(stdout).toString('utf8'));
    });
  });
}

export function createLighthouseRunner(config: AppConfig): LighthouseRunner {
  if (config.lighthouseMode === 'real') return new CliLighthouseRunner(config);
  return new StubLighthouseRunner();
}

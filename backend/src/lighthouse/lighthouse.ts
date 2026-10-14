import { spawn } from 'child_process';
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
    };
  }
}

export class CliLighthouseRunner extends LighthouseRunner {
  constructor(private readonly config: AppConfig) {
    super();
  }

  async run(url: string, formFactor: 'mobile' | 'desktop'): Promise<LighthouseMetrics> {
    const args = [
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
    const stdout = await exec('npx', args);
    return parseLighthouse(stdout);
  }
}

export function parseLighthouse(stdout: string): LighthouseMetrics {
  const jsonStart = stdout.indexOf('{');
  const parsed = JSON.parse(stdout.slice(jsonStart)) as {
    categories?: { performance?: { score?: number | null } };
    audits?: Record<string, { numericValue?: number }>;
  };
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
  };
}

function exec(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false });
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

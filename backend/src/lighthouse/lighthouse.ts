import { spawn } from 'child_process';
import { AppConfig } from '../config';
import { LighthouseMetrics } from '../reports/report.types';

export abstract class LighthouseRunner {
  abstract run(url: string, formFactor: 'mobile' | 'desktop'): Promise<LighthouseMetrics>;
}

export class StubLighthouseRunner extends LighthouseRunner {
  async run(_url: string, formFactor: 'mobile' | 'desktop'): Promise<LighthouseMetrics> {
    const desktop = formFactor === 'desktop';
    return {
      performance_score: desktop ? 0.62 : 0.48,
      first_contentful_paint: desktop ? 1.1 : 1.8,
      largest_contentful_paint: desktop ? 2.0 : 3.1,
      total_blocking_time: desktop ? 40 : 180,
      cumulative_layout_shift: desktop ? 0.02 : 0.08,
      speed_index: desktop ? 1.6 : 2.7,
      time_to_interactive: desktop ? 2.2 : 3.6,
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
      '--chrome-flags=--headless --no-sandbox',
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
    const child = spawn(command, args, { shell: process.platform === 'win32' });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', () => reject(new Error('Сбой Lighthouse')));
    child.on('close', (code) => {
      if (code !== 0) reject(new Error('Сбой Lighthouse'));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

export function createLighthouseRunner(config: AppConfig): LighthouseRunner {
  if (config.lighthouseMode === 'real') return new CliLighthouseRunner(config);
  return new StubLighthouseRunner();
}

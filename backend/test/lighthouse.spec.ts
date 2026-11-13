import path from 'path';
import { lighthouseSpawnSpec, parseLighthouse } from '../src/lighthouse/lighthouse';

const chromeArg = '--chrome-path=C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const cliPath = path.join('app', 'node_modules', 'lighthouse', 'cli', 'index.js');

describe('lighthouse CLI spawn', () => {
  it('runs the installed CLI through node so a Chrome path with spaces stays one argument', () => {
    const spec = lighthouseSpawnSpec(['--quiet', 'http://127.0.0.1/stand', chromeArg], {
      execPath: 'C:\\Program Files\\nodejs\\node.exe',
      cliPath,
    });
    expect(spec).toEqual({
      command: 'C:\\Program Files\\nodejs\\node.exe',
      args: [cliPath, '--quiet', 'http://127.0.0.1/stand', chromeArg],
      options: { shell: false },
    });
    expect(spec.args.join('\n')).not.toContain('npx');
  });

  it('passes a query string as one argument without a shell', () => {
    const spec = lighthouseSpawnSpec(['http://127.0.0.1/stand?a=1&b=2', chromeArg], {
      execPath: 'C:\\nodejs\\node.exe',
      cliPath,
    });
    expect(spec).toEqual({
      command: 'C:\\nodejs\\node.exe',
      args: [cliPath, 'http://127.0.0.1/stand?a=1&b=2', chromeArg],
      options: { shell: false },
    });
  });

  it('uses the local lighthouse CLI and the current node binary when paths are omitted', () => {
    const spec = lighthouseSpawnSpec(['--quiet', chromeArg]);
    expect(spec.command).toBe(process.execPath);
    expect(spec.args[0].replace(/\\/g, '/')).toMatch(/\/node_modules\/lighthouse\/cli\/index\.js$/);
    expect(spec.args.slice(1)).toEqual(['--quiet', chromeArg]);
    expect(spec.options).toEqual({ shell: false });
  });
});

const VIEWPORT = 'data:image/jpeg;base64,viewport';
const FULL_PAGE = 'data:image/jpeg;base64,fullpage';

function lighthouseStdout(body: Record<string, unknown>): string {
  return `LH log line\n${JSON.stringify(body)}`;
}

describe('parseLighthouse', () => {
  it('reads the viewport data URL and numeric audits after a non-JSON prefix', () => {
    const metrics = parseLighthouse(
      lighthouseStdout({
        categories: { performance: { score: 0.91 } },
        audits: {
          'first-contentful-paint': { numericValue: 1200 },
          'largest-contentful-paint': { numericValue: 2100 },
          'total-blocking-time': { numericValue: 40 },
          'cumulative-layout-shift': { numericValue: 0.02 },
          'speed-index': { numericValue: 1600 },
          interactive: { numericValue: 2400 },
          'final-screenshot': { details: { data: VIEWPORT } },
        },
        fullPageScreenshot: { screenshot: { data: FULL_PAGE } },
      }),
    );
    expect(metrics.screenshot).toBe(VIEWPORT);
    expect(metrics.performance_score).toBe(0.91);
    expect(metrics.first_contentful_paint).toBe(1200);
    expect(metrics.largest_contentful_paint).toBe(2100);
    expect(metrics.total_blocking_time).toBe(40);
    expect(metrics.cumulative_layout_shift).toBe(0.02);
    expect(metrics.speed_index).toBe(1600);
    expect(metrics.time_to_interactive).toBe(2400);
  });

  it('uses the full-page screenshot only when the viewport shot is missing or not a data URL', () => {
    const missing = parseLighthouse(
      lighthouseStdout({
        categories: { performance: { score: 0.5 } },
        audits: { 'first-contentful-paint': { numericValue: 900 } },
        fullPageScreenshot: { screenshot: { data: FULL_PAGE } },
      }),
    );
    expect(missing.screenshot).toBe(FULL_PAGE);
    expect(missing.first_contentful_paint).toBe(900);

    const ignored = parseLighthouse(
      lighthouseStdout({
        audits: { 'final-screenshot': { details: { data: 'https://example.test/shot.jpg' } } },
        fullPageScreenshot: { screenshot: { data: FULL_PAGE } },
      }),
    );
    expect(ignored.screenshot).toBe(FULL_PAGE);
  });

  it('returns null when Lighthouse did not return an image data URL', () => {
    const metrics = parseLighthouse(
      lighthouseStdout({
        categories: { performance: { score: null } },
        audits: {
          'speed-index': { numericValue: 3000 },
          'final-screenshot': { details: { data: 12 } },
        },
        fullPageScreenshot: { screenshot: { data: 'not-an-image' } },
      }),
    );
    expect(metrics.screenshot).toBeNull();
    expect(metrics.performance_score).toBeNull();
    expect(metrics.speed_index).toBe(3000);
    expect(metrics.first_contentful_paint).toBeNull();
    expect(metrics.time_to_interactive).toBeNull();
  });
});

import { lighthouseSpawnSpec, parseLighthouse } from '../src/lighthouse/lighthouse';

const chromeArg = '--chrome-path=C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

describe('lighthouse CLI spawn', () => {
  it('runs npx through node on Windows so a Chrome path with spaces stays one argument', () => {
    const spec = lighthouseSpawnSpec(['--yes', 'lighthouse', 'http://127.0.0.1/stand', chromeArg], {
      platform: 'win32',
      execPath: 'C:\\Program Files\\nodejs\\node.exe',
      fileExists: (candidate) => candidate.endsWith('npx-cli.js'),
    });
    expect(spec.options.shell).toBe(false);
    expect(spec.command).toBe('C:\\Program Files\\nodejs\\node.exe');
    expect(spec.args[0]).toBe('C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js');
    expect(spec.args.slice(1)).toEqual(['--yes', 'lighthouse', 'http://127.0.0.1/stand', chromeArg]);
  });

  it('quotes npx.cmd for cmd.exe when the npm cli script is missing', () => {
    const spec = lighthouseSpawnSpec(['--yes', 'lighthouse', 'http://127.0.0.1/stand?a=1&b=2', chromeArg], {
      platform: 'win32',
      execPath: 'C:\\nodejs\\node.exe',
      fileExists: () => false,
      comSpec: 'C:\\Windows\\System32\\cmd.exe',
    });
    expect(spec.command).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(spec.options).toEqual({ shell: false, windowsVerbatimArguments: true });
    expect(spec.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    const command = String(spec.args[3]);
    expect(command.startsWith('"npx.cmd ')).toBe(true);
    expect(command).toContain('"http://127.0.0.1/stand?a=1&b=2"');
    expect(command).toContain(`"${chromeArg}"`);
  });

  it('keeps a direct npx spawn off Windows', () => {
    const spec = lighthouseSpawnSpec(['--yes', 'lighthouse', chromeArg], {
      platform: 'linux',
      execPath: '/usr/bin/node',
      fileExists: () => true,
    });
    expect(spec).toEqual({
      command: 'npx',
      args: ['--yes', 'lighthouse', chromeArg],
      options: { shell: false },
    });
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

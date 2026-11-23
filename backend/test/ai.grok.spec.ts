import fs from 'fs';
import os from 'os';
import path from 'path';
import { GrokBuildAiClient } from '../src/ai/grok.client';
import { GROK_DISALLOWED_TOOLS, grokLogHint } from '../src/ai/grok.spawn';
import { AppConfig } from '../src/config';

function grokConfig(grokModel = 'grok-4.7'): AppConfig {
  return {
    storage: 'memory',
    databaseUrl: '',
    aioToken: 'test-aio-token-value',
    aioBaseUrl: 'https://app.aio.tech',
    aioStorageHosts: [],
    tlLogin: 'env-tl',
    tlPassword: 'env-tl-pass',
    workDir: '.',
    port: 0,
    publicBaseUrl: 'http://127.0.0.1',
    standFormHtml: '',
    standBrandName: 'Brand',
    standCdnBase: '',
    catalogAutoRefresh: false,
    frontendOrigin: [],
    aioNotifyPollMs: 1,
    aioNotifyPollsPerAttempt: 2,
    aiMode: 'real',
    aiBaseUrl: 'https://api.deepseek.com',
    aiApiKey: 'test-deepseek-key-must-stay-out-of-argv',
    aiModel: 'deepseek-v4-pro',
    aiVisionModel: 'deepseek-flash',
    grokModel,
    lighthouseMode: 'stub',
    lighthouseChromePath: '',
    lighthouseNoSandbox: false,
    visualMode: 'stub',
    visualChromePath: '',
    bcryptRounds: 4,
    poolMax: 10,
    fingerprintKey: 'test-fingerprint-key',
    aioPreviewCampaignUuid: '',
    aioPreviewSourceUuid: '',
    aioPreviewDomainUuid: '',
    aioTenantId: '',
  };
}

function answerFor(prompt: string): string {
  if (prompt.includes('"labels"')) {
    return JSON.stringify({
      observations: [{ ref: 'desktop', visible_text: 'шапка', visible_name: '', face_visible: false, note: 'кадр' }],
    });
  }
  return JSON.stringify({ status: 'PASS', note: 'ок', findings: [], clarifications: [] });
}

describe('grok build profile', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x00, 0x11]);

  async function reviewWith(grokModel: string) {
    const seen: Array<{ command: string; args: string[]; cwd: string; hadJpeg: boolean }> = [];
    const client = new GrokBuildAiClient(
      grokConfig(grokModel),
      async (command, args, options) => {
        const cwd = options.cwd ?? '';
        const file = path.join(cwd, 'desktop.jpg');
        const hadJpeg = fs.existsSync(file);
        if (hadJpeg) {
          expect(fs.readFileSync(file).equals(jpeg)).toBe(true);
          expect(args[args.indexOf('-p') + 1]).toContain('@desktop.jpg');
        }
        seen.push({ command, args: [...args], cwd, hadJpeg });
        const prompt = args[args.indexOf('-p') + 1] ?? '';
        return {
          stdout: JSON.stringify({
            text: answerFor(prompt),
            sessionId: 'session-should-not-leak',
            usage: { input_tokens: 3, output_tokens: 1 },
          }),
          code: 0,
        };
      },
      () => 'grok',
    );
    const result = await client.review({
      name: 'Lander',
      languages: ['ru'],
      countries: ['PL'],
      standUrl: null,
      files: [],
      screenshot: jpeg,
      checkDate: '2026-11-22',
    });
    return { seen, result };
  }

  it('uses one grok-4.7 slug for the visual pass and a checklist item, and passes the JPEG as @file', async () => {
    const { seen, result } = await reviewWith('grok-4.7');
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.some((call) => (call.args[call.args.indexOf('-p') + 1] ?? '').includes('"labels"'))).toBe(true);
    expect(seen.some((call) => (call.args[call.args.indexOf('-p') + 1] ?? '').includes('"category"'))).toBe(true);
    expect(seen.some((call) => call.hadJpeg)).toBe(true);
    for (const call of seen) {
      expect(call.command).toBe('grok');
      expect(call.args[0]).toBe('--no-auto-update');
      expect(call.args[call.args.indexOf('-m') + 1]).toBe('grok-4.7');
      expect(call.args[call.args.indexOf('--max-turns') + 1]).toBe('4');
      expect(call.args).toEqual(
        expect.arrayContaining([
          '--no-plan',
          '--no-subagents',
          '--disable-web-search',
          '--sandbox',
          'read-only',
        ]),
      );
      expect(call.args[call.args.indexOf('--disallowed-tools') + 1]).toBe(GROK_DISALLOWED_TOOLS);
      expect(call.args[call.args.indexOf('--sandbox') + 1]).toBe('read-only');
      const joined = call.args.join('\n');
      expect(joined).not.toContain('thinking');
      expect(joined).not.toContain('reasoning_effort');
      expect(joined).not.toContain('api.deepseek.com');
      expect(joined).not.toContain('test-deepseek-key-must-stay-out-of-argv');
      expect(joined).not.toContain('data:image');
      expect(joined).not.toContain('--always-approve');
      expect(call.cwd.startsWith(os.tmpdir())).toBe(true);
      expect(path.resolve(call.cwd)).not.toBe(path.resolve(process.cwd()));
      expect(fs.existsSync(call.cwd)).toBe(false);
    }
    const body = JSON.stringify(result);
    expect(body).not.toContain('session-should-not-leak');
    expect(body).not.toContain('qa-grok-');
    expect(body).not.toContain('test-deepseek-key-must-stay-out-of-argv');
    expect(body).not.toContain(jpeg.toString('base64'));
    expect(result.ai_requests?.shots).toEqual({});
    const models = result.ai_requests?.calls.map((call) => call.model) ?? [];
    expect(models.length).toBeGreaterThan(1);
    expect(new Set(models)).toEqual(new Set(['grok-4.7']));
    expect(result.ai_requests?.calls.some((call) => call.kind === 'vision')).toBe(true);
    expect(result.ai_requests?.calls.some((call) => call.kind === 'category')).toBe(true);
  });

  it('accepts the answer text when grok exits 1 after max turns with JSON on stdout', async () => {
    const client = new GrokBuildAiClient(
      grokConfig(),
      async (_command, args) => {
        expect(args[args.indexOf('--max-turns') + 1]).toBe('4');
        const prompt = args[args.indexOf('-p') + 1] ?? '';
        return {
          stdout: JSON.stringify({
            text: answerFor(prompt),
            usage: { input_tokens: 3, output_tokens: 1 },
          }),
          stderr: 'Error: max turns reached',
          code: 1,
        };
      },
      () => 'grok',
    );
    const result = await client.review({
      name: 'Lander',
      languages: ['ru'],
      countries: ['PL'],
      standUrl: null,
      files: [],
      screenshot: jpeg,
      checkDate: '2026-11-22',
    });
    const checks = result.report?.checks ?? [];
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.every((check) => check.status === 'PASS' && check.note === 'ок')).toBe(true);
  });

  it('still fails a non-zero exit when stdout is empty or not the JSON answer', async () => {
    for (const stdout of ['', 'Error: max turns reached', '{"usage":{"input_tokens":1}}']) {
      const client = new GrokBuildAiClient(
        grokConfig(),
        async () => ({ stdout, stderr: 'Error: max turns reached', code: 1 }),
        () => 'grok',
      );
      const result = await client.review({
        name: 'Lander',
        languages: ['ru'],
        countries: ['PL'],
        standUrl: null,
        files: [],
        screenshot: jpeg,
        checkDate: '2026-11-22',
      });
      const checks = result.report?.checks ?? [];
      expect(checks.length).toBeGreaterThan(0);
      expect(checks.every((check) => check.status === 'GAP')).toBe(true);
      expect(JSON.stringify(result)).not.toContain('"note":"ок"');
    }
  });

  it('reads a PASS object that follows a Russian sentence, and still reads a bare object', async () => {
    for (const shape of ['prose', 'object'] as const) {
      const client = new GrokBuildAiClient(
        grokConfig(),
        async (_command, args) => {
          const joined = args.join('\n');
          expect(joined).not.toContain('test-deepseek-key-must-stay-out-of-argv');
          expect(joined).not.toContain('api.deepseek.com');
          const prompt = args[args.indexOf('-p') + 1] ?? '';
          if (prompt.includes('@desktop.jpg')) expect(prompt).toContain('@desktop.jpg');
          const disallowed = args[args.indexOf('--disallowed-tools') + 1] ?? '';
          expect(disallowed).toContain('grep');
          expect(disallowed).toContain('monitor');
          expect(disallowed).not.toContain('read_file');
          expect(args[args.indexOf('--system-prompt-override') + 1]).toContain('начинается с {');
          const body = answerFor(prompt);
          const text =
            shape === 'prose'
              ? `Проверяю поле телефона на лендинге и сверю международный код с GEO Канады.\n${body}`
              : body;
          return { stdout: JSON.stringify({ text, usage: { input_tokens: 2, output_tokens: 1 } }), code: 0 };
        },
        () => 'grok',
      );
      const result = await client.review({
        name: 'Lander',
        languages: ['ru'],
        countries: ['PL'],
        standUrl: null,
        files: [],
        screenshot: jpeg,
        checkDate: '2026-11-22',
      });
      const checks = result.report?.checks ?? [];
      expect(checks.length).toBeGreaterThan(0);
      expect(checks.every((check) => check.status === 'PASS' && check.note === 'ок')).toBe(true);
      expect(JSON.stringify(result)).not.toContain('сбой вызова');
    }
  });

  it('still fails prose that never closes with a JSON object', async () => {
    const client = new GrokBuildAiClient(
      grokConfig(),
      async () => ({
        stdout: JSON.stringify({
          text: 'Проверяю поле телефона на лендинге и сверю международный код с GEO Канады.',
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        code: 0,
      }),
      () => 'grok',
    );
    const result = await client.review({
      name: 'Lander',
      languages: ['ru'],
      countries: ['PL'],
      standUrl: null,
      files: [],
      screenshot: jpeg,
      checkDate: '2026-11-22',
    });
    const checks = result.report?.checks ?? [];
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.every((check) => check.status === 'GAP')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('"note":"ок"');
  });

  it('lets GROK_MODEL replace the slug for both passes', async () => {
    const { seen } = await reviewWith('grok-custom');
    expect(seen.length).toBeGreaterThan(1);
    for (const call of seen) expect(call.args[call.args.indexOf('-m') + 1]).toBe('grok-custom');
  });

  it('keeps a short exit code and one stderr line, and drops argv, prompts, and tokens', () => {
    const sandbox = grokLogHint(
      1,
      'error: bwrap exec failed: No such file or directory (os error 2).\nsecond line stays out',
    );
    expect(sandbox).toBe('exit 1: error: bwrap exec failed: No such file or directory (os error 2).');
    expect(sandbox).not.toContain('second line');

    const leaked = grokLogHint(
      2,
      '-p do not log this prompt --system-prompt-override secret sk-supersecretvalue1234567890abcdef',
    );
    expect(leaked).toBe('exit 2');

    const redacted = grokLogHint(3, 'error: auth failed sk-supersecretvalue1234567890abcdef');
    expect(redacted.startsWith('exit 3:')).toBe(true);
    expect(redacted).toContain('[redacted]');
    expect(redacted).not.toContain('sk-super');
    expect(grokLogHint(null, '')).toBe('');
  });
});

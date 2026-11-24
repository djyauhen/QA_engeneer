import fs from 'fs';
import os from 'os';
import path from 'path';
import { AiCallError, DeepSeekChatRequest } from '../src/ai/ai.client';
import { GAP_NOTE } from '../src/ai/qa-categories';
import { GROK_CATEGORY_CONCURRENCY, GrokBuildAiClient } from '../src/ai/grok.client';
import { GROK_DISALLOWED_TOOLS, GROK_SPAWN_TIMEOUT_MS, grokLogHint } from '../src/ai/grok.spawn';
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

function lastUser(prompt: string): string {
  const parts = prompt.split(/\nuser:\n/);
  return parts[parts.length - 1] ?? prompt;
}

function flagValue(args: readonly string[], flag: string): string {
  const index = args.indexOf(flag);
  return index >= 0 ? (args[index + 1] ?? '') : '';
}

function turnText(args: readonly string[]): { prompt: string; system: string } {
  const promptFile = flagValue(args, '--prompt-file');
  const systemFile = flagValue(args, '--system-prompt-file');
  return {
    prompt: fs.readFileSync(promptFile, 'utf8'),
    system: fs.readFileSync(systemFile, 'utf8'),
  };
}

function answerFor(prompt: string): string {
  const tail = lastUser(prompt);
  if (tail.includes('"labels"') && !/"category"\s*:/.test(tail)) {
    return JSON.stringify({
      observations: [{ ref: 'desktop', visible_text: 'шапка', visible_name: '', face_visible: false, note: 'кадр' }],
    });
  }
  return JSON.stringify({ status: 'PASS', note: 'ок', findings: [], clarifications: [] });
}

const VISION_CATEGORIES = [1, 2, 3, 5, 6, 7, 9, 10, 11];

describe('grok build profile', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x00, 0x11]);

  function jsonAnswer(prompt: string, sessionId?: string) {
    return JSON.stringify({
      text: answerFor(prompt),
      ...(sessionId ? { sessionId } : {}),
      usage: { input_tokens: 3, output_tokens: 1 },
    });
  }

  async function reviewWith(grokModel: string, withSessionId: boolean) {
    const seen: Array<{ command: string; args: string[]; cwd: string; hadJpeg: boolean; prompt: string; system: string; timeoutMs: number }> = [];
    const client = new GrokBuildAiClient(
      grokConfig(grokModel),
      async (command, args, options) => {
        const cwd = options.cwd ?? '';
        const file = path.join(cwd, 'desktop.jpg');
        const hadJpeg = fs.existsSync(file);
        if (hadJpeg) expect(fs.readFileSync(file).equals(jpeg)).toBe(true);
        const { prompt, system } = turnText(args);
        seen.push({ command, args: [...args], cwd, hadJpeg, prompt, system, timeoutMs: options.timeoutMs ?? 0 });
        return {
          stdout: jsonAnswer(prompt, withSessionId ? 'session-should-not-be-required' : undefined),
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

  it('spawns grok-4.7 with the current user turn, JPEG @names, and no resume or session id', async () => {
    const { seen, result } = await reviewWith('grok-4.7', false);
    expect(seen.length).toBeGreaterThan(1);
    expect(seen[0].args).not.toContain('--resume');
    expect(seen[0].args).not.toContain('-p');
    expect(seen[0].args).not.toContain('--single');
    expect(new Set(seen.map((call) => call.cwd)).size).toBe(seen.length);
    const parentDir = path.dirname(seen[0].cwd);
    expect(path.basename(parentDir).startsWith('qa-grok-')).toBe(true);
    for (const call of seen) expect(path.dirname(call.cwd)).toBe(parentDir);
    expect(fs.existsSync(path.join(seen[1].cwd, 'desktop.jpg'))).toBe(false);
    const laterPrompt = seen[1].prompt;
    expect(laterPrompt).not.toContain('assistant:');
    expect(laterPrompt.startsWith('user:')).toBe(false);
    expect(laterPrompt).toContain('шапка');
    for (const call of seen) {
      expect(call.args).not.toContain('--resume');
      expect(call.args).not.toContain('-p');
      expect(call.args).not.toContain('--single');
      expect(call.args).not.toContain('--system-prompt-override');
      expect(call.command).toBe('grok');
      expect(call.args[0]).toBe('--no-auto-update');
      expect(call.args[call.args.indexOf('-m') + 1]).toBe('grok-4.7');
      expect(call.args[call.args.indexOf('--reasoning-effort') + 1]).toBe('low');
      expect(call.args[call.args.indexOf('--max-turns') + 1]).toBe('8');
      expect(call.args).toEqual(
        expect.arrayContaining(['--no-plan', '--no-subagents', '--disable-web-search']),
      );
      if (process.platform === 'win32') {
        expect(call.args).not.toContain('--sandbox');
        expect(call.args).not.toContain('read-only');
      } else {
        expect(call.args).toEqual(expect.arrayContaining(['--sandbox', 'read-only']));
      }
      expect(call.timeoutMs).toBe(GROK_SPAWN_TIMEOUT_MS);
      expect(GROK_SPAWN_TIMEOUT_MS).toBe(300_000);
      expect(call.args[call.args.indexOf('--disallowed-tools') + 1]).toBe(GROK_DISALLOWED_TOOLS);
      const promptFile = flagValue(call.args, '--prompt-file');
      const systemFile = flagValue(call.args, '--system-prompt-file');
      expect(promptFile).toBe(path.join(call.cwd, 'prompt.txt'));
      expect(systemFile).toBe(path.join(call.cwd, 'system.txt'));
      expect(call.prompt.length).toBeGreaterThan(0);
      expect(call.system).toContain('начинается с {');
      expect(call.system).not.toContain('ТВОЯ РОЛЬ');
      const prompt = call.prompt;
      const tail = lastUser(prompt);
      const categoryMatch = /"category"\s*:\s*(\d+)/.exec(tail);
      const category = categoryMatch ? Number(categoryMatch[1]) : Number.NaN;
      if (!categoryMatch) {
        expect(call.system).toContain('Ты только глаза');
      } else {
        expect(call.system).toContain('ИНСТРУКЦИЯ');
        expect(call.system).toContain('Этот вызов проверяет только пункт');
      }
      const wantsFrames = (!categoryMatch && tail.includes('"labels"')) || VISION_CATEGORIES.includes(category);
      if (wantsFrames) {
        expect(prompt).toContain('@desktop.jpg');
        expect(prompt).toContain('Каждая строка выше начинается с @ и кончается на .jpg.');
        expect(prompt).not.toContain('Эти файлы @jpg — кадры этого сообщения.');
        expect(call.hadJpeg).toBe(true);
      } else {
        expect(prompt).not.toContain('@desktop.jpg');
      }
      const joined = call.args.join('\n');
      expect(joined).not.toContain('ТВОЯ РОЛЬ');
      expect(joined).not.toContain('начинается с {');
      expect(joined).not.toContain('шапка');
      expect(joined).not.toContain('Эти файлы @jpg');
      expect(call.args.every((arg) => arg.length < 1000)).toBe(true);
      expect(joined).not.toContain('thinking');
      expect(joined).not.toContain('reasoning_effort');
      expect(joined).not.toContain('api.deepseek.com');
      expect(joined).not.toContain('test-deepseek-key-must-stay-out-of-argv');
      expect(joined).not.toContain('data:image');
      expect(joined).not.toContain(jpeg.toString('base64'));
      expect(call.cwd.startsWith(os.tmpdir())).toBe(true);
      expect(fs.existsSync(call.cwd)).toBe(false);
    }
    const body = JSON.stringify(result);
    expect(body).not.toContain('session-should-not-be-required');
    expect(body).not.toContain('qa-grok-');
    expect(body).not.toContain('no sessionId');
    expect(body).not.toContain(jpeg.toString('base64'));
    expect(result.ai_requests?.shots).toEqual({});
    const models = result.ai_requests?.calls.map((call) => call.model) ?? [];
    expect(new Set(models)).toEqual(new Set(['grok-4.7']));
    const checks = result.report?.checks ?? [];
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.every((check) => check.status === 'PASS' && check.note === 'ок')).toBe(true);
  });

  it('leaves a mutated messages[0] out of the system file and argv', async () => {
    const marker = 'MARKER40K-END';
    const huge = `${'я'.repeat(40_000)}${marker}`;
    const client = new (class extends GrokBuildAiClient {
      protected override async complete(request: DeepSeekChatRequest) {
        const messages = request.messages as Array<{ content?: unknown }>;
        if (messages[0]) messages[0].content = huge;
        return super.complete(request);
      }
    })(
      grokConfig(),
      async (_command, args) => {
        const { prompt, system } = turnText(args);
        expect(system.startsWith(huge)).toBe(false);
        expect(system).not.toContain(marker);
        expect(system).not.toContain(huge.slice(0, 200));
        expect(system).toContain('начинается с {');
        const joined = args.join('\n');
        expect(joined).not.toContain(marker);
        expect(joined).not.toContain(huge.slice(0, 200));
        expect(args.every((arg) => arg.length < 1000)).toBe(true);
        expect(flagValue(args, '--prompt-file')).toContain('prompt.txt');
        expect(flagValue(args, '--system-prompt-file')).toContain('system.txt');
        return { stdout: jsonAnswer(prompt), code: 0 };
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
    expect((result.report?.checks ?? []).every((check) => check.status === 'PASS')).toBe(true);
  });

  it('runs two category spawns at once, each with its own prompt, and only after vision', async () => {
    let visionDone = false;
    let categoryBeforeVision = false;
    let inFlight = 0;
    let maxInFlight = 0;
    let waiting = 0;
    let openGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const cwds: string[] = [];
    const clobbered: string[] = [];
    const client = new GrokBuildAiClient(
      grokConfig(),
      async (_command, args, options) => {
        const cwd = options.cwd ?? '';
        cwds.push(cwd);
        const { prompt } = turnText(args);
        const categoryMatch = /"category"\s*:\s*(\d+)/.exec(prompt);
        if (!categoryMatch && prompt.includes('"labels"')) {
          await new Promise((resolve) => setTimeout(resolve, 25));
          visionDone = true;
          return { stdout: jsonAnswer(prompt), code: 0 };
        }
        if (!visionDone) categoryBeforeVision = true;
        const promptFile = path.join(cwd, 'prompt.txt');
        const before = fs.readFileSync(promptFile);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        waiting += 1;
        if (waiting === GROK_CATEGORY_CONCURRENCY) openGate();
        await gate;
        const after = fs.readFileSync(promptFile);
        if (!after.equals(before) || after.toString('utf8') !== prompt) clobbered.push(cwd);
        inFlight -= 1;
        return { stdout: jsonAnswer(prompt), code: 0 };
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
    expect(categoryBeforeVision).toBe(false);
    expect(maxInFlight).toBe(GROK_CATEGORY_CONCURRENCY);
    expect(GROK_CATEGORY_CONCURRENCY).toBe(2);
    expect(clobbered).toEqual([]);
    expect(new Set(cwds).size).toBe(cwds.length);
    const parentDir = path.dirname(cwds[0]);
    expect(path.basename(parentDir).startsWith('qa-grok-')).toBe(true);
    for (const cwd of cwds) {
      expect(path.dirname(cwd)).toBe(parentDir);
      expect(fs.existsSync(cwd)).toBe(false);
    }
    expect((result.report?.checks ?? []).every((check) => check.status === 'PASS')).toBe(true);
  });

  it('accepts JSON text when sessionId is absent', async () => {
    const { result } = await reviewWith('grok-4.7', false);
    expect((result.report?.checks ?? []).every((check) => check.status === 'PASS')).toBe(true);
  });

  it('keeps the CLI failure for an empty body, non-JSON, a missing text field, and a non-zero exit', async () => {
    const cases = [
      { stdout: '', stderr: 'Error: max turns reached', code: 1 },
      { stdout: 'Error: max turns reached', stderr: 'Error: max turns reached', code: 1 },
      { stdout: '{"usage":{"input_tokens":1}}', stderr: 'Error: max turns reached', code: 1 },
      { stdout: '{"text":"{}"}', stderr: 'Error: max turns reached', code: 1 },
      { stdout: '{"usage":{"input_tokens":1}}', stderr: 'Not logged in. Run `grok login`.', code: 0 },
    ];
    for (const sample of cases) {
      const client = new GrokBuildAiClient(grokConfig(), async () => sample, () => 'grok');
      const error = await client
        .review({
          name: 'Lander',
          languages: ['ru'],
          countries: ['PL'],
          standUrl: null,
          files: [],
          screenshot: jpeg,
          checkDate: '2026-11-22',
        })
        .then(
          () => null,
          (caught: unknown) => caught,
        );
      expect(error).toBeInstanceOf(AiCallError);
      expect((error as AiCallError).detail).not.toContain('no sessionId');
      expect((error as AiCallError).detail.length).toBeGreaterThan(0);
      if (sample.stderr.includes('max turns')) expect((error as AiCallError).detail).toContain('max turns reached');
      if (sample.stderr.includes('Not logged in')) expect((error as AiCallError).detail).toContain('Not logged in');
    }
  });

  it('turns one failed category spawn into GAP and keeps the other points', async () => {
    const client = new GrokBuildAiClient(
      grokConfig(),
      async (_command, args) => {
        const { prompt } = turnText(args);
        const match = /"category"\s*:\s*(\d+)/.exec(prompt);
        if (match && Number(match[1]) === 4) {
          return { stdout: '', stderr: 'Error: max turns reached', code: 1 };
        }
        return { stdout: jsonAnswer(prompt), code: 0 };
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
    expect(checks).toHaveLength(11);
    expect(checks.find((check) => check.category === 4)).toEqual({ category: 4, status: 'GAP', note: GAP_NOTE });
    expect(checks.filter((check) => check.category !== 4).every((check) => check.status === 'PASS' && check.note === 'ок')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('max turns reached');
  });

  it('says the binary is missing instead of no sessionId', async () => {
    const client = new GrokBuildAiClient(grokConfig(), async () => ({ stdout: '', code: 0 }), () => null);
    const error = await client
      .review({
        name: 'Lander',
        languages: ['ru'],
        countries: ['PL'],
        standUrl: null,
        files: [],
        screenshot: jpeg,
        checkDate: '2026-11-22',
      })
      .then(
        () => null,
        (caught: unknown) => caught,
      );
    expect(error).toBeInstanceOf(AiCallError);
    expect((error as AiCallError).detail).toBe('Grok Build не найден.');
  });

  it('lets GROK_MODEL replace the slug and still omits --resume', async () => {
    const { seen } = await reviewWith('grok-custom', true);
    expect(seen.length).toBeGreaterThan(1);
    for (const call of seen) {
      expect(call.args[call.args.indexOf('-m') + 1]).toBe('grok-custom');
      expect(call.args).not.toContain('--resume');
    }
  });

  it('keeps a short exit code and one stderr line, and drops argv, prompts, and tokens', () => {
    const sandbox = grokLogHint(1, 'error: bwrap exec failed: No such file or directory (os error 2).\nsecond line stays out');
    expect(sandbox).toBe('exit 1: error: bwrap exec failed: No such file or directory (os error 2).');
    expect(sandbox).not.toContain('second line');
    const leaked = grokLogHint(2, '-p do not log this prompt --system-prompt-override secret sk-supersecretvalue1234567890abcdef');
    expect(leaked).toBe('exit 2');
    const redacted = grokLogHint(3, 'error: auth failed sk-supersecretvalue1234567890abcdef');
    expect(redacted.startsWith('exit 3:')).toBe(true);
    expect(redacted).toContain('[redacted]');
    expect(redacted).not.toContain('sk-super');
    expect(grokLogHint(null, '')).toBe('');
    const sandboxWarning =
      "warning: sandbox could not be applied: this build has no sandbox enforcement for this platform. The 'read-only' profile is not in effect.";
    expect(grokLogHint(null, sandboxWarning)).toBe('');
    expect(grokLogHint(null, `${sandboxWarning}\nError: max turns reached`)).toBe('timeout: Error: max turns reached');
  });

  const sandboxWarning =
    "warning: sandbox could not be applied: this build has no sandbox enforcement for this platform. The 'read-only' profile is not in effect.";

  it('reports timeout when the timer kills a process that only warned about the sandbox', async () => {
    const client = new GrokBuildAiClient(
      grokConfig(),
      async () => ({ stdout: '', stderr: sandboxWarning, code: null }),
      () => 'grok',
    );
    const error = await client
      .review({
        name: 'Lander',
        languages: ['ru'],
        countries: ['PL'],
        standUrl: null,
        files: [],
        screenshot: jpeg,
        checkDate: '2026-11-22',
      })
      .then(
        () => null,
        (caught: unknown) => caught,
      );
    expect(error).toBeInstanceOf(AiCallError);
    expect((error as AiCallError).detail).toBe('timeout');
  });

  it('accepts a zero exit with text when stderr is only the sandbox warning', async () => {
    const client = new GrokBuildAiClient(
      grokConfig(),
      async (_command, args) => ({
        stdout: jsonAnswer(turnText(args).prompt),
        stderr: sandboxWarning,
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
    expect((result.report?.checks ?? []).every((check) => check.status === 'PASS')).toBe(true);
  });
});

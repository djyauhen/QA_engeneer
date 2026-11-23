import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { GrokProbe, GROK_PROBE } from './ai-profile';

const CODE = /^[A-Z0-9]{4,8}(?:-[A-Z0-9]{4,8}){0,2}$/;
const LOGIN_ARGS = ['login', '--device-auth'] as const;
const CODE_WAIT_MS = 20_000;

export function readDevicePrompt(text: string): { url: string; code: string } | null {
  const fromJson = readJsonPrompt(text);
  if (fromJson) return fromJson;
  const url = firstHttps(text);
  const labeled = text.match(/\b(?:user[_\s-]?code|code)\b\s*[:=]?\s*([A-Za-z0-9-]{4,16})/i);
  const code = labeled ? normalizeCode(labeled[1]) : null;
  if (!url || !code) return null;
  return { url, code };
}

@Injectable()
export class GrokLoginService {
  private pending: Promise<{ url: string; code: string }> | null = null;

  constructor(@Inject(GROK_PROBE) private readonly probe: GrokProbe) {}

  status(): { connected: boolean } {
    return { connected: this.probe.session() };
  }

  begin(): Promise<{ url: string; code: string }> {
    const command = this.probe.command();
    if (!command) {
      throw new BadRequestException({ error: 'Некорректный запрос', message: 'Grok Build не найден.' });
    }
    if (!this.pending) this.pending = this.listen(command);
    return this.pending;
  }

  async logout(): Promise<{ ok: true }> {
    const command = this.probe.command();
    if (!command) {
      throw new BadRequestException({ error: 'Некорректный запрос', message: 'Grok Build не найден.' });
    }
    try {
      await this.probe.spawn(command, ['logout'], { timeoutMs: 30_000 });
    } catch {
      throw new BadRequestException({ error: 'Некорректный запрос', message: 'Не удалось отключить Grok Build.' });
    }
    this.pending = null;
    return { ok: true };
  }

  private listen(command: string): Promise<{ url: string; code: string }> {
    return new Promise((resolve, reject) => {
      let buffer = '';
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new BadRequestException({ error: 'Некорректный запрос', message: 'Не удалось начать вход.' }));
      }, CODE_WAIT_MS);
      timer.unref?.();
      const finish = (result: { url: string; code: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        buffer = '';
        resolve(result);
      };
      const fail = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        buffer = '';
        reject(new BadRequestException({ error: 'Некорректный запрос', message: 'Не удалось начать вход.' }));
      };
      this.probe
        .spawnLogin(command, LOGIN_ARGS, (chunk) => {
          if (settled) return;
          buffer = `${buffer}${chunk}`.slice(-4000);
          const found = readDevicePrompt(buffer);
          if (!found) return;
          finish(found);
        })
        .then(
          () => {
            if (!settled) fail();
            this.pending = null;
          },
          () => {
            if (!settled) fail();
            this.pending = null;
          },
        );
    });
  }
}

function readJsonPrompt(text: string): { url: string; code: string } | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const url = firstHttps(parsed.verification_uri ?? parsed.verification_url ?? parsed.url);
    const raw = typeof parsed.user_code === 'string' ? parsed.user_code : typeof parsed.code === 'string' ? parsed.code : '';
    const code = normalizeCode(raw);
    if (url && code) return { url, code };
  } catch {
    return null;
  }
  return null;
}

function normalizeCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  if (!code || code.length > 16 || !CODE.test(code)) return null;
  return code;
}

function firstHttps(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/https:\/\/[^\s"'<>]+/i);
  if (!match) return null;
  const url = match[0].replace(/[),.;]+$/, '');
  if (/access_token|refresh_token|id_token|token=/i.test(url)) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

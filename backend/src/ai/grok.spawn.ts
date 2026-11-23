import { spawn } from 'child_process';
import fs from 'fs';
import { CATEGORY_TIMEOUT_MS } from './ai.client';

export interface GrokSpawnResult {
  stdout: string;
  code: number | null;
  /** Present for checklist calls. Login streaming does not keep a copy. */
  stderr?: string;
}

export type GrokSpawn = (
  command: string,
  args: readonly string[],
  options: { cwd?: string; timeoutMs?: number },
) => Promise<GrokSpawnResult>;

export type GrokLoginSpawn = (
  command: string,
  args: readonly string[],
  emit: (text: string) => void,
) => Promise<number | null>;

const STDOUT_CAP = 2_000_000;
const STDERR_CAP = 8_000;
const LOG_LINE_MAX = 180;
const LOGIN_TIMEOUT_MS = 300_000;
const ARGV_OR_PROMPT = /(?:^|\s)(?:-p|--system-prompt(?:-override)?|--disallowed-tools|--cwd)\b|"prompt"\s*:|data:image\//i;
const SECRET = /\b(?:sk|xai|tok)[-_][A-Za-z0-9_-]{8,}\b|\bBearer\s+\S+|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}\b|\b[A-Za-z0-9_-]{40,}\b/gi;

/**
 * Short exit label plus at most one stderr line.
 * Drops argv, prompt echoes, and token-shaped strings before anything is logged.
 */
export function grokLogHint(code: number | null, stderr: string): string {
  const line = safeStderrLine(stderr);
  if (code == null) return line ? `timeout: ${line}` : '';
  return line ? `exit ${code}: ${line}` : `exit ${code}`;
}

function safeStderrLine(stderr: string): string {
  const lines = stderr.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!line || line.length > 400 || ARGV_OR_PROMPT.test(line)) continue;
    const redacted = line.replace(SECRET, '[redacted]').trim();
    if (!redacted || ARGV_OR_PROMPT.test(redacted)) continue;
    return redacted.length > LOG_LINE_MAX ? `${redacted.slice(0, LOG_LINE_MAX - 1)}…` : redacted;
  }
  return '';
}

/**
 * File-edit and shell ids, plus the search and monitor ids that burned the turn
 * budget before any JSON existed. read_file stays: an @mention sends the path,
 * and the model reads JPEG bytes with that tool. Web tools are already off via --disable-web-search.
 */
export const GROK_DISALLOWED_TOOLS = 'run_terminal_cmd,search_replace,write,grep,monitor';

/** One Grok-only line. The shared checklist prompt stays untouched. */
const JSON_ONLY_LINE =
  'Видимый ответ — ровно один JSON-объект, он начинается с {, без предложения перед ним и без пересказа вызовов инструментов.';

export function grokArgv(input: {
  prompt: string;
  model: string;
  cwd: string;
  system: string;
  resume?: string | null;
}): string[] {
  const args = [
    '--no-auto-update',
    '-p',
    input.prompt,
    '-m',
    input.model,
    '--output-format',
    'json',
    '--max-turns',
    '4',
    '--no-plan',
    '--no-subagents',
    '--disable-web-search',
    '--cwd',
    input.cwd,
    '--system-prompt-override',
    input.resume ? JSON_ONLY_LINE : `${input.system}\n${JSON_ONLY_LINE}`,
    '--disallowed-tools',
    GROK_DISALLOWED_TOOLS,
    '--sandbox',
    'read-only',
  ];
  if (input.resume) args.push('--resume', input.resume);
  return args;
}

export function readGrokResult(stdout: string): {
  content: string;
  usage: Record<string, unknown> | null;
  sessionId: string | null;
} {
  const trimmed = stdout.trim();
  if (!trimmed) return { content: '', usage: null, sessionId: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new SyntaxError('invalid_json');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new SyntaxError('invalid_json');
  const record = parsed as { text?: unknown; usage?: unknown; sessionId?: unknown };
  const content = typeof record.text === 'string' ? checklistObjectText(record.text) : '';
  const sessionId = typeof record.sessionId === 'string' && record.sessionId.trim() ? record.sessionId.trim() : null;
  return { content, usage: numericUsage(record.usage), sessionId };
}

/**
 * Visible CLI text is the concatenated agent messages. A checklist answer is the
 * last complete top-level object when the string ends with it. A pure object is
 * that same case. Prose, a bare array, or an object buried in a log stays unchanged
 * so the caller still rejects it.
 */
export function checklistObjectText(text: string): string {
  const source = text.trim();
  if (!source) return text;
  let start = source.lastIndexOf('{');
  while (start >= 0) {
    const end = endOfJsonObject(source, start);
    if (end > start && trailingFenceOnly(source.slice(end))) {
      const slice = source.slice(start, end);
      try {
        const parsed: unknown = JSON.parse(slice);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return slice;
      } catch {
        // A brace in prose or an unfinished object. Try the previous one.
      }
    }
    start = start === 0 ? -1 : source.lastIndexOf('{', start - 1);
  }
  return text;
}

function trailingFenceOnly(rest: string): boolean {
  const trimmed = rest.trim();
  return trimmed === '' || trimmed === '```';
}

function endOfJsonObject(source: string, start: number): number {
  if (source[start] !== '{') return -1;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\') {
        escape = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

function numericUsage(usage: unknown): Record<string, unknown> | null {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(usage)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

export const spawnGrok: GrokSpawn = (command, args, options) =>
  runProcess(command, args, {
    cwd: options.cwd,
    timeoutMs: options.timeoutMs ?? CATEGORY_TIMEOUT_MS,
    onText: null,
  });

export const spawnGrokLogin: GrokLoginSpawn = (command, args, emit) =>
  runProcess(command, args, { timeoutMs: LOGIN_TIMEOUT_MS, onText: emit }).then((result) => result.code);

/** Windows cannot spawn a `#!/usr/bin/env node` entry. The native binary has no shebang and is spawned as-is. */
function nodeShebang(command: string): boolean {
  let fd: number | null = null;
  try {
    fd = fs.openSync(command, 'r');
    const buf = Buffer.alloc(128);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const text = buf.subarray(0, n).toString('utf8');
    if (!text.startsWith('#!')) return false;
    return /\bnode\b/.test(text.split(/\r?\n/, 1)[0]);
  } catch {
    return false;
  } finally {
    if (fd != null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

function runProcess(
  command: string,
  args: readonly string[],
  options: { cwd?: string; timeoutMs: number; onText: ((text: string) => void) | null },
): Promise<GrokSpawnResult> {
  const viaNode = nodeShebang(command);
  const file = viaNode ? process.execPath : command;
  const argv = viaNode ? [command, ...args] : [...args];
  return new Promise((resolve, reject) => {
    const child = spawn(file, argv, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let size = 0;
    let stderrSize = 0;
    const take = (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      if (options.onText) {
        options.onText(text);
        return;
      }
      size += chunk.length;
      if (size <= STDOUT_CAP) chunks.push(chunk);
    };
    child.stdout?.on('data', take);
    child.stderr?.on('data', (chunk: Buffer) => {
      if (options.onText) {
        options.onText(chunk.toString('utf8'));
        return;
      }
      if (stderrSize >= STDERR_CAP) return;
      const slice = chunk.subarray(0, STDERR_CAP - stderrSize);
      stderrSize += slice.length;
      stderrChunks.push(slice);
    });
    const timer = setTimeout(() => {
      child.kill();
    }, options.timeoutMs);
    timer.unref?.();
    const fail = () => {
      clearTimeout(timer);
      const error = new Error('spawn');
      error.name = 'GrokCallError';
      reject(error);
    };
    child.on('error', fail);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        stdout: options.onText ? '' : Buffer.concat(chunks).toString('utf8'),
        stderr: options.onText ? undefined : Buffer.concat(stderrChunks).toString('utf8'),
        code,
      });
    });
  });
}

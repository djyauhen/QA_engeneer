import { spawn } from 'child_process';
import fs from 'fs';

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
/** One Grok Build process. Longer than the DeepSeek HTTP timeout: frames plus a large prompt file. */
export const GROK_SPAWN_TIMEOUT_MS = 300_000;
/**
 * Checklist points use the same budget DeepSeek sends (`reasoning_effort: low`).
 * The CLI default is high: one point then spends minutes inside a single turn.
 * The eye pass is the only call that has to read faces and text on pixels, so it
 * stays above low. High on that pass alone was several minutes; medium is the next step.
 */
export const GROK_REASONING_EFFORT = 'low';
export const GROK_VISION_REASONING_EFFORT = 'medium';
/** One read of the frames, then the JSON. A spare turn covers a tool the denylist still rejects. */
export const GROK_VISION_MAX_TURNS = '4';
/** A checklist point answers from page_text and visual_observations. No second look at the files. */
export const GROK_CATEGORY_MAX_TURNS = '2';
const ARGV_OR_PROMPT = /(?:^|\s)(?:-p|--system-prompt(?:-override)?|--disallowed-tools|--cwd)\b|"prompt"\s*:|data:image\//i;
const SANDBOX_NOISE = /sandbox could not be applied|profile is not in effect/i;
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
    if (!line || line.length > 400 || ARGV_OR_PROMPT.test(line) || SANDBOX_NOISE.test(line)) continue;
    const redacted = line.replace(SECRET, '[redacted]').trim();
    if (!redacted || ARGV_OR_PROMPT.test(redacted)) continue;
    return redacted.length > LOG_LINE_MAX ? `${redacted.slice(0, LOG_LINE_MAX - 1)}…` : redacted;
  }
  return '';
}

/**
 * Tools that burned a turn before any JSON existed: directory listing, search,
 * workflows, and image generation. read_file stays on the eye pass only.
 * An @mention is a path; JPEG pixels arrive when that tool reads the file.
 * Checklist points do not get read_file: they judge visual_observations.
 * Web tools are already off via --disable-web-search.
 */
export const GROK_DISALLOWED_TOOLS =
  'run_terminal_cmd,search_replace,write,grep,monitor,list_dir,search_tool,workflow,image_gen,image_edit,image_to_video,reference_to_video,ask_user_question,todo_write,enter_plan_mode,exit_plan_mode,web_search,web_fetch,task';
export const GROK_CATEGORY_DISALLOWED_TOOLS = `${GROK_DISALLOWED_TOOLS},read_file`;

/** One Grok-only line. The shared checklist prompt stays untouched. */
const JSON_ONLY_LINE =
  'Видимый ответ — ровно один JSON-объект, он начинается с { и заканчивается на }. После } ничего нет. Перед объектом не пиши предложения и не пересказывай вызовы инструментов.';

/** System file body: the checklist system plus the JSON-only line. Never an argv string. */
export function grokSystemFileText(system: string): string {
  return `${system}\n${JSON_ONLY_LINE}`;
}

/**
 * One-shot argv. `--prompt-file` is itself a single-turn headless prompt (same mode as
 * `-p` / `--single`). A bare `-p` with no text reads stdin, so it is not passed and the
 * next flag cannot be swallowed as PROMPT. Prompt and system text stay in files:
 * Windows CreateProcess rejects a command line near 32KB.
 */
export function grokArgv(input: {
  promptFile: string;
  model: string;
  cwd: string;
  systemFile: string;
  reasoningEffort?: string;
  maxTurns?: string;
  disallowedTools?: string;
}): string[] {
  const args = [
    '--no-auto-update',
    '--prompt-file',
    input.promptFile,
    '-m',
    input.model,
    '--reasoning-effort',
    input.reasoningEffort ?? GROK_REASONING_EFFORT,
    '--output-format',
    'json',
    '--max-turns',
    input.maxTurns ?? GROK_CATEGORY_MAX_TURNS,
    '--no-plan',
    '--no-subagents',
    '--disable-web-search',
    '--cwd',
    input.cwd,
    '--system-prompt-file',
    input.systemFile,
    '--disallowed-tools',
    input.disallowedTools ?? GROK_DISALLOWED_TOOLS,
  ];
  // This Windows build prints a warning and does not enforce the profile.
  if (process.platform !== 'win32') args.push('--sandbox', 'read-only');
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

/** Error-object message first, so a headless failure is not hidden behind a partial `text`. */
export function errorMessageThenStderr(stdout: string, stderr: string): string {
  const message = jsonErrorMessage(stdout);
  if (!message) return stderr;
  return `${message}\n${stderr}`;
}

function jsonErrorMessage(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) return '';
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '';
    const record = parsed as { type?: unknown; message?: unknown };
    if (record.type !== 'error' || typeof record.message !== 'string') return '';
    return record.message;
  } catch {
    return '';
  }
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
    timeoutMs: options.timeoutMs ?? GROK_SPAWN_TIMEOUT_MS,
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

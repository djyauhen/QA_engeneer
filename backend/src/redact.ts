const URL_WITH_SECRET = /https?:\/\/[^\s"'<>]+/gi;

export function redact(text: string): string {
  return text
    .replace(/([?&]token=)[^&\s]+/gi, '$1<redacted>')
    .replace(/([?&]signature=)[^&\s]+/gi, '$1<redacted>')
    .replace(/("password"\s*:\s*")[^"]*(")/gi, '$1<redacted>$2')
    .replace(URL_WITH_SECRET, (url) => {
      if (/signature=|expires=|[?&]token=/i.test(url)) return '<redacted-url>';
      return url;
    });
}

export function redactSecrets(text: string, secrets: string[]): string {
  let out = redact(text);
  for (const secret of secrets) {
    if (secret && secret.length >= 8) {
      out = out.split(secret).join('<redacted>');
    }
  }
  return out;
}

const BANNED_KEYS = new Set([
  'stand_url',
  'preview_image',
  'token',
  'password',
  'password_hash',
  'overall_status',
  'verdict',
  'signed_url',
  'download_url',
  'aio_token',
  'comparison_verdict',
]);

export function sanitizeReport<T>(value: T): T {
  return walk(value) as T;
}

function walk(value: unknown): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (Array.isArray(value)) return value.map((item) => walk(item));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (BANNED_KEYS.has(key)) continue;
      out[key] = walk(nested);
    }
    return out;
  }
  return value;
}

function scrubString(value: string): string {
  if (!/https?:\/\//i.test(value)) return value;
  return value.replace(URL_WITH_SECRET, (url) => {
    if (/signature=|expires=|[?&]token=/i.test(url)) return '[ссылка скрыта]';
    return url;
  });
}

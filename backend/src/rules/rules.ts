export interface AdminRules {
  allowed_external_prefixes: string[];
  forbidden_macros: string[];
  forbidden_script_markers: string[];
  image_warning_kb: number;
  image_failed_kb: number;
  css_ok_kb: number;
  css_failed_kb: number;
  inline_script_max_nonempty_lines: number;
  expectFormMacro: boolean;
  languages_override: string[];
}

export const RULE_KEYS: Array<keyof AdminRules> = [
  'allowed_external_prefixes',
  'forbidden_macros',
  'forbidden_script_markers',
  'image_warning_kb',
  'image_failed_kb',
  'css_ok_kb',
  'css_failed_kb',
  'inline_script_max_nonempty_lines',
  'expectFormMacro',
  'languages_override',
];

const STRING_LIST_KEYS = new Set<keyof AdminRules>([
  'allowed_external_prefixes',
  'forbidden_macros',
  'forbidden_script_markers',
  'languages_override',
]);

const NUMBER_KEYS = new Set<keyof AdminRules>([
  'image_warning_kb',
  'image_failed_kb',
  'css_ok_kb',
  'css_failed_kb',
  'inline_script_max_nonempty_lines',
]);

export function defaultRules(): AdminRules {
  return {
    allowed_external_prefixes: [
      'http://www.w3.org/2000/svg',
      'http://www.w3.org/1999/xlink',
      'https://fonts.googleapis.com',
      'https://fonts.gstatic.com',
      'https://code.jquery.com',
      'https://ajax.googleapis.com',
      'https://cdn.jsdelivr.net',
      'https://scripts.converteai.net',
      'https://images.converteai.net',
    ],
    forbidden_macros: ['{offer}', '{_offer_value:brand_name}', '{_fbclid}'],
    forbidden_script_markers: [
      'imgsec.svg',
      'secimg.svg',
      'sec-img.svg',
      'sec_img.svg',
      '<object',
      '<iframe',
      '<noscript',
      '<form',
      'onload=',
      'base64,',
      'atob',
    ],
    image_warning_kb: 100,
    image_failed_kb: 200,
    css_ok_kb: 50,
    css_failed_kb: 150,
    inline_script_max_nonempty_lines: 10,
    expectFormMacro: true,
    languages_override: [],
  };
}

export function cloneRules(rules: AdminRules): AdminRules {
  return {
    ...rules,
    allowed_external_prefixes: [...rules.allowed_external_prefixes],
    forbidden_macros: [...rules.forbidden_macros],
    forbidden_script_markers: [...rules.forbidden_script_markers],
    languages_override: [...rules.languages_override],
  };
}

export class RulesValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RulesValidationError';
  }
}

export function mergeRules(current: AdminRules, body: unknown): AdminRules {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new RulesValidationError('Некорректный запрос');
  }
  const input = body as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!RULE_KEYS.includes(key as keyof AdminRules)) {
      throw new RulesValidationError('Неизвестный параметр конфигурации');
    }
  }
  const next = cloneRules(current);
  for (const key of RULE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const value = input[key];
    if (STRING_LIST_KEYS.has(key)) {
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        throw new RulesValidationError('Некорректный параметр конфигурации');
      }
      (next[key] as string[]) = [...value];
      continue;
    }
    if (NUMBER_KEYS.has(key)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new RulesValidationError('Некорректный параметр конфигурации');
      }
      if (key === 'inline_script_max_nonempty_lines' && !Number.isInteger(value)) {
        throw new RulesValidationError('Некорректный параметр конфигурации');
      }
      (next[key] as number) = value;
      continue;
    }
    if (key === 'expectFormMacro') {
      if (typeof value !== 'boolean') {
        throw new RulesValidationError('Некорректный параметр конфигурации');
      }
      next.expectFormMacro = value;
    }
  }
  return next;
}

/**
 * Open question in the TZ: replace vs append. A non-empty override replaces
 * the lander languages. An empty override keeps the catalog languages.
 */
export function effectiveLanguages(cardLanguages: string[], rules: AdminRules): string[] {
  if (rules.languages_override.length > 0) return [...rules.languages_override];
  return [...cardLanguages];
}

export function retentionCutoff(now: Date): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setMonth(cutoff.getMonth() - 3);
  return cutoff;
}

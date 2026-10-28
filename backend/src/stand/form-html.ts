/** International dial code for the stand lead form. Unknown countries stay unmapped. */
const DIAL_BOOK: ReadonlyArray<{ code: string; names: readonly string[] }> = [
  {
    code: '+31',
    names: ['nl', 'nld', 'netherlands', 'the netherlands', 'holland', 'nederland', 'nederlanden', 'нидерланды', 'нидерландов', 'голландия'],
  },
  { code: '+49', names: ['de', 'deu', 'germany', 'deutschland', 'германия', 'германии'] },
  { code: '+33', names: ['fr', 'fra', 'france', 'frankreich', 'франция', 'франции'] },
  { code: '+48', names: ['pl', 'pol', 'poland', 'polska', 'польша', 'польши'] },
  {
    code: '+44',
    names: ['gb', 'gbr', 'uk', 'united kingdom', 'great britain', 'britain', 'england', 'великобритания', 'великобритании'],
  },
  { code: '+41', names: ['ch', 'che', 'switzerland', 'schweiz', 'suisse', 'svizzera', 'швейцария', 'швейцарии'] },
  { code: '+1', names: ['us', 'usa', 'united states', 'united states of america', 'сша', 'ca', 'can', 'canada', 'канада'] },
  { code: '+34', names: ['es', 'esp', 'spain', 'españa', 'espana', 'испания'] },
  { code: '+39', names: ['it', 'ita', 'italy', 'italia', 'италия'] },
  { code: '+46', names: ['se', 'swe', 'sweden', 'sverige', 'швеция'] },
  { code: '+47', names: ['no', 'nor', 'norway', 'norge', 'норвегия'] },
  { code: '+45', names: ['dk', 'dnk', 'denmark', 'danmark', 'дания'] },
];

const DIAL_ENTRIES: ReadonlyArray<{ code: string; name: string }> = DIAL_BOOK.flatMap((row) =>
  row.names.map((name) => ({ code: row.code, name })),
);

/** Left blank when the card country cannot be mapped. Not a dial code. */
export const UNMAPPED_DIAL = '';

export function dialCodeForCountries(countries: readonly string[]): string | null {
  for (const country of countries) {
    if (typeof country !== 'string') continue;
    const code = dialCodeForCountry(country);
    if (code) return code;
  }
  return null;
}

export function standFormHtml(countries: readonly string[]): string {
  const dial = dialCodeForCountries(countries) ?? UNMAPPED_DIAL;
  return `<form data-stand-form="1"><label for="stand-phone">Tel</label> <span data-stand-dial>${dial}</span> <input id="stand-phone" type="tel" name="phone" autocomplete="tel"></form>`;
}

/** Previous defaults. They are not an explicit custom form. */
const LEGACY_EMPTY_FORM = '<div data-stand-form="1"></div>';
const LEGACY_PLACEHOLDER_FORM =
  '<form data-stand-form="1"><label for="stand-phone">Tel</label> <span data-stand-dial>+…</span> <input id="stand-phone" type="tel" name="phone" autocomplete="tel"></form>';

function isBuiltinStandForm(configured: string): boolean {
  const trimmed = configured.trim();
  return !trimmed || trimmed === LEGACY_EMPTY_FORM || trimmed === LEGACY_PLACEHOLDER_FORM || trimmed === standFormHtml([]);
}

/**
 * Empty, the old empty div, and the built-in phone form stay the built-in form.
 * Any other STAND_FORM_HTML is kept as an explicit override.
 */
export function configuredStandFormHtml(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim();
  if (isBuiltinStandForm(trimmed)) return standFormHtml([]);
  return trimmed;
}

/** An explicit STAND_FORM_HTML wins. The built-in default is specialized from the card countries. */
export function resolveStandFormHtml(configured: string, countries: readonly string[]): string {
  if (isBuiltinStandForm(configured)) return standFormHtml(countries);
  return configured;
}

function dialCodeForCountry(raw: string): string | null {
  const norm = raw
    .trim()
    .toLowerCase()
    .replace(/[_|/]+/g, ' ')
    .replace(/\s+/g, ' ');
  if (!norm) return null;
  let best: { code: string; at: number; length: number } | null = null;
  for (const entry of DIAL_ENTRIES) {
    const at = indexOfName(norm, entry.name);
    if (at < 0) continue;
    if (!best || at < best.at || (at === best.at && entry.name.length > best.length)) {
      best = { code: entry.code, at, length: entry.name.length };
    }
  }
  return best?.code ?? null;
}

function indexOfName(text: string, name: string): number {
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, 'u');
  const match = re.exec(text);
  return match ? match.index : -1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

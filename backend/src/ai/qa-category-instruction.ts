import { QA_CATEGORY_TITLES, categorySystemPrompt } from './qa-categories';
import { QA_INSTRUCTION } from './qa-instruction';

/**
 * One checklist call gets only its own excerpt of QA_INSTRUCTION, then its own category prompt.
 * Sections are sliced from that string so the wording stays the document's.
 */

const SECTION_OF_CATEGORY: Record<number, number> = {
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 5,
  7: 6,
  8: 7,
  9: 8,
  10: 9,
  11: 10,
};

const OUTLET_WEB = 'Если доступен интернет, найди официальный сайт соответствующего издания.';
const OUTLET_FRAMES =
  'Кадров оригинала в этом вызове может не быть. Если outlet_header или outlet_footer не приложены, укажи «Не удалось проверить» и не ставь ошибку. Сайт из этого вызова не открывается.';
const OPEN_SOURCES = 'проверь по надёжным открытым источникам';

const BROWSE_ASKS = [
  'используй интернет',
  'найди официальный сайт',
  'открой сайт',
  'по надёжным открытым источникам',
  'Если доступен интернет',
  'web_search',
];

interface InstructionSection {
  number: number;
  titleLine: string;
  body: string;
}

const SECTION_HEADER = /^={10,}\n(\d+)\. ([^\n]+)\n={10,}\n/gm;

let parsed: Map<number, InstructionSection> | null = null;

function instructionSections(): Map<number, InstructionSection> {
  if (parsed) return parsed;
  const matches = [...QA_INSTRUCTION.matchAll(SECTION_HEADER)];
  if (matches.length !== 14) throw new Error(`expected 14 instruction sections, got ${matches.length}`);
  const sections = new Map<number, InstructionSection>();
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index;
    const next = matches[index + 1]?.index;
    if (start === undefined) throw new Error('instruction header has no index');
    const block = QA_INSTRUCTION.slice(start, next ?? QA_INSTRUCTION.length).trim();
    const headingEnd = block.indexOf('\n\n');
    const titleLine = block.slice(0, headingEnd).split('\n').find((line) => /^\d+\. /.test(line));
    if (headingEnd < 0 || !titleLine) throw new Error(`instruction section ${match[1]} has no title`);
    sections.set(Number(match[1]), {
      number: Number(match[1]),
      titleLine,
      body: block.slice(headingEnd).trim(),
    });
  }
  parsed = sections;
  return sections;
}

function section(number: number): InstructionSection {
  const found = instructionSections().get(number);
  if (!found) throw new Error(`instruction section ${number} missing`);
  return found;
}

function replaceOnce(text: string, from: string, to: string, label: string): string {
  const at = text.indexOf(from);
  if (at < 0) throw new Error(`${label} missing`);
  if (text.indexOf(from, at + from.length) >= 0) throw new Error(`${label} is not unique`);
  return text.slice(0, at) + to + text.slice(at + from.length);
}

const AMOUNT_RATE_SENTENCES =
  'Для проверки используй актуальный валютный курс.\n\nПереведи указанную сумму в USD и сравни с допустимыми диапазонами.';
const AMOUNT_FX_RULE =
  'fx_rates.rates[код] — сколько единиц валюты даёт 1 USD на fx_rates.date. Эквивалент = локальная сумма / rates[код]. Нет fx_rates или нет кода валюты в rates — N/A. Свой курс не подставляй и приближение не выдавай за расчёт.';

function depositSlice(part: 'currency' | 'amount'): string {
  const body = section(5).body;
  const currencyAt = body.indexOf('УСЛОВИЕ №1: ВАЛЮТА');
  const amountAt = body.indexOf('УСЛОВИЕ №2: СУММА');
  if (currencyAt < 0 || amountAt <= currencyAt) throw new Error('deposit condition markers missing');
  const currency = body.slice(currencyAt, amountAt).trim();
  const amount = body.slice(amountAt).trim();
  if (currency.includes('Найди все упоминания минимального депозита') || amount.includes('Найди все упоминания минимального депозита')) {
    throw new Error('deposit slice includes the shared intro');
  }
  if (currency.includes('УСЛОВИЕ №2')) throw new Error('currency slice includes condition 2');
  if (amount.includes('УСЛОВИЕ №1: ВАЛЮТА')) throw new Error('amount slice includes condition 1');
  if (part === 'currency') return currency;
  const withFx = replaceOnce(amount, AMOUNT_RATE_SENTENCES, AMOUNT_FX_RULE, 'amount fx sentences');
  const withMissingRate = replaceOnce(
    withFx,
    'Если актуальный курс недоступен, не выдавай приблизительный расчёт за точный.',
    'Нет fx_rates или нет кода валюты в rates — N/A. Приблизительный расчёт не подставляй.',
    'amount missing rate',
  );
  return replaceOnce(
    withMissingRate,
    'Эквивалент: приблизительно XXX USD.',
    'Эквивалент: локальная сумма / fx_rates.rates[код] USD.',
    'amount equivalent line',
  );
}

function ownSection(category: number): string {
  if (category === 5) return depositSlice('currency');
  if (category === 6) return depositSlice('amount');
  const sectionNumber = SECTION_OF_CATEGORY[category];
  if (!sectionNumber) throw new Error(`unknown category ${category}`);
  const found = section(sectionNumber);
  let body = found.body;
  if (category === 2) body = replaceOnce(body, OUTLET_WEB, OUTLET_FRAMES, 'outlet web sentence');
  if (category === 3) body = replaceOnce(body, OPEN_SOURCES, 'fact_sheet.person', 'open-sources phrase');
  return `${found.titleLine}\n\n${body}`;
}

function assertNoBrowseAsk(text: string, category: number): void {
  for (const phrase of BROWSE_ASKS) {
    if (text.includes(phrase)) throw new Error(`category ${category} instruction still asks to browse: ${phrase}`);
  }
}

export function categoryInstruction(category: number): string {
  const title = QA_CATEGORY_TITLES[category];
  if (!title) throw new Error(`unknown category ${category}`);
  const text = [
    'ИНСТРУКЦИЯ',
    `Этот вызов проверяет только пункт ${category}. ${title}. Другие пункты чеклиста не выполняй.`,
    ownSection(category),
  ].join('\n\n');
  assertNoBrowseAsk(text, category);
  return text;
}

export function categorySystemMessage(category: number): string {
  return `${categoryInstruction(category)}\n\nПРОМПТ\n\n${categorySystemPrompt(category)}`;
}

/** Grok system file for one category. The category prompt stays in the user message. */
export function grokCategorySystem(category: number): string {
  return `${categoryInstruction(category)}\n\nОшибки фиксируй только полями JSON из блока пользователя «Ответ пункта». Прозу чеклиста и разделы «ОБЩАЯ ИНФОРМАЦИЯ» и «РЕЗУЛЬТАТЫ ПРОВЕРКИ» не пиши. Фразу «Не удалось проверить» не пиши: это статус N/A и объяснение в note.`;
}

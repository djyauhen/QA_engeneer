import { AiCheck, AiFinding, AiGeneral } from '../reports/report.types';
import { DESKTOP_SHOT } from '../stand/capture';
import { CommentAvatarOccurrence } from './materials';
import { LANDING_FOOTER_REF, OUTLET_FOOTER_REF, OUTLET_HEADER_REF } from './outlets';
import {
  CorrespondenceImage,
  QaParseResult,
  QaReportFields,
  enforceCommentAvatars,
  enforceImageCorrespondence,
} from './qa-response';

export const QA_CATEGORY_COUNT = 11;

/** Header/footer, the main person, comment avatars, and text on pictures. */
export const VISION_CATEGORIES = [2, 3, 9, 10] as const;

export const QA_CATEGORY_TITLES: Record<number, string> = {
  1: 'GEO и локализация',
  2: 'Соответствие шапки и футера оригиналу',
  3: 'Данные главного персонажа',
  4: 'Соответствие персонажа GEO',
  5: 'Валюта минимального депозита',
  6: 'Размер минимального депозита',
  7: 'Единство оффера',
  8: 'Актуальность дат',
  9: 'Комментарии',
  10: 'Внутренняя согласованность контента',
  11: 'Телефонный код формы',
};

/** A failed or empty category call. Not PASS, and not a content N/A. */
export const GAP_NOTE = 'Проверка не выполнена: сбой вызова. Пункт не закрыт.';

const GENERAL_KEYS = ['geo', 'language', 'outlet', 'main_person', 'offer', 'currency', 'min_deposit'] as const;

const GENERAL_BY_CATEGORY: Record<number, Array<(typeof GENERAL_KEYS)[number]>> = {
  1: ['geo', 'language'],
  2: ['outlet'],
  3: ['main_person'],
  5: ['currency'],
  6: ['min_deposit'],
  7: ['offer'],
};

/**
 * Chat completions on the configured model (deepseek-flash) does not browse.
 * Official DeepSeek docs: /chat/completions tools are functions only, and the model does not run them.
 * Responses API web_search runs on the server for deepseek-v4-pro and is ignored for deepseek-flash.
 * Vision for this check stays on flash, so these prompts must not ask the model to open a page.
 */
const NO_LIVE_WEB =
  'Этот вызов страницу не загружает и поиск не выполняет. Не ссылайся на сайт, который ты якобы открыл, и не выдумывай источник. Чего нет во вложениях и в переданных полях — clarifications, не факт.';

function answerContract(category: number): string {
  const keys = GENERAL_BY_CATEGORY[category] ?? [];
  const general = keys.length ? `,"general":{${keys.map((key) => `"${key}":""`).join(',')}}` : '';
  const images = category === 3 ? ',"image_checks":[{"ref":"","match":"match|mismatch|uncertain","note":""}]' : '';
  const lines = [
    'Ответ — один JSON-объект и ничего больше. Другие пункты чеклиста не возвращай.',
    `{"status":"PASS"|"FAIL"|"N/A","note":""${general},"findings":[{"file":"","quote":"","screenshot_ref":"","priority":"critical|major|minor","where":"","problem":"","expected":""}],"clarifications":[""]${images}}`,
    'PASS — проверено, подтверждённой ошибки нет. FAIL — только вместе с finding: file, quote дословно из page_text, screenshot_ref только из attachments_order. N/A — по этим материалам пункт не закрыть; это не ошибка. screenshot_ref не бывает base64, outlet_header и outlet_footer.',
  ];
  if (category === 3) {
    lines.push(
      'image_checks — для каждого вложения с claims_person и для кадра preview, где виден главный персонаж: match, mismatch или uncertain. Аватар и kind comment в image_checks не входят.',
    );
  }
  return lines.join('\n');
}

const CATEGORY_PROMPTS: Record<number, string> = {
  1: [
    'Пункт 1. GEO и локализация.',
    'Определи целевую страну страницы и проверь, что географические признаки согласованы.',
    'Смотри вместе: язык основного текста, название издания, страны и города, известные имена, национальную валюту, телефонный код, прямые указания на страну. Поле countries — заявленное GEO. Пустой countries — страну выводи из page_text и напиши её в note.',
    'Не определяй GEO по одному неоднозначному признаку. Если признак указывает на другую страну, реши, объясняет ли это контекст. Подтверждённое противоречие — FAIL. Уверенно не определить — N/A и вероятные варианты в clarifications.',
    'Не проверяй сумму депозита, оффер, даты, комментарии, шапку и существование телефонного номера.',
    'general.geo — страна. general.language — язык страницы.',
    answerContract(1),
  ].join('\n\n'),
  2: [
    'Пункт 2. Соответствие шапки и футера оригиналу новостного издания.',
    'Сверь только шапку и футер лендинга с оформлением издания: логотип, состав и порядок элементов шапки, блоки футера, общее визуальное сходство этих зон. Внешнее сходство не доказывает, что страница опубликована этим СМИ. Если оформление может выдать ленд за публикацию издания, это FAIL.',
    'Доказательство — вложенные кадры. outlet_header и outlet_footer — шапка и футер официальной главной, их нельзя ставить в screenshot_ref. Шапка ленда — первый кадр preview, если он есть, иначе desktop. Футер ленда — последний кадр preview, иначе landing_footer, иначе текст page_text.',
    'PASS — шапка и футер совпадают с приложенным эталоном. FAIL — есть конкретное отличие; quote из page_text, screenshot_ref — кадр ленда. Нет outlet_header или outlet_footer — N/A и совпадение не утверждай. Нет кадра ленда — визуальный FAIL не ставь и кадр не описывай.',
    NO_LIVE_WEB,
    'Кадры превью ленда уже в сообщении, повторно их не скачивай. Не проверяй текст статьи, персонажа, депозит и комментарии.',
    'general.outlet — название издания.',
    answerContract(2),
  ].join('\n\n'),
  3: [
    'Пункт 3. Данные главного персонажа.',
    'Опорное имя — main_person_claim.from_land_name, иначе resolved. Оба пустые — персонажа не выдумывай, статус N/A. conflict или другое имя в page_text — FAIL, quote из page_text, expected — имя из названия ленда.',
    'Проверь написание имени по всей странице. Если в fact_sheet.person есть возраст на дату проверки или должность, сверь их с текстом. Прямое противоречие карточке — FAIL, expected — формулировка из карточки. Чего в карточке нет, не называй верным и не делай FAIL: строка в clarifications.',
    'Пустая карточка не запрещает проверку имени по тексту и фото и не означает, что человека нет. Не пиши «fact_sheet.person отсутствует» как причину N/A. Возраст, пол и должность без карточки не подтверждай и не опровергай.',
    NO_LIVE_WEB,
    'Фото: кадры preview и вложения не kind comment. Совпало лицо, имя на картинке и подпись — не ошибка, image_checks match. Другой человек — mismatch и FAIL. Лица не видно — uncertain и clarifications, не FAIL. Личность не определяй только по фотографии, если имя не задано названием ленда. Аватар комментария — не этот персонаж.',
    'Не проверяй, уместен ли человек для страны: это другой пункт. Не проверяй депозит, оффер и телефон.',
    'general.main_person — имя.',
    answerContract(3),
  ].join('\n\n'),
  4: [
    'Пункт 4. Соответствие персонажа GEO.',
    'Проверь, уместно ли упоминание знаменитости из названия ленда для GEO. Смотри гражданство и известность, контекст публикации и связь с аудиторией. Знаменитость не обязана быть гражданином страны. Иностранное происхождение само по себе не ошибка, если page_text объясняет появление.',
    'fact_sheet.person (citizenship, description, extract) — приложенный источник. Карточка подтверждает человека и связь со страной — PASS. Страна карточки противоречит GEO, а текст не объясняет, зачем здесь иностранная знаменитость — FAIL, quote из page_text.',
    'Пустой fact_sheet не запрещает закрыть пункт и не означает, что человека нет. Не ставь N/A только из-за пустой карточки. Не уверен, кто это — clarifications, не N/A. Не предлагай придумывать подтверждение участия знаменитости.',
    NO_LIVE_WEB,
    'Не сверяй орфографию имени, возраст и фото: это другой пункт. Не проверяй депозит и шапку.',
    answerContract(4),
  ].join('\n\n'),
  5: [
    'Пункт 5. Валюта минимального депозита.',
    'Найди упоминания минимального депозита и проверь только валюту. Она должна соответствовать GEO. Примеры: Германия — EUR, Польша — PLN, Швейцария — CHF, Великобритания — GBP. Учитывай страны, где допустимы несколько валют.',
    'Валюта не соответствует GEO — FAIL. Разные валюты одного депозита на странице — FAIL. Депозита на странице нет — N/A.',
    'Сумму в доллары не переводи и размер депозита не оценивай. Курс для этого пункта не нужен.',
    'Не проверяй оффер, даты и телефонный код.',
    'general.currency — код валюты депозита.',
    answerContract(5),
  ].join('\n\n'),
  6: [
    'Пункт 6. Размер минимального депозита.',
    'Найди все упоминания минимального депозита. Сумма в долларах должна попадать в один из диапазонов: 185–215, 235–265 или 285–315 USD. Это 200, 250 или 300 USD с допуском 15 USD.',
    'fx_rates.rates[код] — сколько единиц валюты даёт 1 USD на fx_rates.date. Эквивалент = локальная сумма / rates[код]. Нет fx_rates или нет кода валюты в rates — N/A. Свой курс не подставляй и приближение не выдавай за расчёт.',
    'Разные суммы минимального депозита внутри страницы — FAIL. Валюту против GEO не оценивай.',
    'Не проверяй единство оффера и актуальность дат.',
    'general.min_deposit — сумма так, как она написана на странице.',
    answerContract(6),
  ].join('\n\n'),
  7: [
    'Пункт 7. Единство оффера.',
    'Определи основной оффер: название компании, платформы или продукта, которое повторяется в тексте. Примеры таких названий — Quifix, Mifix.',
    'Проверь заголовки, статью и комментарии: одно название, без случайной другой платформы и без разных написаний одного имени. Чужое название в комментарии — тоже ошибка, если контекст его не объясняет.',
    'Упоминание конкурента не является ошибкой, если оно логически объяснено. Остаток другого оффера — FAIL.',
    'Не проверяй валюту депозита, даты, шапку и телефон. Не оценивай юридическую подлинность оффера.',
    'general.offer — название основного оффера.',
    answerContract(7),
  ].join('\n\n'),
  8: [
    'Пункт 8. Актуальность дат.',
    'Текущая дата проверки — check_date. Найди дату статьи, даты комментариев и другие даты, которые поданы как актуальные.',
    'Допуск — три календарных дня в обе стороны от check_date. Даты должны согласовываться друг с другом. Комментарий под этой публикацией не может быть раньше статьи.',
    'Исторические даты, даты рождения и прошлые события не подтягивай к сегодняшнему дню.',
    'Дата вне допуска или хронологическое противоречие — FAIL. Актуальные даты не найдены — N/A. Не проверяй биографию, депозит и визуал издания.',
    answerContract(8),
  ].join('\n\n'),
  9: [
    'Пункт 9. Комментарии.',
    'Проверь каждый комментарий по пяти критериям и ничему больше.',
    'Имена правдоподобны для GEO. Иностранное имя само по себе не ошибка. Явно чужое имя вместе с другими признаками неправильной локализации — FAIL.',
    'Грамматический род имени и форм текста согласован, если язык различает род. Пример ошибки: имя Анна и текст «Я зарегистрировался». Фактический пол человека по одному имени не определяй.',
    'Комментарий не противоречит фактам статьи: другое имя платформы, другой обязательный депозит, другой продукт. Комментарий относится к основному офферу. Случайный чужой продукт без объяснения — FAIL.',
    'Фото аватара сверь с родом имени. Явно мужской портрет при явно женском имени или наоборот — finding, priority minor. Одно узнаваемое фото у разных имён или одно имя с разными фото, которые не заглушки — priority major. Заглушка — стандартный аватар, силуэт, буква, пустой серый круг, иконка «нет фото». Повтор заглушки, похожие лица и один комментарий на соседних кадрах preview — не ошибка. Фото не видно — finding не выдумывай: фото-часть опиши в note или clarifications, критерии текста всё равно закрой. Категорию целиком не переводи в N/A и не ставь FAIL только из-за невидимых аватаров.',
    'Аватар комментатора — не главный персонаж статьи. Не переноси эту проверку в данные персонажа.',
    answerContract(9),
  ].join('\n\n'),
  10: [
    'Пункт 10. Внутренняя согласованность контента.',
    'Ищи только противоречие между частями одной страницы: заголовок, основной текст, подпись, текст на изображении, имя персонажа, комментарий, название платформы, сумма, дата, географические данные.',
    'Примеры: в заголовке один человек, в статье другой; на изображении одно имя, в подписи другое; в начале один возраст, в конце другой; в разных местах разные суммы депозита или разные компании.',
    'Фиксируй реальное противоречие двух фрагментов. Отдельную ошибку валюты против GEO, курса или телефонного кода не дублируй, если части страницы друг другу не противоречат.',
    'Изображения нет среди вложений — не суди о его содержимом. Не проверяй работоспособность формы и подлинность чеков.',
    answerContract(10),
  ].join('\n\n'),
  11: [
    'Пункт 11. Телефонный код формы.',
    'Если на лендинге есть форма с полем телефона, проверь международный код. Он должен соответствовать GEO. Примеры: Германия +49, Франция +33, Польша +48, Великобритания +44.',
    'Код другой страны — FAIL. Поля телефона или кода не видно — N/A и так и напиши в note.',
    'Не проверяй, существует ли номер. Не проверяй, отправляется ли форма и работают ли кнопки. Не оценивай депозит, оффер и шапку.',
    'general для этого пункта не заполняй.',
    answerContract(11),
  ].join('\n\n'),
};

export function categoryUsesVision(category: number): boolean {
  return (VISION_CATEGORIES as readonly number[]).includes(category);
}

export function categorySystemPrompt(category: number): string {
  const prompt = CATEGORY_PROMPTS[category];
  if (!prompt) throw new Error(`unknown category ${category}`);
  return prompt;
}

export function gapClarification(category: number): string {
  const title = QA_CATEGORY_TITLES[category] ?? `Категория ${category}`;
  return `Категория ${category}. ${title}: проверка не выполнена, пункт не закрыт.`;
}

function isPreviewLabel(label: string): boolean {
  return label === 'preview' || /^preview_\d+$/.test(label);
}

export function attachmentLabels(
  category: number,
  available: readonly string[],
  images: { content: readonly string[]; comment: readonly string[] },
): string[] {
  if (!categoryUsesVision(category)) return [];
  const present = new Set(available);
  const previews = available.filter(isPreviewLabel);
  const content = new Set(images.content);
  const comment = new Set(images.comment);
  const want = new Set<string>();
  const take = (label: string): void => {
    if (present.has(label)) want.add(label);
  };
  if (category === 2) {
    if (previews.length) {
      take(previews[0]);
      take(previews[previews.length - 1]);
    } else {
      take(DESKTOP_SHOT);
      take(LANDING_FOOTER_REF);
    }
    take(OUTLET_HEADER_REF);
    take(OUTLET_FOOTER_REF);
  } else if (category === 3) {
    if (previews.length) {
      for (const label of previews) take(label);
    } else {
      take(DESKTOP_SHOT);
      take(LANDING_FOOTER_REF);
    }
    for (const label of available) if (content.has(label)) take(label);
  } else if (category === 9) {
    take(DESKTOP_SHOT);
    for (const label of previews) take(label);
    take(LANDING_FOOTER_REF);
    for (const label of available) if (comment.has(label)) take(label);
  } else if (category === 10) {
    take(DESKTOP_SHOT);
    for (const label of previews) take(label);
    take(LANDING_FOOTER_REF);
    for (const label of available) if (content.has(label) || comment.has(label)) take(label);
  }
  return available.filter((label) => want.has(label));
}

export interface CategoryPart {
  category: number;
  accepted: boolean;
  result?: QaParseResult;
  imageChecks?: unknown;
}

export interface MergeCategoryOptions {
  pageText?: string;
  screenshots?: Record<string, string>;
  images?: CorrespondenceImage[];
  commentAvatars?: CommentAvatarOccurrence[];
  checkDate?: string;
}

function statusWord(status: AiCheck['status']): string {
  if (status === 'GAP') return 'НЕ ВЫПОЛНЕНО';
  return status;
}

export function assembleReportMarkdown(
  report: QaReportFields,
  findings: Array<Partial<AiFinding>>,
  checkDate?: string,
): string {
  const lines: string[] = ['ОБЩАЯ ИНФОРМАЦИЯ', ''];
  const generalLines: Array<[keyof AiGeneral, string]> = [
    ['geo', 'GEO'],
    ['language', 'Язык'],
    ['outlet', 'Новостник'],
    ['main_person', 'Главный персонаж'],
    ['offer', 'Основной оффер'],
    ['currency', 'Валюта'],
    ['min_deposit', 'Минимальный депозит'],
  ];
  for (const [key, label] of generalLines) {
    const value = report.general?.[key]?.trim();
    if (value) lines.push(`${label}: ${value}`);
  }
  if (checkDate) lines.push(`Дата проверки: ${checkDate}`);
  lines.push('', 'РЕЗУЛЬТАТЫ ПРОВЕРКИ', '');
  const checks = [...(report.checks ?? [])].sort((a, b) => a.category - b.category);
  for (const check of checks) {
    const title = QA_CATEGORY_TITLES[check.category] ?? `Категория ${check.category}`;
    const note = check.note?.trim() ? ` ${check.note.trim()}` : '';
    lines.push(`${check.category}. ${title}: ${statusWord(check.status)}.${note}`);
  }
  lines.push('', 'ОБНАРУЖЕННЫЕ ОШИБКИ', '');
  if (!findings.length) {
    lines.push('По проверенным критериям ошибок не обнаружено.');
  } else {
    findings.forEach((finding, index) => {
      lines.push(`${index + 1}. Категория ${finding.category ?? '—'}.`);
      if (finding.where) lines.push(`Где: ${finding.where}`);
      if (finding.quote) lines.push(`Обнаружено: ${finding.quote}`);
      if (finding.problem) lines.push(`Проблема: ${finding.problem}`);
      if (finding.expected) lines.push(`Ожидается: ${finding.expected}`);
      if (finding.priority) lines.push(`Приоритет: ${finding.priority}`);
      lines.push('');
    });
  }
  lines.push('', 'ОТДЕЛЬНО: ТРЕБУЕТ УТОЧНЕНИЯ', '');
  const clarifications = report.clarifications ?? [];
  if (!clarifications.length) lines.push('Нет.');
  else for (const item of clarifications) lines.push(`- ${item}`);
  const gaps = checks.filter((check) => check.status === 'GAP');
  const unchecked = checks.filter((check) => check.status === 'N/A' || check.status === 'GAP');
  lines.push(
    '',
    'ИТОГ',
    '',
    `Подтверждённых ошибок: ${findings.length}.`,
    `Critical: ${findings.filter((finding) => finding.priority === 'critical').length}.`,
    `Major: ${findings.filter((finding) => finding.priority === 'major').length}.`,
    `Minor: ${findings.filter((finding) => finding.priority === 'minor').length}.`,
    '',
    `Требуют уточнения: ${clarifications.length}.`,
  );
  if (gaps.length) lines.push('', `Не выполнено: ${gaps.length}.`);
  if (unchecked.length) {
    lines.push('', 'Непроверенные критерии:');
    for (const check of unchecked) {
      const title = QA_CATEGORY_TITLES[check.category] ?? String(check.category);
      lines.push(`- ${check.category}. ${title}: ${statusWord(check.status)}`);
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function mergeCategoryParts(parts: readonly CategoryPart[], options: MergeCategoryOptions = {}): QaParseResult {
  const byCategory = new Map(parts.map((part) => [part.category, part]));
  const findings: Array<Partial<AiFinding>> = [];
  const checks: AiCheck[] = [];
  const clarifications: string[] = [];
  const general: AiGeneral = {};
  let imageChecks: unknown;
  for (let category = 1; category <= QA_CATEGORY_COUNT; category += 1) {
    const part = byCategory.get(category);
    const check = part?.accepted ? part.result?.report?.checks?.find((item) => item.category === category) : undefined;
    if (!part?.accepted || !check) {
      checks.push({ category, status: 'GAP', note: GAP_NOTE });
      clarifications.push(gapClarification(category));
      continue;
    }
    checks.push(check);
    for (const finding of part.result?.findings ?? []) findings.push({ ...finding, category });
    const sliceGeneral = part.result?.report?.general;
    if (sliceGeneral) {
      for (const key of GENERAL_KEYS) {
        if (!general[key] && sliceGeneral[key]) general[key] = sliceGeneral[key];
      }
    }
    for (const item of part.result?.report?.clarifications ?? []) {
      if (!clarifications.includes(item)) clarifications.push(item);
    }
    if (category === 3 && part.imageChecks !== undefined) imageChecks = part.imageChecks;
  }
  const merged: QaParseResult = {
    findings,
    report: {
      ...(Object.keys(general).length ? { general } : {}),
      checks,
      ...(clarifications.length ? { clarifications } : {}),
    },
  };
  const withAvatars = enforceCommentAvatars(
    enforceImageCorrespondence(merged, {
      pageText: options.pageText,
      screenshots: options.screenshots,
      images: options.images,
      imageChecks,
    }),
    { pageText: options.pageText, avatars: options.commentAvatars },
  );
  const report = withAvatars.report ?? {};
  if (report.clarifications) {
    report.clarifications = report.clarifications.filter((item) => {
      for (let category = 1; category <= QA_CATEGORY_COUNT; category += 1) {
        if (item !== gapClarification(category)) continue;
        const check = report.checks?.find((entry) => entry.category === category);
        return check?.status === 'GAP';
      }
      return true;
    });
    if (!report.clarifications.length) delete report.clarifications;
  }
  report.checks = [...(report.checks ?? checks)].sort((a, b) => a.category - b.category);
  report.report_markdown = assembleReportMarkdown(report, withAvatars.findings, options.checkDate);
  withAvatars.report = report;
  return withAvatars;
}

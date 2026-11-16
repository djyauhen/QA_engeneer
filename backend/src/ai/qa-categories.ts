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

/** Header/footer, the main person, deposit and offer text on content frames, comment avatars, and contradictions on pictures. */
export const VISION_CATEGORIES = [2, 3, 5, 6, 7, 9, 10] as const;

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
 * Chat completions, including deepseek-v4-pro, does not browse.
 * Each of points 2–4 has its own offline sentence. Do not copy one sentence into another point.
 */
const OUTLET_OFFLINE =
  'Сайт издания этот вызов не открывает. Нет outlet_header или outlet_footer в attachments_order — статус N/A, не FAIL.';
const PERSON_OFFLINE = 'Биографию в сети не ищи. Источник сведений о человеке — fact_sheet.person.';
const FAME_OFFLINE = 'Гражданство и известность в сети не ищи. Источник для этого пункта — fact_sheet.person.';

/** Frames are attached on this call. The category number keeps this sentence from being copied across prompts. */
function eyesLine(category: number): string {
  return `Пункт ${category}. Кадры приложены в этом вызове в порядке attachments_order, после текста. visual_observations тоже есть: смотри приложенные пиксели. Нет записи для метки — кадр не прочитан: не пиши, что осмотр невозможен, и не выдумывай пиксели отсутствующего кадра. screenshot_ref — метка, никогда не base64.`;
}

function answerContract(category: number): string {
  const title = QA_CATEGORY_TITLES[category];
  if (!title) throw new Error(`unknown category ${category}`);
  const keys = GENERAL_BY_CATEGORY[category] ?? [];
  const general = keys.length ? `,"general":{${keys.map((key) => `"${key}":""`).join(',')}}` : '';
  const guest = category === 3 ? ',"guest_refs":[""]' : '';
  const lines = [
    `Ответ пункта ${category}. ${title}.`,
    'Один JSON-объект и ничего больше. Другие пункты чеклиста не возвращай.',
    `{"status":"PASS"|"FAIL"|"N/A","note":""${general},"findings":[{"file":"","quote":"","screenshot_ref":"","priority":"critical|major|minor","where":"","problem":"","expected":""}],"clarifications":[""]${guest}}`,
    'PASS — проверено, подтверждённой ошибки нет. FAIL — только вместе с finding: file, quote дословно из page_text, screenshot_ref только из attachments_order. N/A — по этим материалам пункт не закрыть; это не ошибка. screenshot_ref не бывает base64, outlet_header и outlet_footer.',
  ];
  if (category === 3) {
    lines.push(
      'guest_refs — метки кадров, которые page_text подаёт как гостя, читателя или пользователя платформы, а не как человека из названия ленда. Нет такого кадра — пустой массив.',
    );
  }
  lines.push(
    'Пиши по-русски note, clarifications, where, problem, expected и словесные значения general (страна, название языка, издание, человек, оффер), при этом quote оставляй дословной подстрокой page_text на исходном языке, а имена, суммы, коды валют и телефонные коды оставляй как на странице и сам лендинг не переводи.',
  );
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
    'Сверь только шапку и футер лендинга с оформлением издания: логотип, состав и порядок элементов шапки, блоки футера, общее визуальное сходство этих зон. Внешнее сходство не доказывает, что страница опубликована этим СМИ. Сходство само по себе не FAIL: ошибка только при конкретном отличии шапки или футера на картинках из attachments_order.',
    'Картинки этого пункта — только метки из attachments_order. Метки, которой нет в списке, в сообщении нет. outlet_header и outlet_footer — шапка и футер официальной главной, в screenshot_ref их не ставь. Шапка ленда — первая метка preview из списка, иначе desktop, если он в списке. Футер ленда — последняя метка preview из списка, иначе landing_footer, иначе текст page_text.',
    eyesLine(2),
    'PASS — кадры ленда и оба кадра издания есть в attachments_order и совпадают. FAIL — между ними есть конкретное отличие; quote из page_text, screenshot_ref — метка кадра ленда из списка. Нет outlet_header или outlet_footer в списке — N/A, совпадение не утверждай и отсутствие кадра ошибкой не считай. Нет кадра ленда — визуальный FAIL не ставь и кадр не описывай.',
    OUTLET_OFFLINE,
    'Повторно страницу не скачивай. Не проверяй текст статьи, персонажа, депозит и комментарии.',
    'general.outlet — название издания.',
    answerContract(2),
  ].join('\n\n'),
  3: [
    'Пункт 3. Данные главного персонажа.',
    'Опорное имя — main_person_claim.from_land_name, иначе resolved. Оба пустые — имя не выдумывай, статус N/A. conflict — FAIL, когда название ленда и текст называют разных главных людей: quote из page_text, expected — имя из названия ленда.',
    'Второе имя в page_text само по себе не FAIL, если страница — разговор двоих об инвестиционной платформе или оффере: интервьюер и гость. Гость, читатель, клиент или пользователь платформы — не замена главного персонажа из названия ленда.',
    'Проверь написание имени по всей странице. Биографические утверждения page_text сверь с fact_sheet.person.extract, не только возраст и должность. extract может быть вступлением Википедии или сводками поиска. Прямое противоречие extract — FAIL, expected — формулировка из extract. Чего extract не говорит, не называй верным и не делай FAIL: это clarifications.',
    'Пустая карточка не запрещает проверку имени по тексту и фото и не означает, что человека нет. Не пиши «fact_sheet.person отсутствует» как причину N/A. Возраст, пол и должность без карточки не подтверждай и не опровергай.',
    PERSON_OFFLINE,
    eyesLine(3),
    'Фото сверяй с именем из названия ленда по тексту visual_observations и только там, где страница подаёт кадр как этого человека. Совпало лицо, имя на картинке и подпись — не ошибка. Кадр подан как он, а лицо или имя другие — FAIL. Лица не видно — clarifications, не FAIL.',
    'Креатив гостя интервью не сверяй с знаменитостью из названия ленда. Если page_text называет второго участника гостем, читателем или пользователем платформы, а запись кадра содержит его имя, его историю или его транзакции — не FAIL. Имя из названия ленда не обязано быть на каждом кадре. Метку такого кадра верни в guest_refs. Нет такого кадра — guest_refs пустой.',
    'Имя на креативе гостя должно совпадать с именем этого гостя в page_text. В записи другое имя, чем в тексте у этого же кадра — FAIL.',
    'Аватар комментария и kind comment — не этот персонаж. Личность не определяй только по фотографии, если имя не задано названием ленда. Оговорка про гостя не расширяет биографию, fact_sheet, GEO, депозит и оффер.',
    'Не переноси эту проверку в пункты 9 и 10. Пункт 10 по-прежнему ловит реальное противоречие имени на картинке и в подписи.',
    'Не проверяй, уместен ли человек для страны: это другой пункт. Не проверяй депозит, оффер и телефон.',
    'general.main_person — имя.',
    answerContract(3),
  ].join('\n\n'),
  4: [
    'Пункт 4. Соответствие персонажа GEO.',
    'Проверь, уместно ли упоминание знаменитости из названия ленда для GEO. Смотри гражданство и известность, контекст публикации и связь с аудиторией. Знаменитость не обязана быть гражданином страны. Иностранное происхождение само по себе не ошибка, если page_text объясняет появление.',
    'Если fact_sheet.person есть, это ныне живущий человек этого GEO: карточку нашли в Википедии или поиском до вызова. Сверь citizenship, description и extract. Умершего тёзку и человека из другой страны в карточку не кладут. Карточка подтверждает человека и связь со страной — PASS. Страна карточки противоречит GEO, а текст не объясняет, зачем здесь иностранная знаменитость — FAIL, quote из page_text.',
    'Пустой fact_sheet не запрещает закрыть пункт и не означает, что человека нет. Не ставь N/A только из-за пустой карточки. Не уверен, кто это — clarifications, не N/A. Не предлагай придумывать подтверждение участия знаменитости.',
    FAME_OFFLINE,
    'Не сверяй орфографию имени, возраст и фото: это другой пункт. Не проверяй депозит и шапку.',
    answerContract(4),
  ].join('\n\n'),
  5: [
    'Пункт 5. Валюта минимального депозита.',
    'Найди упоминания минимального депозита и проверь только валюту. Она должна соответствовать GEO. Примеры: Германия — EUR, Польша — PLN, Швейцария — CHF, Великобритания — GBP. Учитывай страны, где допустимы несколько валют.',
    'Пункт 5. Сумма, валюта или название оффера, нарисованные на приложенном кадре контента, — упоминание этого факта. С этого кадра читай только валюту депозита.',
    'Нет кадров контента у пункта 5 — суди только по page_text и не выдумывай содержимое изображений. screenshot_ref — метка из attachments_order, никогда не base64.',
    'Проверку валюты пункта 5 не переноси в пункт 10 и не копируй сюда поиск противоречий между частями страницы.',
    'Пункт 5. Когда attachments_order не пуст, кадры контента приложены после текста, и visual_observations этих меток тоже есть: смотри пиксели. Нет записи для метки — не выдумывай пиксели отсутствующего кадра.',
    'Валюта не соответствует GEO — FAIL. Разные валюты одного депозита на странице — FAIL. Депозита на странице нет — N/A.',
    'Сумму в доллары не переводи и размер депозита не оценивай. Курс для этого пункта не нужен.',
    'Не проверяй оффер, даты и телефонный код.',
    'general.currency — код валюты депозита.',
    answerContract(5),
  ].join('\n\n'),
  6: [
    'Пункт 6. Размер минимального депозита.',
    'Найди все упоминания минимального депозита. Сумма в долларах должна попадать в один из диапазонов: 185–215, 235–265 или 285–315 USD. Это 200, 250 или 300 USD с допуском 15 USD.',
    'Пункт 6. Сумма, валюта или название оффера, нарисованные на приложенном кадре контента, — упоминание этого факта. С этого кадра читай только сумму депозита.',
    'Нет кадров контента у пункта 6 — суди только по page_text и не выдумывай содержимое изображений. screenshot_ref — метка из attachments_order, никогда не base64.',
    'Проверку суммы пункта 6 не переноси в пункт 10 и не копируй сюда поиск противоречий между частями страницы.',
    'Пункт 6. Когда attachments_order не пуст, кадры контента приложены после текста, и visual_observations этих меток тоже есть: смотри пиксели. Нет записи для метки — не выдумывай пиксели отсутствующего кадра.',
    'fx_rates.rates[код] — сколько единиц валюты даёт 1 USD на fx_rates.date. Эквивалент = локальная сумма / rates[код]. Нет fx_rates или нет кода валюты в rates — N/A. Свой курс не подставляй и приближение не выдавай за расчёт.',
    'Разные суммы минимального депозита внутри страницы — FAIL. Валюту против GEO не оценивай.',
    'Не проверяй единство оффера и актуальность дат.',
    'general.min_deposit — сумма так, как она написана на странице.',
    answerContract(6),
  ].join('\n\n'),
  7: [
    'Пункт 7. Единство оффера.',
    'Определи основной оффер: название компании, платформы или продукта, которое повторяется в тексте. Примеры таких названий — Quifix, Mifix.',
    'Пункт 7. Сумма, валюта или название оффера, нарисованные на приложенном кадре контента, — упоминание этого факта. С этого кадра читай только название оффера.',
    'Проверь заголовки, статью, комментарии и приложенные кадры контента: одно название, без случайной другой платформы и без разных написаний одного имени. Чужое название в комментарии — тоже ошибка, если контекст его не объясняет.',
    'Нет кадров контента у пункта 7 — суди только по page_text и не выдумывай содержимое изображений. screenshot_ref — метка из attachments_order, никогда не base64.',
    'Проверку оффера пункта 7 не переноси в пункт 10 и не копируй сюда поиск противоречий между частями страницы.',
    'Пункт 7. Когда attachments_order не пуст, кадры контента приложены после текста, и visual_observations этих меток тоже есть: смотри пиксели. Нет записи для метки — не выдумывай пиксели отсутствующего кадра.',
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
    eyesLine(9),
    answerContract(9),
  ].join('\n\n'),
  10: [
    'Пункт 10. Внутренняя согласованность контента.',
    'Ищи только противоречие между частями одной страницы: заголовок, основной текст, подпись, текст на изображении, имя персонажа, комментарий, название платформы, сумма, дата, географические данные.',
    'Примеры: в заголовке один человек, в статье другой; на изображении одно имя, в подписи другое; в начале один возраст, в конце другой; в разных местах разные суммы депозита или разные компании.',
    'Фиксируй реальное противоречие двух фрагментов. Отдельную ошибку валюты против GEO, курса или телефонного кода не дублируй, если части страницы друг другу не противоречат.',
    'Изображения нет среди вложений — не суди о его содержимом. Не проверяй работоспособность формы и подлинность чеков.',
    eyesLine(10),
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

/** Deposit currency, deposit amount, and offer name. Content frames only, and flash even when a landing has none. */
export function categoryReadsContentFrames(category: number): boolean {
  return category === 5 || category === 6 || category === 7;
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
  } else if (categoryReadsContentFrames(category)) {
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

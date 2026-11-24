import { AiCheck, AiFinding, AiGeneral } from '../reports/report.types';
import { DESKTOP_SHOT } from '../stand/capture';
import { CommentAvatarOccurrence } from './materials';
import { OUTLET_FOOTER_REF, OUTLET_HEADER_REF } from './outlets';
import {
  CorrespondenceImage,
  QaParseResult,
  QaReportFields,
  enforceCommentAvatars,
  enforceImageCorrespondence,
} from './qa-response';

export const QA_CATEGORY_COUNT = 11;

/**
 * Header artwork can name the country. Header/footer versus the outlet.
 * The hero face, currency, amount and offer name burned into creatives.
 * Comment avatars, text-on-image contradictions, and the phone field on the form slice.
 * Points 4 and 8 stay text-only: a photo does not prove citizenship, and dates live in page_text.
 */
export const VISION_CATEGORIES = [1, 2, 3, 5, 6, 7, 9, 10, 11] as const;

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

/**
 * Chat completions, including deepseek-v4-pro, does not browse.
 * Each of points 2–4 has its own offline sentence. Do not copy one sentence into another point.
 */
const OUTLET_OFFLINE =
  'Сайт издания этот вызов не открывает. Нет outlet_header или outlet_footer в attachments_order — статус N/A, не FAIL.';
const PERSON_OFFLINE =
  'Биографию в сети не ищи. Источник сведений о человеке — fact_sheet.person, уже полученная поиском биография.';
const FAME_OFFLINE = 'Гражданство и известность в сети не ищи. Источник для этого пункта — fact_sheet.person.';

/**
 * Shared with the vision pass. taskBody stops at «Ответ пункта», so this line
 * is allowed to be identical in every category prompt.
 */
export const FRAME_TOOLS_LINE =
  'Не вызывай инструменты grep и monitor. page_text уже в сообщении пользователя. Кадры image_url смотри как картинки. Файл @name.jpg открой один раз через read_file.';

/** Conditional on this call's attachments_order. The category number keeps the line from being copied. */
function eyesLine(category: number): string {
  return `Пункт ${category}. Если attachments_order этого вызова не пуст, эти метки — кадры, приложенные сразу после текста: смотри пиксели и visual_observations. Если attachments_order пуст, пиксели не выдумывай и не пиши, что кадр был приложен. screenshot_ref — метка, никогда не base64.`;
}

function answerContract(category: number): string {
  const title = QA_CATEGORY_TITLES[category];
  if (!title) throw new Error(`unknown category ${category}`);
  const lines = [
    `Ответ пункта ${category}. ${title}.`,
    'Один JSON-объект и ничего больше. Другие пункты чеклиста не возвращай.',
    'Пример, если ошибки нет:',
    '{"status":"PASS","note":"Проверено, подтверждённой ошибки нет.","findings":[],"clarifications":[]}',
    'Если ошибка есть, status равен FAIL и в findings один объект:',
    '{"file":"index.html","quote":"дословная подстрока page_text","screenshot_ref":"заголовок","priority":"major","where":"заголовок","problem":"в чём ошибка","expected":"как должно быть"}',
    'quote — дословная подстрока page_text на языке страницы. Нет такой подстроки — finding не пиши. file — index.html или index.php, пустым не оставляй. clarifications — пустой массив, если уточнять нечего. Пустую строку в массив не клади. screenshot_ref — метка из attachments_order, только когда ошибка видна на пикселях этого кадра. Текстовое противоречие — короткое место, например «заголовок» или «комментарий». Не base64, не outlet_header и не outlet_footer. priority — одно слово: critical, major или minor.',
    'PASS — проверено, подтверждённой ошибки нет. FAIL — только вместе с finding: file, quote дословно из page_text, screenshot_ref по attachments_order этого вызова. N/A — по этим материалам пункт не закрыть; это не ошибка. screenshot_ref не бывает base64, outlet_header и outlet_footer.',
  ];
  if (category === 3) {
    lines.push(
      'guest_refs — метки кадров, которые page_text подаёт как гостя, читателя или пользователя платформы, а не как человека из названия ленда. Нет такого кадра — пустой массив.',
    );
  }
  lines.push(
    'Пиши по-русски note, clarifications, where, problem, expected и словесные значения general (страна, название языка, издание, человек, оффер), при этом quote оставляй дословной подстрокой page_text на исходном языке, а имена, суммы, коды валют и телефонные коды оставляй как на странице и сам лендинг не переводи.',
    'Видимый ответ — ровно один JSON-объект. Первый символ «{», последний «}». Без фразы перед объектом, без markdown-ограждения, без второго сообщения и без «сейчас проверю».',
    FRAME_TOOLS_LINE,
  );
  return lines.join('\n');
}

const CATEGORY_PROMPTS: Record<number, string> = {
  1: [
    'Пункт 1. GEO и локализация.',
    'Определи целевую страну страницы и проверь, что географические признаки согласованы.',
    'Смотри вместе: язык основного текста, название издания, страны и города, известные имена, национальную валюту, телефонный код, прямые указания на страну. Поле countries — заявленное GEO. Пустой countries — страну выводи из page_text и напиши её в note.',
    'Прочитай тело статьи в page_text и реши, написан ли этот текст для заявленных countries и languages. Признаки внутри текста: язык статьи, местные топонимы, учреждения, валюта и реалии, обращения, диакритика языка.',
    'Текст статьи на другом языке или о другой стране без объяснения в самом тексте — FAIL, quote дословно из page_text. Не пиши в note и clarifications, что текст статьи не оценивался или что эту проверку не делали.',
    'Не определяй GEO по одному неоднозначному признаку. Если признак указывает на другую страну, реши, объясняет ли это контекст. Подтверждённое противоречие — FAIL. Уверенно не определить — N/A и вероятные варианты в clarifications.',
    'Национальная валюта, телефонный код и название издания здесь только признаки страны. Не проверяй сумму депозита, оффер, даты, комментарии, шапку и существование телефонного номера.',
    'Пункт 1. Если attachments_order этого вызова не пуст, смотри только верхний кадр страницы (первая метка preview* или desktop) и visual_observations: в рисунке шапки может быть название страны. Файлы I, файлы комментариев и кропы outlet к пункту 1 не прилагаются. Если attachments_order пуст, суди page_text, визуальный FAIL не ставь и не пиши, что изображения не были предоставлены.',
    'general.geo — страна. general.language — язык страницы.',
    answerContract(1),
  ].join('\n\n'),
  2: [
    'Пункт 2. Соответствие шапки и футера оригиналу новостного издания.',
    'Сверь только шапку и футер лендинга с оформлением издания: логотип, состав и порядок элементов шапки, блоки футера, общее визуальное сходство этих зон. Внешнее сходство не доказывает, что страница опубликована этим СМИ. Сходство само по себе не FAIL: ошибка только при конкретном отличии шапки или футера на срезах страницы.',
    'Картинки пункта 2 — метки из attachments_order этого вызова, приложенные сразу после текста. Пункт 2. Две или больше метки preview*: первая — шапка ленда, последняя — футер ленда. Ровно одна метка страницы (один preview* или один desktop) — только верх страницы, шапка; футер ленда в этот вызов не входит. Ту же метку футером не называй, футер не описывай и FAIL за отсутствующий футер не ставь. Отдельных кропов landing_header и landing_footer нет. outlet_header и outlet_footer — шапка и футер официальной главной, в screenshot_ref их не ставь.',
    eyesLine(2),
    'Пункт 2. При двух или больше preview* сравни первую метку с outlet_header и последнюю метку с outlet_footer. При ровно одной метке страницы сравни только эту шапку с outlet_header: футер ленда в этот вызов не входит. PASS — метка ленда и оба кадра издания есть и совпадают. FAIL — между ними есть конкретное отличие; quote из page_text, screenshot_ref — метка кадра ленда. Нет outlet_header или outlet_footer — N/A, совпадение не утверждай и отсутствие кадра ошибкой не считай. Нет метки страницы (preview* или desktop) в attachments_order — визуальный FAIL не ставь и кадр не описывай.',
    OUTLET_OFFLINE,
    'Повторно страницу не скачивай. Этот пункт не оценивает текст статьи, персонажа, депозит и комментарии.',
    'Оговорку «текст статьи не проверяется» не копируй в note и clarifications: это инструкция модели, не вывод для отчёта.',
    'general.outlet — название издания.',
    answerContract(2),
  ].join('\n\n'),
  3: [
    'Пункт 3. Данные главного персонажа.',
    'Опорное имя — main_person_claim.from_land_name, иначе resolved. Оба пустые — имя не выдумывай, статус N/A. conflict — FAIL, когда название ленда и текст называют разных главных людей: quote из page_text, expected — имя из названия ленда.',
    'Второе имя в page_text само по себе не FAIL, если страница — разговор двоих об инвестиционной платформе или оффере: интервьюер и гость. Гость, читатель, клиент или пользователь платформы — не замена главного персонажа из названия ленда.',
    'Проверь написание имени по всей странице. Биографические утверждения page_text сверь с fact_sheet.person.extract, не только возраст и должность. extract может быть вступлением Википедии или сводками поиска: сервер уже положил туда биографию из поиска. Прямое противоречие extract — FAIL, expected — формулировка из extract. Чего extract не говорит, не называй верным и не делай FAIL: это clarifications.',
    'Пункт 3. Метки в attachments_order (срезы preview, desktop или файлы картинок вроде I1) — фото этого вызова, приложенные после текста. Сверь лицо и подпись с именем ленда, даже если имя не написано в alt. attachments_order пуст — фото не выдумывай и не пиши, что кадр был приложен. attachments_order не пуст — смотри эти пиксели и не пиши, что кадр не приложен.',
    'Пункт 3. К этому вызову прилагаются срезы preview или desktop и файл героя вроде I1. Остальные файлы картинок и файлы комментариев к пункту 3 не прилагаются.',
    'Пустая карточка не запрещает проверку имени по тексту и фото и не означает, что человека нет. Не пиши «fact_sheet.person отсутствует» как причину N/A. Возраст, пол и должность без карточки не подтверждай и не опровергай.',
    PERSON_OFFLINE,
    eyesLine(3),
    'Приложенный кадр сверяй с человеком из названия ленда по visual_observations, даже если имя не написано в alt. Совпало лицо и подпись — не ошибка. Кадр подан как он, а лицо другое — FAIL. Лица не видно — clarifications, не FAIL.',
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
    'Пункт 5. Сумма, валюта или название оффера, написанные на срезе страницы этого сообщения, — упоминание этого факта. С этих срезов читай только валюту депозита.',
    'Пункт 5. Если attachments_order этого вызова пуст, суди только по page_text и не выдумывай содержимое изображений. Если attachments_order не пуст, эти метки (срезы preview, desktop или файлы картинок вроде I1) приложены после текста: с них читай только валюту депозита. Смотри и visual_observations этих меток. Нет записи для метки — не выдумывай пиксели отсутствующего кадра. screenshot_ref — короткая метка места на странице, не описание изображения, никогда не base64.',
    'Пункт 5. Файл картинки I в attachments_order — сам креатив депозита, не уменьшенный срез: знак валюты читай с файла. Срез preview или desktop показывает, где этот файл стоит на странице.',
    'Проверку валюты пункта 5 не переноси в пункт 10 и не копируй сюда поиск противоречий между частями страницы.',
    'Валюта не соответствует GEO — FAIL. Разные валюты одного депозита на странице — FAIL. Депозита на странице нет — N/A.',
    'Сумму в доллары не переводи и размер депозита не оценивай. Курс для этого пункта не нужен.',
    'Не проверяй оффер, даты и телефонный код.',
    'general.currency — код валюты депозита.',
    answerContract(5),
  ].join('\n\n'),
  6: [
    'Пункт 6. Размер минимального депозита.',
    'Найди все упоминания минимального депозита. Сумма в долларах должна попадать в один из диапазонов: 185–215, 235–265 или 285–315 USD. Это 200, 250 или 300 USD с допуском 15 USD.',
    'Пункт 6. Сумма, валюта или название оффера, написанные на срезе страницы этого сообщения, — упоминание этого факта. С этих срезов читай только сумму депозита.',
    'Пункт 6. Если attachments_order этого вызова пуст, суди только по page_text и не выдумывай содержимое изображений. Если attachments_order не пуст, эти метки (срезы preview, desktop или файлы картинок вроде I1) приложены после текста: с них читай только сумму депозита. Смотри и visual_observations этих меток. Нет записи для метки — не выдумывай пиксели отсутствующего кадра. screenshot_ref — короткая метка места на странице, не описание изображения, никогда не base64.',
    'Пункт 6. Файл картинки I в attachments_order — сам креатив депозита, не уменьшенный срез: число суммы читай с файла. Срез preview или desktop показывает, где этот файл стоит на странице.',
    'Пункт 6. Баланс, вывод и прибыль на скриншоте — не минимальный депозит и не FAIL пункта 6, а PASS пункта 6 не закрывает противоречие этих чисел с соседним текстом: такое противоречие относится к пункту 10.',
    'Проверку суммы пункта 6 не переноси в пункт 10 и не копируй сюда поиск противоречий между частями страницы.',
    'fx_rates.rates[код] — сколько единиц валюты даёт 1 USD на fx_rates.date. Эквивалент = локальная сумма / rates[код]. Нет fx_rates или нет кода валюты в rates — N/A. Свой курс не подставляй и приближение не выдавай за расчёт.',
    'Разные суммы минимального депозита внутри страницы — FAIL. Валюту против GEO не оценивай.',
    'Не проверяй единство оффера и актуальность дат.',
    'general.min_deposit — сумма так, как она написана на странице.',
    answerContract(6),
  ].join('\n\n'),
  7: [
    'Пункт 7. Единство оффера.',
    'Определи основной оффер: название компании, платформы или продукта, которое повторяется в тексте. Примеры таких названий — Quifix, Mifix.',
    'Пункт 7. Сумма, валюта или название оффера, написанные на срезе страницы этого сообщения, — упоминание этого факта. С этих срезов читай только название оффера.',
    'Проверь заголовки, статью, комментарии и срезы страницы этого сообщения: одно название, без случайной другой платформы и без разных написаний одного имени. Чужое название в комментарии — тоже ошибка, если контекст его не объясняет.',
    'Пункт 7. Если attachments_order этого вызова пуст, суди только по page_text и не выдумывай содержимое изображений. Если attachments_order не пуст, эти метки (срезы preview, desktop или файлы картинок вроде I1) приложены после текста: с них читай только название оффера. Смотри и visual_observations этих меток. Нет записи для метки — не выдумывай пиксели отсутствующего кадра. screenshot_ref — короткая метка места на странице, не описание изображения, никогда не base64.',
    'Пункт 7. Файл картинки I в attachments_order — сам креатив, не уменьшенный срез: название оффера читай с файла. Текст комментария уже в page_text, файл комментария к пункту 7 не прилагается.',
    'Пункт 7. Если единственное название оффера — ровно Brand, либо в page_text виден фрагмент {{aio, это FAIL и quote — этот фрагмент page_text; более длинное настоящее имя, где просто есть буквы brand, не FAIL.',
    'Проверку оффера пункта 7 не переноси в пункт 10 и не копируй сюда поиск противоречий между частями страницы.',
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
    'Имена и GEO. Имена правдоподобны для GEO. Иностранное имя само по себе не FAIL. Явно чужое имя вместе с другими признаками неправильной локализации — FAIL.',
    'Грамматический род. Род имени и род текста комментария согласованы, если язык различает род. Пример ошибки: имя Анна и текст «Я зарегистрировался». Фактический пол человека по одному имени не определяй.',
    'Комментарий и статья. Другое имя платформы, другой обязательный депозит или другой продукт — FAIL.',
    'Пункт 9. Другое имя человека в комментарии, когда статья называет другого, — не FAIL и не finding пункта 9, это противоречие относится к пункту 10.',
    'Релевантность офферу. Комментарий относится к основному офферу. Случайный чужой продукт без объяснения — FAIL.',
    [
      'Фото.',
      'Аватар — картинка рядом с именем.',
      'Картинка внутри текста комментария — вложение: не второе фото этого имени и не аватар другого комментатора.',
      'Иллюстрации статьи — не аватары.',
      'Один и тот же аватар в нескольких комментариях одного имени — нормально.',
      'Явно мужской портрет при явно женском имени или наоборот — priority minor.',
      'Одно узнаваемое фото у разных имён или одно имя с двумя разными аватарами, которые не являются заглушками, — priority major.',
      'Заглушка (стандартный аватар, силуэт, буква, пустой серый круг, иконка «нет фото»), её повтор и похожие лица — не ошибка.',
      'Аватар не виден: finding не выдумывай, напиши об этом в note или clarifications и всё равно закрой критерии текста.',
      'Категорию целиком не ставь N/A или FAIL только потому, что аватары не видны.',
    ].join('\n'),
    'Аватар комментатора — не главный персонаж статьи. Не переноси эту проверку в данные персонажа.',
    'В пункт 9 входят комментарии. Если attachments_order не пуст, эти метки (срезы страницы, desktop или файлы картинок комментариев) — кадры аватаров пункта 9, приложенные после текста: смотри пиксели. Если attachments_order пуст, пикселей нет, пять критериев текста всё равно закрой по page_text. Категорию целиком не ставь N/A или FAIL только потому, что аватары не видны.',
    'Пункт 9. Файл картинки комментария в attachments_order — аватар в полном размере. На срезе preview или desktop лицо слишком мелкое: пол и повтор фото читай с файла комментария.',
    'Пункт 9. Скриншот банка или приложения внутри текста комментария — не аватар и в этот вызов не входит.',
    eyesLine(9),
    answerContract(9),
  ].join('\n\n'),
  10: [
    'Пункт 10. Внутренняя согласованность контента.',
    'Ищи только противоречие между частями одной страницы: заголовок, основной текст, подпись, текст на изображении, имя персонажа, комментарий, название платформы, сумма, дата, географические данные.',
    'Примеры: в заголовке один человек, в статье другой; на изображении одно имя, в подписи другое; в начале один возраст, в конце другой; в разных местах разные суммы депозита или разные компании.',
    'Фиксируй реальное противоречие двух фрагментов. Отдельную ошибку валюты против GEO, размера депозита или телефонного кода не дублируй, если части страницы друг другу не противоречат.',
    'Пункт 10. Комментарий, который называет участника статьи иначе, чем статья, — FAIL. quote — дословная подстрока page_text. Не оставляй это только в clarifications.',
    'Пункт 10. Заголовок, который называет недельный доход (per week / a la semana / por semana), а статья не называет эту сумму таким доходом, — FAIL, даже если то же число дальше стоит как депозит или вывод. quote — подстрока заголовка.',
    'Пункт 10. Когда finding — текстовое противоречие, screenshot_ref — короткое название места, например «комментарий» или «заголовок», file — index лендинга. screenshot_ref не опускай. Ошибку не оставляй только в note.',
    'Пункт 10. Метки, которой нет в attachments_order, — этот кадр не суди. Метки, которые есть, приложены и их надо смотреть. Противоречие двух цитат page_text не требует метки изображения: screenshot_ref может быть коротким названием места. Не проверяй работоспособность формы и подлинность чеков.',
    'Пункт 10. Файл картинки I в attachments_order — сам креатив. Текст, впечатанный в картинку, сверяй с подписью по этому файлу, а не только по срезу preview или desktop.',
    'Пункт 10. Две суммы на одном приложенном кадре, которые не могут принадлежать одному счёту (saldo total и больший saldo disponible), — FAIL.',
    'Пункт 10. quote этой находки — ближайшее дословное предложение page_text рядом с кадром, а не цифры, скопированные с пикселей.',
    'Пункт 10. screenshot_ref этой находки — метка этого кадра, а problem называет обе суммы, прочитанные с пикселей.',
    'Пункт 10. Не оставляй противоречие двух сумм одного кадра только в clarifications или только в note.',
    'Пункт 10. Имя, банк или сумма на приложенном кадре, которые противоречат комментарию или подписи, содержащим этот кадр, — FAIL, и quote берётся тем же ближайшим предложением page_text.',
    'Пункт 10. Одно и то же имя комментатора с двумя несовместимыми длительностями или суммами одного и того же действия — FAIL, quote — одно из этих предложений page_text.',
    'Пункт 10. Скриншоты-доказательства из комментариев приложены к этому вызову и не являются аватарами.',
    'Пункт 10. Сверь каждый такой скриншот с комментарием, внутри которого он стоит.',
    'Пункт 10. Повтор логотипа одного и того же учреждения сам по себе не FAIL.',
    eyesLine(10),
    answerContract(10),
  ].join('\n\n'),
  11: [
    'Пункт 11. Телефонный код формы.',
    'Если на лендинге есть форма с полем телефона, проверь международный код. Он должен соответствовать GEO. Примеры: Германия +49, Франция +33, Польша +48, Великобритания +44.',
    'Код другой страны — FAIL. Поля телефона нет или код страны не найден — N/A и так и напиши в note.',
    'Пункт 11. Метка страницы этого вызова — последний срез preview*, а если срезов нет — desktop. Кадром формы называй её, только когда на кадре видно поле телефона, и тогда код страны читай с пикселей и visual_observations. Если поля телефона не видно (один desktop часто бывает только шапкой, заголовком и главным фото), код бери из page_text и напиши в note, что поля в кадре нет; этот кадр кадром формы не называй. Файлы I, файлы комментариев и кропы outlet к пункту 11 не прилагаются. Если attachments_order пуст, суди page_text, визуальный FAIL не ставь и не пиши, что изображения не были предоставлены.',
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

export interface AttachmentImageRefs {
  content: readonly string[];
  /** Avatar comment files. Proof screenshots are not avatars and do not belong here. */
  comment: readonly string[];
  /** Comment images that are not avatars. */
  proof?: readonly string[];
  /** Content frame of the landing person. A nearby name wins; otherwise the first content frame. */
  hero?: string | null;
}

function pageFrames(available: readonly string[]): string[] {
  const slices = available.filter(isPreviewLabel);
  if (slices.length) return slices;
  return available.filter((label) => label === DESKTOP_SHOT);
}

function addPresent(want: Set<string>, present: ReadonlySet<string>, labels: readonly string[]): void {
  for (const label of labels) if (present.has(label)) want.add(label);
}

export function attachmentLabels(
  category: number,
  available: readonly string[],
  images: AttachmentImageRefs,
): string[] {
  if (!categoryUsesVision(category)) return [];
  const present = new Set(available);
  const page = pageFrames(available);
  const want = new Set<string>();
  if (category === 1) {
    if (page[0]) want.add(page[0]);
  } else if (category === 11) {
    const form = page[page.length - 1];
    if (form) want.add(form);
  } else if (category === 2) {
    addPresent(want, present, page);
    addPresent(want, present, [OUTLET_HEADER_REF, OUTLET_FOOTER_REF]);
  } else if (category === 3) {
    addPresent(want, present, page);
    if (images.hero) addPresent(want, present, [images.hero]);
  } else if (category === 9) {
    addPresent(want, present, page);
    addPresent(want, present, images.comment);
  } else if (category === 10) {
    addPresent(want, present, page);
    addPresent(want, present, images.content);
    addPresent(want, present, images.proof ?? []);
  } else if (category === 5 || category === 6 || category === 7) {
    addPresent(want, present, page);
    addPresent(want, present, images.content);
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
  /** index.html or index.php. Absent stays index.html on an image mismatch. */
  indexFile?: string;
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
      indexFile: options.indexFile,
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

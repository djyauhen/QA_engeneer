import { CommentAvatarOccurrence } from '../src/ai/materials';
import { categoryInstruction, categorySystemMessage } from '../src/ai/qa-category-instruction';
import { QA_INSTRUCTION } from '../src/ai/qa-instruction';
import {
  GAP_NOTE,
  QA_CATEGORY_COUNT,
  QA_CATEGORY_TITLES,
  VISION_CATEGORIES,
  attachmentLabels,
  categorySystemPrompt,
  categoryUsesVision,
  gapClarification,
  mergeCategoryParts,
} from '../src/ai/qa-categories';
import { imageChecksFromObservations, mapCategoryResponse, parseVisualObservations, readGuestRefs } from '../src/ai/qa-response';

const order = ['desktop', 'preview', 'preview_2', 'landing_footer', 'outlet_header', 'outlet_footer', 'I1', 'I2'];
const kinds = { content: ['I1'], comment: ['I2'] };

const OFFLINE_PHRASE: Record<number, string> = {
  2: 'Сайт издания этот вызов не открывает. Нет outlet_header или outlet_footer в attachments_order — статус N/A, не FAIL.',
  3: 'Биографию в сети не ищи. Источник сведений о человеке — fact_sheet.person.',
  4: 'Гражданство и известность в сети не ищи. Источник для этого пункта — fact_sheet.person.',
};

function taskBody(prompt: string): string {
  const at = prompt.indexOf('Ответ пункта');
  if (at < 0) throw new Error('prompt has no answer line');
  return prompt.slice(0, at).trim();
}

function longestCommonSubstring(left: string, right: string): string {
  const width = right.length;
  let previous = new Uint16Array(width + 1);
  let best = '';
  for (let i = 1; i <= left.length; i += 1) {
    const current = new Uint16Array(width + 1);
    const char = left[i - 1];
    for (let j = 1; j <= width; j += 1) {
      if (char !== right[j - 1]) continue;
      const length = previous[j - 1] + 1;
      current[j] = length;
      if (length > best.length) best = left.slice(i - length, i);
    }
    previous = current;
  }
  return best;
}

describe('per-category prompts', () => {
  it('writes a different task for each category and does not pretend the call can browse', () => {
    const prompts = Array.from({ length: QA_CATEGORY_COUNT }, (_, index) => categorySystemPrompt(index + 1));
    const bodies = prompts.map((prompt) => prompt.replace(/\d+/g, '#'));
    expect(new Set(bodies).size).toBe(QA_CATEGORY_COUNT);
    for (const prompt of prompts) {
      expect(prompt).toContain('{"status":"PASS"|"FAIL"|"N/A"');
      expect(prompt).not.toContain('Интернет не открывай');
      expect(prompt).not.toContain('открой сайт');
      expect(prompt).not.toContain('используй интернет');
      expect(prompt).not.toContain('web_search');
      expect(prompt).not.toContain('ровно 11');
      expect(prompt).not.toContain('Проверь категории:');
      expect(prompt).not.toContain('report_markdown');
      expect(prompt).not.toContain('ЧТО НЕ НУЖНО ПРОВЕРЯТЬ');
      expect(prompt).not.toContain('ПРАВИЛА АНАЛИЗА');
      expect(prompt).not.toContain('Этот вызов страницу не загружает');
    }
    expect(prompts[0]).toContain('язык основного текста');
    expect(prompts[0]).not.toContain('ПРОВЕРКА ТЕЛЕФОННОГО КОДА');
    expect(prompts[1]).toContain('outlet_header');
    expect(prompts[1]).toContain('отсутствие кадра ошибкой не считай');
    expect(prompts[1]).toContain('Кадры приложены в этом вызове в порядке attachments_order, после текста.');
    expect(prompts[1]).toContain('visual_observations');
    expect(prompts[1]).not.toContain('вложенные кадры');
    expect(prompts[1]).toContain(OFFLINE_PHRASE[2]);
    expect(prompts[1]).not.toContain('Ссылку сам не открывай');
    expect(prompts[2]).toContain('fact_sheet.person');
    expect(prompts[2]).toContain('fact_sheet.person.extract');
    expect(prompts[2]).toContain('Прямое противоречие extract');
    expect(prompts[2]).toContain('сводками поиска');
    expect(prompts[2]).toContain(OFFLINE_PHRASE[3]);
    expect(prompts[2]).toContain('guest_refs');
    expect(prompts[2]).toContain('visual_observations');
    expect(prompts[2]).toContain('Кадры приложены в этом вызове в порядке attachments_order, после текста.');
    expect(prompts[2]).toContain('Возраст, пол и должность без карточки не подтверждай и не опровергай.');
    expect(prompts[2]).not.toContain('image_checks');
    expect(prompts[2]).toContain('Пустая карточка не запрещает');
    expect(prompts[2]).toContain('не означает, что человека нет');
    expect(prompts[2]).toContain('гостя интервью');
    expect(prompts[3]).toContain('Иностранное происхождение');
    expect(prompts[3]).toContain('Википедии или поиском до вызова');
    expect(prompts[3]).toContain('citizenship, description и extract');
    expect(prompts[3]).toContain('Пустой fact_sheet не запрещает');
    expect(prompts[3]).toContain(OFFLINE_PHRASE[4]);
    expect(prompts[3]).not.toContain('image_checks');
    expect(prompts[4]).toContain('PLN');
    expect(prompts[4]).not.toContain('185–215');
    expect(prompts[4]).toContain('нарисованные на приложенном кадре контента');
    expect(prompts[4]).toContain('упоминание этого факта');
    expect(prompts[4]).toContain('только валюту депозита');
    expect(prompts[4]).toContain('суди только по page_text');
    expect(prompts[4]).toContain('не выдумывай содержимое изображений');
    expect(prompts[4]).toContain('Нет кадров контента у пункта 5');
    expect(prompts[4]).toContain('screenshot_ref — короткая метка места на странице, не описание изображения, никогда не base64');
    expect(prompts[4]).not.toContain('метка из attachments_order');
    expect(prompts[4]).toContain('Когда attachments_order не пуст, кадры контента приложены после текста');
    expect(prompts[4]).toContain('не переноси в пункт 10');
    expect(prompts[4]).toContain('не копируй сюда поиск противоречий');
    expect(prompts[4]).toContain('visual_observations');
    expect(prompts[5]).toContain('185–215');
    expect(prompts[5]).toContain('fx_rates');
    expect(prompts[5]).not.toContain('PLN');
    expect(prompts[5]).toContain('нарисованные на приложенном кадре контента');
    expect(prompts[5]).toContain('упоминание этого факта');
    expect(prompts[5]).toContain('только сумму депозита');
    expect(prompts[5]).toContain('суди только по page_text');
    expect(prompts[5]).toContain('Нет кадров контента у пункта 6');
    expect(prompts[5]).toContain('screenshot_ref — короткая метка места на странице, не описание изображения, никогда не base64');
    expect(prompts[5]).not.toContain('метка из attachments_order');
    expect(prompts[5]).toContain('Когда attachments_order не пуст, кадры контента приложены после текста');
    expect(prompts[5]).toContain('не переноси в пункт 10');
    expect(prompts[6]).toContain('Quifix');
    expect(prompts[6]).toContain('нарисованные на приложенном кадре контента');
    expect(prompts[6]).toContain('упоминание этого факта');
    expect(prompts[6]).toContain('только название оффера');
    expect(prompts[6]).toContain('суди только по page_text');
    expect(prompts[6]).toContain('Нет кадров контента у пункта 7');
    expect(prompts[6]).toContain('screenshot_ref — короткая метка места на странице, не описание изображения, никогда не base64');
    expect(prompts[6]).not.toContain('метка из attachments_order');
    expect(prompts[6]).toContain('Когда attachments_order не пуст, кадры контента приложены после текста');
    expect(prompts[6]).toContain('не переноси в пункт 10');
    for (const index of [0, 1, 2, 3, 7, 8, 9, 10]) {
      expect(prompts[index]).not.toContain('нарисованные на приложенном кадре контента');
    }
    expect(prompts[7]).toContain('check_date');
    expect(prompts[8]).toContain('Заглушка');
    expect(prompts[8]).toContain('Кадры приложены в этом вызове в порядке attachments_order, после текста.');
    expect(prompts[8]).not.toContain('image_checks');
    expect(prompts[9]).toContain('подпись');
    expect(prompts[9]).toContain('Кадры приложены в этом вызове в порядке attachments_order, после текста.');
    expect(prompts[0]).not.toContain('visual_observations');
    expect(prompts[3]).not.toContain('visual_observations');
    expect(prompts[10]).toContain('+48');
    expect(prompts[10]).toContain('существует ли номер');
    for (const category of [2, 3, 4]) {
      const phrase = OFFLINE_PHRASE[category];
      expect(prompts.filter((prompt) => prompt.includes(phrase))).toEqual([prompts[category - 1]]);
    }
    const tasks = prompts.map(taskBody);
    expect(new Set(tasks.map((body) => body.replace(/\d+/g, '#'))).size).toBe(QA_CATEGORY_COUNT);
    const sharedLines: string[] = [];
    tasks.forEach((body, index) => {
      const lines = body.split('\n').map((line) => line.trim()).filter((line) => line.length > 40);
      for (const line of lines) {
        prompts.forEach((prompt, other) => {
          if (other !== index && prompt.includes(line)) sharedLines.push(`${index + 1}→${other + 1}: ${line}`);
        });
      }
    });
    expect(sharedLines).toEqual([]);
    for (let category = 1; category <= QA_CATEGORY_COUNT; category += 1) {
      expect(prompts[category - 1]).toContain(`Ответ пункта ${category}. ${QA_CATEGORY_TITLES[category]}.`);
    }
  });

  it('pins Russian notes once in every category prompt and leaves page quotes in the landing language', () => {
    const sentence =
      'Пиши по-русски note, clarifications, where, problem, expected и словесные значения general (страна, название языка, издание, человек, оффер), при этом quote оставляй дословной подстрокой page_text на исходном языке, а имена, суммы, коды валют и телефонные коды оставляй как на странице и сам лендинг не переводи.';
    for (let category = 1; category <= QA_CATEGORY_COUNT; category += 1) {
      const prompt = categorySystemPrompt(category);
      const at = prompt.indexOf(sentence);
      expect(at).toBe(prompt.lastIndexOf(sentence));
      expect(at).not.toBe(-1);
    }
  });
});

describe('vision attachments', () => {
  it('sends page frames to header, person, comment and consistency checks, and content frames to deposit and offer checks', () => {
    expect(VISION_CATEGORIES).toEqual([2, 3, 5, 6, 7, 9, 10]);
    for (let category = 1; category <= 11; category += 1) {
      const labels = attachmentLabels(category, order, kinds);
      if (category === 5 || category === 6 || category === 7) {
        expect(categoryUsesVision(category)).toBe(true);
        expect(labels).toEqual(['I1']);
      } else {
        expect(labels.length > 0).toBe(categoryUsesVision(category));
      }
    }
    expect(attachmentLabels(2, order, kinds)).toEqual(['preview', 'preview_2', 'outlet_header', 'outlet_footer']);
    expect(attachmentLabels(3, order, kinds)).toEqual(['preview', 'preview_2', 'I1']);
    expect(attachmentLabels(9, order, kinds)).toEqual(['desktop', 'preview', 'preview_2', 'landing_footer', 'I2']);
    expect(attachmentLabels(10, order, kinds)).toEqual(['desktop', 'preview', 'preview_2', 'landing_footer', 'I1', 'I2']);
    expect(attachmentLabels(2, ['landing_footer', 'outlet_header', 'outlet_footer'], kinds)).toEqual([
      'landing_footer',
      'outlet_header',
      'outlet_footer',
    ]);
    expect(attachmentLabels(5, order, kinds)).toEqual(['I1']);
    expect(attachmentLabels(6, order, kinds)).toEqual(['I1']);
    expect(attachmentLabels(7, order, kinds)).toEqual(['I1']);
    expect(attachmentLabels(6, ['I2', 'desktop', 'preview', 'I1', 'I3'], { content: ['I1', 'I3'], comment: ['I2'] })).toEqual([
      'I1',
      'I3',
    ]);
    const commentOnly = { content: [], comment: ['I1', 'I2'] };
    for (const category of [5, 6, 7]) {
      expect(categoryUsesVision(category)).toBe(true);
      expect(attachmentLabels(category, order, commentOnly)).toEqual([]);
      expect(attachmentLabels(category, ['desktop', 'preview', 'landing_footer', 'outlet_header', 'outlet_footer'], kinds)).toEqual(
        [],
      );
    }
    for (const category of [1, 4, 8, 11]) {
      expect(categoryUsesVision(category)).toBe(false);
      expect(attachmentLabels(category, order, kinds)).toEqual([]);
    }
  });
});

describe('vision observations become category 3 image checks', () => {
  const celebrity = 'Andrzej Duda';

  it('keeps a vision verdict and drops frames that are not part of the check', () => {
    expect(
      imageChecksFromObservations({
        observations: [
          { ref: 'I1', visible_text: '', visible_name: 'Другой', face_visible: true, person_match: 'mismatch', note: 'другой' },
          { ref: 'preview', visible_text: 'шапка', visible_name: 'Andrzej Duda', face_visible: true, person_match: 'match', note: 'он' },
          { ref: 'I2', visible_text: '', visible_name: '', face_visible: true, person_match: 'mismatch', note: 'аватар' },
          { ref: 'preview_2', visible_text: '', visible_name: '', face_visible: false, note: 'без лица' },
          { ref: 'desktop', visible_text: 'логотип', visible_name: '', face_visible: false, person_match: 'uncertain', note: 'шапка' },
        ],
        guestRefs: [],
        celebrityName: celebrity,
        claimedRefs: ['I1'],
        previewRefs: ['preview', 'preview_2'],
      }),
    ).toEqual([
      { ref: 'I1', match: 'mismatch', note: 'другой' },
      { ref: 'preview', match: 'match', note: 'он' },
    ]);
  });

  it('softens a guest mismatch or uncertain to match unless the visible name is the celebrity', () => {
    const mismatch = {
      ref: 'I1',
      visible_text: '',
      face_visible: true as const,
      person_match: 'mismatch' as const,
      note: 'чужой',
    };
    expect(
      imageChecksFromObservations({
        observations: [{ ...mismatch, visible_name: 'Марта Гость' }],
        guestRefs: [' I1 '],
        celebrityName: celebrity,
        claimedRefs: ['I1'],
        previewRefs: [],
      }),
    ).toEqual([{ ref: 'I1', match: 'match', note: 'чужой' }]);
    expect(
      imageChecksFromObservations({
        observations: [{ ref: 'preview', visible_text: '', visible_name: '', face_visible: false, person_match: 'uncertain', note: 'лица нет' }],
        guestRefs: ['preview'],
        celebrityName: celebrity,
        claimedRefs: [],
        previewRefs: ['preview'],
      }),
    ).toEqual([{ ref: 'preview', match: 'match', note: 'лица нет' }]);
    expect(
      imageChecksFromObservations({
        observations: [{ ...mismatch, visible_name: '  ANDRZEJ   duda ' }],
        guestRefs: ['I1'],
        celebrityName: celebrity,
        claimedRefs: ['I1'],
        previewRefs: [],
      }),
    ).toEqual([{ ref: 'I1', match: 'mismatch', note: 'чужой' }]);
    expect(
      imageChecksFromObservations({
        observations: [{ ...mismatch, visible_name: '' }],
        guestRefs: ['I1'],
        celebrityName: celebrity,
        claimedRefs: ['I1'],
        previewRefs: [],
      }),
    ).toEqual([{ ref: 'I1', match: 'match', note: 'чужой' }]);
  });

  it('reads only labeled frames and does not recognize a face when the land names nobody', () => {
    expect(readGuestRefs({ guest_refs: [' I1 ', 'I1', '', 3] })).toEqual(['I1']);
    expect(readGuestRefs({})).toEqual([]);
    expect(readGuestRefs({ guest_refs: 'I1' })).toEqual([]);
    expect(
      parseVisualObservations(
        {
          observations: [
            { ref: 'I1', visible_text: 'шапка', visible_name: '', face_visible: false, person_match: 'match', note: 'далеко' },
            { ref: 'NOPE', visible_text: 'чужая метка', visible_name: '', face_visible: true, person_match: 'mismatch', note: '' },
          ],
        },
        ['I1'],
        celebrity,
      ),
    ).toEqual([
      { ref: 'I1', visible_text: 'шапка', visible_name: '', face_visible: false, person_match: 'uncertain', note: 'далеко' },
    ]);
    const unnamed = parseVisualObservations(
      {
        observations: [
          {
            ref: 'I1',
            visible_text: 'без визуального осмотра',
            visible_name: 'Имя',
            face_visible: true,
            person_match: 'mismatch',
            note: 'видно без визуального осмотра',
          },
        ],
      },
      ['I1'],
      '',
    );
    expect(unnamed).toEqual([{ ref: 'I1', visible_text: '', visible_name: 'Имя', face_visible: true, note: 'видно' }]);
    expect(unnamed[0].person_match).toBeUndefined();
    expect(() => parseVisualObservations({ note: 'пусто' }, ['I1'], celebrity)).toThrow(SyntaxError);
  });
});

describe('category merge', () => {
  const pageText = 'Andrzej Duda speaks. Minimum deposit 250 PLN.';

  it('downgrades FAIL without a finding and stamps the requested category', () => {
    const mapped = mapCategoryResponse(
      5,
      {
        status: 'FAIL',
        note: 'валюта',
        findings: [{ file: 'index.html', quote: 'made up', screenshot_ref: 'page', category: 9 }],
      },
      { pageText },
    );
    expect(mapped.accepted).toBe(true);
    expect(mapped.result.findings).toEqual([]);
    expect(mapped.result.report?.checks).toEqual([
      { category: 5, status: 'N/A', note: 'валюта (нет подтверждённой находки)' },
    ]);
  });

  it('rejects a body with no status', () => {
    expect(mapCategoryResponse(8, { findings: [{ file: 'a.html', quote: 'q', screenshot_ref: 'page' }] }, { pageText: '' }).accepted).toBe(
      false,
    );
  });

  it('fills every category, keeps a gap visible, and does not let markdown override checks', () => {
    const parts = Array.from({ length: 11 }, (_, index) => {
      const category = index + 1;
      if (category === 8) return { category, accepted: false as const };
      const mapped = mapCategoryResponse(
        category,
        category === 6
          ? {
              status: 'FAIL',
              note: 'сумма',
              general: { min_deposit: '250 PLN', geo: 'не отсюда' },
              findings: [
                {
                  file: 'index.html',
                  quote: 'Minimum deposit 250 PLN',
                  screenshot_ref: 'page',
                  priority: 'major',
                  problem: 'вне диапазона',
                  expected: 'около 250 USD',
                  where: 'абзац',
                },
              ],
            }
          : { status: 'PASS', note: 'ок', general: category === 1 ? { geo: 'Польша' } : {} },
        { pageText },
      );
      return { category, accepted: true, result: mapped.result, imageChecks: mapped.imageChecks };
    });
    const merged = mergeCategoryParts(parts, { pageText, checkDate: '2026-10-26' });
    expect(merged.report?.checks).toHaveLength(11);
    expect(merged.report?.checks?.find((check) => check.category === 8)).toEqual({ category: 8, status: 'GAP', note: GAP_NOTE });
    expect(merged.report?.checks?.find((check) => check.category === 6)?.status).toBe('FAIL');
    expect(merged.report?.general).toEqual({ geo: 'Польша', min_deposit: '250 PLN' });
    expect(merged.report?.clarifications).toEqual([gapClarification(8)]);
    const markdown = merged.report?.report_markdown ?? '';
    expect(markdown).toContain('GEO: Польша');
    expect(markdown).toContain('Дата проверки: 2026-10-26');
    expect(markdown).toContain('8. Актуальность дат: НЕ ВЫПОЛНЕНО.');
    expect(markdown).toContain('6. Размер минимального депозита: FAIL.');
    expect(markdown).toContain('Обнаружено: Minimum deposit 250 PLN');
    expect(markdown).not.toMatch(/Общий результат/);
    expect(markdown).toContain('Не выполнено: 1.');
    expect(merged.findings.map((finding) => finding.category)).toEqual([6]);
  });

  it('still applies image and avatar rules to the merged report', () => {
    const shot = 'data:image/png;base64,QQ';
    const parts = Array.from({ length: 11 }, (_, index) => {
      const category = index + 1;
      const body =
        category === 3
          ? { status: 'PASS', note: 'ок', image_checks: [{ ref: 'I1', match: 'mismatch', note: 'другой человек' }] }
          : { status: 'PASS', note: 'ок' };
      const mapped = mapCategoryResponse(category, body, { pageText, screenshots: { I1: shot } });
      return { category, accepted: true, result: mapped.result, imageChecks: mapped.imageChecks };
    });
    const avatar: CommentAvatarOccurrence = {
      file: 'index.html',
      name: 'Anna',
      nameKey: 'anna',
      photoKey: 'same',
      placeholder: false,
      screenshot: shot,
    };
    const other: CommentAvatarOccurrence = { ...avatar, name: 'Tomasz', nameKey: 'tomasz' };
    const merged = mergeCategoryParts(parts, {
      pageText,
      screenshots: { I1: shot },
      images: [
        {
          ref: 'I1',
          file: 'images/hero.png',
          alt: '',
          caption: '',
          context: 'Andrzej Duda speaks',
          claims_person: 'Andrzej Duda',
        },
      ],
      commentAvatars: [avatar, other],
    });
    expect(merged.findings.map((finding) => finding.category).sort()).toEqual([3, 9]);
    expect(merged.findings.find((finding) => finding.category === 3)?.file).toBe('index.html');
    expect(merged.report?.checks?.find((check) => check.category === 3)?.status).toBe('FAIL');
    expect(merged.report?.checks?.find((check) => check.category === 9)?.status).toBe('FAIL');
    expect(merged.report?.report_markdown).toContain('3. Данные главного персонажа: FAIL.');
    expect(merged.report?.report_markdown).toContain('9. Комментарии: FAIL.');
  });

  it('keeps a text FAIL when this call has no frames', () => {
    const pageText = 'Заполните форму и укажите телефон.';
    const screenshots = { desktop: 'data:image/jpeg;base64,DESKTOP' };
    for (const category of [1, 6, 8, 11]) {
      const mapped = mapCategoryResponse(
        category,
        {
          status: 'FAIL',
          findings: [{ file: 'index.html', quote: 'форму', screenshot_ref: 'форма' }],
        },
        { pageText, screenshots, attachmentLabels: [] },
      );
      expect(mapped.accepted).toBe(true);
      expect(mapped.result.findings).toEqual([{ file: 'index.html', quote: 'форму', screenshot: 'форма', category }]);
      expect(mapped.result.report?.checks).toEqual([{ category, status: 'FAIL' }]);
    }
    const invented = mapCategoryResponse(
      1,
      { status: 'FAIL', findings: [{ file: 'index.html', quote: 'этого нет на странице', screenshot_ref: 'форма' }] },
      { pageText, attachmentLabels: [] },
    );
    expect(invented.result.findings).toEqual([]);
    expect(invented.result.report?.checks).toEqual([{ category: 1, status: 'N/A', note: 'Нет подтверждённой находки' }]);
    const blob = 'A'.repeat(120);
    const dropped = mapCategoryResponse(
      8,
      {
        status: 'FAIL',
        findings: [
          { file: 'index.html', quote: 'форму', screenshot_ref: 'data:image/png;base64,QQ' },
          { file: 'index.html', quote: 'форму', screenshot_ref: blob },
          { file: 'index.html', quote: 'форму', screenshot_ref: 'outlet_footer' },
          { file: 'index.html', quote: 'форму', screenshot_ref: '' },
        ],
      },
      { pageText, screenshots, attachmentLabels: [] },
    );
    expect(dropped.result.findings).toEqual([]);
    expect(dropped.result.report?.checks).toEqual([{ category: 8, status: 'N/A', note: 'Нет подтверждённой находки' }]);
  });

  it('drops a screenshot_ref outside this call and keeps a listed label as a data URL', () => {
    const pageText = 'Minimum deposit 250 PLN.';
    const shot = 'data:image/png;base64,QQ';
    const quote = 'Minimum deposit 250 PLN';
    const missing = mapCategoryResponse(
      6,
      { status: 'FAIL', findings: [{ file: 'index.html', quote, screenshot_ref: 'desktop' }] },
      { pageText, attachmentLabels: ['I1'], screenshots: { I1: shot, desktop: 'data:image/jpeg;base64,DD' } },
    );
    expect(missing.result.findings).toEqual([]);
    expect(missing.result.report?.checks).toEqual([{ category: 6, status: 'N/A', note: 'Нет подтверждённой находки' }]);
    const outlet = mapCategoryResponse(
      2,
      { status: 'FAIL', findings: [{ file: 'index.html', quote, screenshot_ref: 'outlet_header' }] },
      { pageText, attachmentLabels: ['preview', 'outlet_header'], screenshots: { preview: shot } },
    );
    expect(outlet.result.findings).toEqual([]);
    expect(outlet.result.report?.checks).toEqual([{ category: 2, status: 'N/A', note: 'Нет подтверждённой находки' }]);
    const kept = mapCategoryResponse(
      6,
      { status: 'FAIL', findings: [{ file: 'index.html', quote, screenshot_ref: 'I1' }] },
      { pageText, attachmentLabels: ['I1'], screenshots: { I1: shot, desktop: 'data:image/jpeg;base64,DD' } },
    );
    expect(kept.result.findings).toEqual([{ file: 'index.html', quote, screenshot: shot, category: 6 }]);
    expect(kept.result.report?.checks).toEqual([{ category: 6, status: 'FAIL' }]);
  });

  it('leaves N/A with no finding as N/A', () => {
    const cases: Array<[number, string]> = [
      [5, 'Депозита на странице нет'],
      [8, 'Актуальные даты не найдены'],
      [11, 'Поля телефона нет'],
    ];
    for (const [category, note] of cases) {
      const mapped = mapCategoryResponse(
        category,
        { status: 'N/A', note, findings: [] },
        { pageText: 'текст без депозита и дат', attachmentLabels: [] },
      );
      expect(mapped.accepted).toBe(true);
      expect(mapped.result.findings).toEqual([]);
      expect(mapped.result.report?.checks).toEqual([{ category, status: 'N/A', note }]);
    }
  });
});

const CRITERION_HEADERS = [
  '1. ОПРЕДЕЛЕНИЕ GEO',
  '2. ПРОВЕРКА НОВОСТНОГО ИЗДАНИЯ',
  '3. ПРОВЕРКА ГЛАВНОГО ПЕРСОНАЖА',
  '4. СООТВЕТСТВИЕ ПЕРСОНАЖА GEO',
  '5. ПРОВЕРКА МИНИМАЛЬНОГО ДЕПОЗИТА',
  '6. ПРОВЕРКА ЕДИНОГО ОФФЕРА',
  '7. ПРОВЕРКА ДАТ',
  '8. ПРОВЕРКА КОММЕНТАРИЕВ',
  '9. ВНУТРЕННЯЯ СОГЛАСОВАННОСТЬ КОНТЕНТА',
  '10. ПРОВЕРКА ТЕЛЕФОННОГО КОДА',
];

const OWN_HEADER: Record<number, string> = {
  1: CRITERION_HEADERS[0],
  2: CRITERION_HEADERS[1],
  3: CRITERION_HEADERS[2],
  4: CRITERION_HEADERS[3],
  5: CRITERION_HEADERS[4],
  6: CRITERION_HEADERS[4],
  7: CRITERION_HEADERS[5],
  8: CRITERION_HEADERS[6],
  9: CRITERION_HEADERS[7],
  10: CRITERION_HEADERS[8],
  11: CRITERION_HEADERS[9],
};

const BROWSE_ASKS = [
  'web_search',
  'открой сайт',
  'найди официальный сайт',
  'используй интернет',
  'Если доступен интернет',
  'по надёжным открытым источникам',
];

const OUTLET_SENTENCE = 'Если доступен интернет, найди официальный сайт соответствующего издания.';

describe('per-category instructions', () => {
  const instructions = Array.from({ length: QA_CATEGORY_COUNT }, (_, index) => categoryInstruction(index + 1));

  it('builds 11 texts, each with only its own criterion and no copied block', () => {
    expect(new Set(instructions).size).toBe(QA_CATEGORY_COUNT);
    const banned = ['ТВОЯ РОЛЬ', 'ЧТО НЕ НУЖНО ПРОВЕРЯТЬ', 'ПРАВИЛА АНАЛИЗА', 'ФОРМАТ QA-ОТЧЁТА', 'Проверь категории:'];
    let longest = '';
    let pair = '';
    for (let category = 1; category <= QA_CATEGORY_COUNT; category += 1) {
      const text = instructions[category - 1];
      const title = QA_CATEGORY_TITLES[category];
      expect(text.startsWith('ИНСТРУКЦИЯ\n')).toBe(true);
      expect(text).toContain(`Этот вызов проверяет только пункт ${category}. ${title}. Другие пункты чеклиста не выполняй.`);
      if (category !== 5 && category !== 6) expect(text).toContain(OWN_HEADER[category]);
      for (const header of CRITERION_HEADERS) {
        if (header === OWN_HEADER[category]) continue;
        expect(text).not.toContain(header);
      }
      for (const phrase of banned) expect(text).not.toContain(phrase);
      for (const phrase of BROWSE_ASKS) expect(text).not.toContain(phrase);
      for (let other = category + 1; other <= QA_CATEGORY_COUNT; other += 1) {
        const shared = longestCommonSubstring(text, instructions[other - 1]);
        if (shared.length > longest.length) {
          longest = shared;
          pair = `${category}-${other}`;
        }
      }
    }
    if (longest.length >= 80) {
      throw new Error(`instructions ${pair} share ${longest.length} characters: ${JSON.stringify(longest)}`);
    }
    expect(longest.length).toBeLessThan(80);
  });

  it('keeps amount ranges out of point 5 and the currency block out of point 6', () => {
    const currency = categoryInstruction(5);
    const amount = categoryInstruction(6);
    expect(currency).not.toContain('Найди все упоминания минимального депозита');
    expect(currency).toContain('УСЛОВИЕ №1: ВАЛЮТА');
    expect(currency).toContain('Германия: EUR.');
    expect(currency).not.toContain('УСЛОВИЕ №2');
    expect(currency).not.toContain('185\u2013215');
    expect(currency).not.toContain('200 USD');
    expect(currency).not.toContain('USD');
    expect(amount).not.toContain('Найди все упоминания минимального депозита');
    expect(amount).toContain('УСЛОВИЕ №2: СУММА');
    expect(amount).toContain('185\u2013215 USD.');
    expect(amount).toContain('235\u2013265 USD.');
    expect(amount).toContain('285\u2013315 USD.');
    expect(amount).toContain('200 USD');
    expect(QA_INSTRUCTION).toContain('Для проверки используй актуальный валютный курс.');
    expect(QA_INSTRUCTION).toContain('Переведи указанную сумму в USD и сравни с допустимыми диапазонами.');
    expect(amount).toContain('fx_rates.rates[код] — сколько единиц валюты даёт 1 USD на fx_rates.date.');
    expect(amount).toContain('Эквивалент = локальная сумма / rates[код].');
    expect(amount).toContain('Нет fx_rates или нет кода валюты в rates — N/A.');
    expect(amount).toContain('Свой курс не подставляй и приближение не выдавай за расчёт.');
    expect(amount).not.toContain('Для проверки используй актуальный валютный курс.');
    expect(amount).not.toContain('Переведи указанную сумму в USD и сравни с допустимыми диапазонами.');
    expect(currency).not.toContain('Для проверки используй актуальный валютный курс.');
    expect(currency).not.toContain('Переведи указанную сумму в USD');
    expect(currency).not.toContain('fx_rates');
    expect(amount).toContain('согласуются между собой.');
    expect(amount).not.toContain('УСЛОВИЕ №1: ВАЛЮТА');
    expect(amount).not.toContain('Германия: EUR.');
  });

  it('does not ask points 2–4 to open the internet', () => {
    for (const category of [2, 3, 4]) {
      const sent = categorySystemMessage(category);
      expect(sent).toContain('ИНСТРУКЦИЯ');
      expect(sent).toContain(categorySystemPrompt(category));
      for (const phrase of BROWSE_ASKS) expect(sent).not.toContain(phrase);
    }
    const header = categoryInstruction(2);
    expect(header).toContain(
      'Кадров оригинала в этом вызове может не быть. Если outlet_header или outlet_footer не приложены, укажи «Не удалось проверить» и не ставь ошибку. Сайт из этого вызова не открывается.\n\nСравни предоставленные скриншоты с оригинальным оформлением.',
    );
    expect(header).toContain('Шапку сайта (header).');
    expect(header).not.toContain(OUTLET_SENTENCE);
    const person = categoryInstruction(3);
    expect(person).toContain('Если это реальная публичная личность, fact_sheet.person:\n\n1. Правильность написания имени и фамилии.');
    expect(person).toContain('Не определяй личность человека исключительно по его фотографии.');
  });

  it('places the instruction, then the unchanged category prompt', () => {
    for (let category = 1; category <= QA_CATEGORY_COUNT; category += 1) {
      const instruction = categoryInstruction(category);
      const prompt = categorySystemPrompt(category);
      expect(categorySystemMessage(category)).toBe(`${instruction}\n\nПРОМПТ\n\n${prompt}`);
    }
    expect(() => categoryInstruction(0)).toThrow('unknown category 0');
    expect(() => categorySystemMessage(12)).toThrow('unknown category 12');
  });
});

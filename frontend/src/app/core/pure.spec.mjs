import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  completeAiCard,
  errorText,
  formatMetric,
  isImageSource,
  lighthouseImageSrc,
  qaCategoryLabel,
  qaPriorityText,
  qaStatusText,
  shouldPoll,
} from './format.ts';
import { ACCESS_DENIED } from './models.ts';

describe('shouldPoll', () => {
  it('keeps polling when a non-report step failed and the report is still pending', () => {
    assert.equal(
      shouldPoll([
        { name: 'download_file', state: 'failed' },
        { name: 'unpack', state: 'pending' },
        { name: 'report', state: 'pending' },
      ]),
      true,
    );
  });

  it('keeps polling while a step is running, retrying, waiting, or pending', () => {
    assert.equal(
      shouldPoll([
        { name: 'lighthouse', state: 'failed' },
        { name: 'ai', state: 'running' },
        { name: 'report', state: 'pending' },
      ]),
      true,
    );
    assert.equal(
      shouldPoll([
        { name: 'static', state: 'done' },
        { name: 'ai_gate', state: 'waiting_user' },
        { name: 'report', state: 'pending' },
      ]),
      true,
    );
  });

  it('stops when the report is done or failed', () => {
    assert.equal(
      shouldPoll([
        { name: 'download_file', state: 'failed' },
        { name: 'report', state: 'done' },
      ]),
      false,
    );
    assert.equal(
      shouldPoll([
        { name: 'lighthouse', state: 'failed' },
        { name: 'report', state: 'failed' },
      ]),
      false,
    );
  });

  it('stops when nothing left can change', () => {
    assert.equal(
      shouldPoll([
        { name: 'download_file', state: 'failed' },
        { name: 'report', state: 'skipped' },
      ]),
      false,
    );
  });
});

describe('errorText', () => {
  it('translates an ended session', () => {
    assert.equal(
      errorText({ status: 401, error: { error: 'unauthorized' } }, 'запасной'),
      'Сессия закончилась. Войдите снова.',
    );
    assert.equal(errorText({ status: 500, error: { error: 'unauthorized' } }, 'запасной'), 'Сессия закончилась. Войдите снова.');
  });

  it('keeps the access-denied wording for 403', () => {
    assert.equal(errorText({ status: 403, error: { error: 'forbidden', message: 'nope' } }, 'запасной'), ACCESS_DENIED);
  });

  it('scrubs a signed url and falls back otherwise', () => {
    assert.equal(errorText({ status: 500, error: { message: 'see https://x.test/a?signature=1' } }, 'запасной'), 'see [ссылка скрыта]');
    assert.equal(errorText({ status: 500 }, 'запасной'), 'запасной');
  });
});

describe('isImageSource', () => {
  it('accepts data urls and image extensions only', () => {
    assert.equal(isImageSource('data:image/png;base64,abc'), true);
    assert.equal(isImageSource('https://cdn.example/shot.png'), true);
    assert.equal(isImageSource('https://cdn.example/shot.jpg?x=1'), true);
    assert.equal(isImageSource('https://cdn.example/file?signature=abc'), false);
    assert.equal(isImageSource('https://cdn.example/page'), false);
  });
});

describe('lighthouseImageSrc', () => {
  it('shows a data url even when the payload contains a signed-url marker', () => {
    const shot = 'data:image/jpeg;base64,signature=expires=';
    assert.equal(lighthouseImageSrc(shot), shot);
  });

  it('wraps raw image base64 and unwraps a screenshot object', () => {
    assert.equal(lighthouseImageSrc('/9j/4AAQ'), 'data:image/jpeg;base64,/9j/4AAQ');
    assert.equal(lighthouseImageSrc('_9j_4AAQ'), 'data:image/jpeg;base64,/9j/4AAQ');
    assert.equal(
      lighthouseImageSrc({ data: 'iVBORw0KGgoAAA', width: 12, height: 20 }),
      'data:image/png;base64,iVBORw0KGgoAAA',
    );
  });

  it('accepts a blob or http url without an image extension and skips a signed url', () => {
    assert.equal(lighthouseImageSrc('blob:http://localhost/8b1c'), 'blob:http://localhost/8b1c');
    assert.equal(lighthouseImageSrc('https://stand.local/lighthouse/mobile'), 'https://stand.local/lighthouse/mobile');
    assert.equal(lighthouseImageSrc('https://cdn.example/file?signature=abc'), null);
  });

  it('leaves an empty screenshot empty', () => {
    assert.equal(lighthouseImageSrc(null), null);
    assert.equal(lighthouseImageSrc(''), null);
    assert.equal(lighthouseImageSrc('нет снимка'), null);
  });
});

describe('qa report labels', () => {
  it('maps category numbers to Russian labels', () => {
    assert.equal(qaCategoryLabel(1), 'GEO и локализация');
    assert.equal(qaCategoryLabel(2), 'Соответствие шапки и футера оригиналу');
    assert.equal(qaCategoryLabel(3), 'Данные главного персонажа');
    assert.equal(qaCategoryLabel(4), 'Соответствие персонажа GEO');
    assert.equal(qaCategoryLabel(5), 'Валюта минимального депозита');
    assert.equal(qaCategoryLabel(6), 'Размер минимального депозита');
    assert.equal(qaCategoryLabel(7), 'Единство оффера');
    assert.equal(qaCategoryLabel(8), 'Актуальность дат');
    assert.equal(qaCategoryLabel(9), 'Комментарии');
    assert.equal(qaCategoryLabel(10), 'Внутренняя согласованность контента');
    assert.equal(qaCategoryLabel(11), 'Телефонный код формы');
    assert.equal(qaCategoryLabel(99), 'Критерий 99');
  });

  it('maps statuses and priorities to display text', () => {
    assert.equal(qaStatusText('PASS'), 'проверено, ошибок нет');
    assert.equal(qaStatusText('FAIL'), 'подтверждена ошибка');
    assert.equal(qaStatusText('N/A'), 'проверить нельзя');
    assert.equal(qaStatusText('other'), 'other');
    assert.equal(qaPriorityText('critical'), 'Critical');
    assert.equal(qaPriorityText('major'), 'Major');
    assert.equal(qaPriorityText('minor'), 'Minor');
  });
});

describe('completeAiCard', () => {
  it('requires path, quote and screenshot', () => {
    assert.deepEqual(completeAiCard({ path: 'a.html', quote: 'q', screenshot: 'data:image/png;base64,x' }), {
      path: 'a.html',
      quote: 'q',
      screenshot: 'data:image/png;base64,x',
    });
    assert.equal(completeAiCard({ path: 'a.html', quote: 'q' }), null);
    assert.equal(completeAiCard({ path: 'a.html', quote: ' ', screenshot: 's' }), null);
    assert.equal(completeAiCard({ quote: 'q', screenshot: 's' }), null);
    assert.equal(completeAiCard({ file: 'a.html', quote: 'q', screenshot: 'plain text' })?.path, 'a.html');
  });
});

describe('formatMetric', () => {
  it('shows a score as a percent and timings with a unit', () => {
    assert.equal(formatMetric(0.62, 'performance_score'), '62%');
    assert.equal(formatMetric(0, 'performance_score'), '0%');
    assert.equal(formatMetric(1800, 'first_contentful_paint'), '1.8 с');
    assert.equal(formatMetric(180, 'total_blocking_time'), '180 мс');
    assert.equal(formatMetric(0.08, 'cumulative_layout_shift'), '0.08');
  });

  it('uses a visible empty value', () => {
    assert.equal(formatMetric(null, 'speed_index'), 'нет данных');
    assert.equal(formatMetric(Number.NaN, 'performance_score'), 'нет данных');
    assert.equal(formatMetric(undefined), 'нет данных');
  });
});

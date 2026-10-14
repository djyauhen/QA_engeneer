import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { errorText, formatMetric, isImageSource, shouldPoll } from './format.ts';
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

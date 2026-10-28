import { parseLighthouse } from './lighthouse';

function report(body: { audits?: Record<string, unknown>; fullPageScreenshot?: unknown }): string {
  return JSON.stringify({
    categories: { performance: { score: 1 } },
    audits: {
      'first-contentful-paint': { numericValue: 1400 },
      ...(body.audits ?? {}),
    },
    ...(body.fullPageScreenshot !== undefined ? { fullPageScreenshot: body.fullPageScreenshot } : {}),
  });
}

describe('parseLighthouse screenshot', () => {
  it('keeps a data url and the numeric metrics', () => {
    const shot = 'data:image/jpeg;base64,/9j/signature=';
    const parsed = parseLighthouse(
      report({
        audits: { 'final-screenshot': { details: { data: shot } } },
      }),
    );
    expect(parsed.screenshot).toBe(shot);
    expect(parsed.performance_score).toBe(1);
    expect(parsed.first_contentful_paint).toBe(1400);
  });

  it('wraps raw base64 from final-screenshot', () => {
    const parsed = parseLighthouse(
      report({
        audits: { 'final-screenshot': { details: { data: '/9j/4AAQ' } } },
      }),
    );
    expect(parsed.screenshot).toBe('data:image/jpeg;base64,/9j/4AAQ');
  });

  it('reads { data, width, height } from the full-page screenshot', () => {
    const parsed = parseLighthouse(
      report({
        fullPageScreenshot: {
          screenshot: { data: 'UklGRg==', width: 412, height: 800 },
        },
      }),
    );
    expect(parsed.screenshot).toBe('data:image/webp;base64,UklGRg==');
  });

  it('uses the last filmstrip frame when the final screenshot is missing', () => {
    const parsed = parseLighthouse(
      report({
        audits: {
          'screenshot-thumbnails': {
            details: {
              items: [{ data: '/9j/early' }, { data: 'iVBORw0KGgoLATE' }],
            },
          },
        },
      }),
    );
    expect(parsed.screenshot).toBe('data:image/png;base64,iVBORw0KGgoLATE');
  });

  it('does not invent an image when the screenshot is missing', () => {
    const parsed = parseLighthouse(report({}));
    expect(parsed.screenshot).toBeNull();
    expect(parsed.first_contentful_paint).toBe(1400);
  });
});

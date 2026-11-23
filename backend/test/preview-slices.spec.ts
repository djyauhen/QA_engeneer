import { previewShotLabel, previewShotLabels, previewSliceOffsets } from '../src/stand/preview-slices';

describe('preview page slices', () => {
  it('covers a short page with adjacent bands and a short tail', () => {
    expect(previewSliceOffsets(940)).toEqual([0]);
    expect(previewSliceOffsets(2000)).toEqual([0, 940, 1880]);
  });

  it('covers a long page without dropping the middle', () => {
    const offsets = previewSliceOffsets(10000);
    expect(offsets[0]).toBe(0);
    expect(offsets.length).toBe(11);
    expect(offsets.length).toBeLessThanOrEqual(12);
    for (let index = 1; index < offsets.length; index += 1) {
      expect(offsets[index] - offsets[index - 1]).toBe(940);
    }
    expect(offsets[offsets.length - 1]).toBeLessThan(10000);
    expect(offsets[offsets.length - 1] + 940).toBeGreaterThanOrEqual(10000);
  });

  it('grows the band once twelve slices are not enough and still reaches the bottom', () => {
    const height = 20000;
    const offsets = previewSliceOffsets(height);
    expect(offsets).toHaveLength(12);
    expect(offsets[0]).toBe(0);
    const step = offsets[1] - offsets[0];
    expect(step).toBeGreaterThan(940);
    for (let index = 1; index < offsets.length; index += 1) {
      expect(offsets[index] - offsets[index - 1]).toBe(step);
    }
    expect(offsets[offsets.length - 1] + step).toBeGreaterThanOrEqual(height);
  });

  it('labels frames preview, preview_2, preview_3, preview_4', () => {
    expect(previewShotLabels(4)).toEqual(['preview', 'preview_2', 'preview_3', 'preview_4']);
    expect(previewShotLabel(0)).toBe('preview');
  });
});

import { previewShotLabel, previewShotLabels, previewSliceOffsets } from '../src/stand/preview-slices';

describe('preview page slices', () => {
  it('covers a short page from the top and keeps the footer in the last frame', () => {
    expect(previewSliceOffsets(940)).toEqual([0]);
    expect(previewSliceOffsets(2000)).toEqual([0, 940, 1060]);
  });

  it('keeps the top of a long page and the footer as the last frame', () => {
    expect(previewSliceOffsets(10000)).toEqual([0, 940, 1880, 9060]);
    expect(previewSliceOffsets(10000)).toHaveLength(4);
  });

  it('labels frames preview, preview_2, preview_3, preview_4', () => {
    expect(previewShotLabels(4)).toEqual(['preview', 'preview_2', 'preview_3', 'preview_4']);
    expect(previewShotLabel(0)).toBe('preview');
  });
});

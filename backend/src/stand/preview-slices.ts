/**
 * Adjacent bands of the preview page, top to bottom.
 * Twelve is the vision budget: a model still reads header, body, and footer text,
 * and one turn does not carry an unbounded stack of JPEGs. A taller page grows
 * each band so the slices stay within this cap and still meet, with no dropped middle.
 */
export const PREVIEW_MAX_SLICES = 12;
export const PREVIEW_VIEWPORT_HEIGHT = 940;

export function previewShotLabel(index: number): string {
  if (index <= 0) return 'preview';
  return `preview_${index + 1}`;
}

export function previewShotLabels(count: number): string[] {
  const labels: string[] = [];
  for (let index = 0; index < count; index += 1) labels.push(previewShotLabel(index));
  return labels;
}

/**
 * Document Y starts. Neighboring bands abut and together reach scrollHeight.
 * The clip height of band i is the next start, or scrollHeight for the last band.
 * Past the slice cap the band is taller than one viewport; it is never a gap.
 */
export function previewSliceOffsets(
  scrollHeight: number,
  viewportHeight = PREVIEW_VIEWPORT_HEIGHT,
  maxSlices = PREVIEW_MAX_SLICES,
): number[] {
  const view = Math.max(1, Math.round(viewportHeight));
  const limit = Math.max(1, Math.round(maxSlices));
  const height = Math.max(1, Math.round(scrollHeight));
  const band = Math.max(view, Math.ceil(height / limit));
  const count = Math.min(limit, Math.max(1, Math.ceil(height / band)));
  const offsets: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const y = index * band;
    if (y >= height) break;
    offsets.push(y);
  }
  return offsets;
}

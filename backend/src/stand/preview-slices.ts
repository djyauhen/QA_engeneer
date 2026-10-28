/** Viewport slices of the AIO preview page. The first frame is the top; the last is the bottom. */
export const PREVIEW_MAX_SLICES = 4;
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

/** Document Y offsets. A short page is covered in order. A long page keeps the top frames and the footer. */
export function previewSliceOffsets(
  scrollHeight: number,
  viewportHeight = PREVIEW_VIEWPORT_HEIGHT,
  maxSlices = PREVIEW_MAX_SLICES,
): number[] {
  const view = Math.max(1, Math.round(viewportHeight));
  const limit = Math.max(1, Math.round(maxSlices));
  const height = Math.max(view, Math.round(scrollHeight));
  const needed = Math.max(1, Math.ceil(height / view));
  const count = Math.min(limit, needed);
  const last = Math.max(0, height - view);
  const raw: number[] = [];
  if (needed <= limit) {
    for (let index = 0; index < count; index += 1) raw.push(Math.min(index * view, last));
  } else {
    for (let index = 0; index < limit - 1; index += 1) raw.push(index * view);
    raw.push(last);
  }
  const offsets: number[] = [];
  for (const offset of raw) {
    if (!offsets.includes(offset)) offsets.push(offset);
  }
  return offsets;
}

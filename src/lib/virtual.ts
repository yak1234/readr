// Which blocks of a long transcript to draw: only those near the viewport, with
// blank space standing in for the rest.

export interface Range {
  /** First block drawn, and one past the last. */
  from: number;
  to: number;
  /** Height of the blocks before `from` and from `to` on. */
  before: number;
  after: number;
}

/** `top`/`bottom` are the viewport's edges in the same coordinates as the
 * blocks' stacked heights; `overscan` extends both edges. */
export function visibleRange(heights: number[], top: number, bottom: number, overscan: number): Range {
  const n = heights.length;
  if (n === 0) return { from: 0, to: 0, before: 0, after: 0 };
  let y = 0;
  let from = -1;
  let before = 0;
  let to = n;
  let drawnEnd = 0;
  for (let i = 0; i < n; i++) {
    const end = y + heights[i];
    if (from < 0 && end > top - overscan) {
      from = i;
      before = y;
    }
    if (from >= 0 && y >= bottom + overscan) {
      to = i;
      drawnEnd = y;
      break;
    }
    y = end;
    drawnEnd = y;
  }
  if (from < 0) {
    // Scrolled past the end: keep the last block.
    from = n - 1;
    before = y - heights[n - 1];
  }
  const total = heights.reduce((a, b) => a + b, 0);
  return { from, to, before, after: total - drawnEnd };
}

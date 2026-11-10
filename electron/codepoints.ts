// The sidecar counts characters as Python does, in code points; JavaScript strings count UTF-16 units.
// They differ after any character outside the Basic Multilingual Plane (emoji, rare CJK).

/** The code-point offset of UTF-16 index `index` in `text`. */
export function toCodePoints(text: string, index: number): number {
  return Array.from(text.slice(0, index)).length;
}

/** The UTF-16 index of code-point offset `offset` in `text`. */
export function toUtf16(text: string, offset: number): number {
  return Array.from(text).slice(0, offset).join("").length;
}

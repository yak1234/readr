// An element's width as React state that follows it as it resizes (a layout that depends on the room it has,
// not the window's: side panels opening or closing change it too).

import { useLayoutEffect, useState } from "react";
import useResizeObserver from "@react-hook/resize-observer";

/** The content-box width of `ref`'s element in px (0 until it is laid out). */
export function useElementWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  // The first width before the first paint; the observer follows every change after it.
  useLayoutEffect(() => {
    if (ref.current) setWidth(ref.current.clientWidth);
  }, [ref]);
  useResizeObserver(ref as React.RefObject<HTMLElement>, (entry) => setWidth(entry.contentRect.width));
  return width;
}

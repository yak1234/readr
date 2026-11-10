// What an address becomes once it has been read. Arriving at it for the first time opens it for real: a station
// starts, an article becomes the one read aloud. Coming Back or Forward onto an address that never finished
// opening only shows it: navigation never starts audio or takes over read-aloud.

/** Choosing the station or channel already selected: a stream that failed starts again; otherwise its
 * transcript just shows (paused on purpose, or still connecting, is not an error). */
export function reopenSelected({ failed }: { playing: boolean; failed: boolean }): "restart" | "show" {
  return failed ? "restart" : "show";
}

export type AfterOpen = "play" | "show-live" | "not-playing" | "read" | "show";

export function afterOpen({ live, returning, selected }: { live: boolean; returning: boolean; selected: boolean }): AfterOpen {
  if (live) return !returning ? "play" : selected ? "show-live" : "not-playing";
  return returning ? "show" : "read";
}

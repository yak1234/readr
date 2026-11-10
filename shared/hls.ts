// HLS master-playlist helpers shared by radio and live TV.

/** Absolute URL of the first audio-only (mp4a codecs, no video) variant in a master playlist, or null. */
export function audioOnlyVariant(masterPlaylistText: string, baseUrl: string): string | null {
  const lines = masterPlaylistText.split(/\r?\n/).map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("#EXT-X-STREAM-INF:")) continue;
    const codecs = /CODECS="([^"]*)"/i.exec(lines[i])?.[1];
    if (!codecs) continue;
    const list = codecs.split(",").map((c) => c.trim().toLowerCase());
    if (list.length === 0 || !list.every((c) => c.startsWith("mp4a"))) continue;
    const uri = lines.slice(i + 1).find((l) => l && !l.startsWith("#"));
    if (!uri) continue;
    try {
      return new URL(uri, baseUrl).toString();
    } catch {
      continue;
    }
  }
  return null;
}

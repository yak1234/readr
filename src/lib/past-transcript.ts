// Past radio and TV transcripts: the "Earlier" list (sessions grouped by day) and a session shown as a
// read-only live-style article, so the reader's word click, lookup and right-click work on it.

import type { Article } from "../../shared/types";
import type { LiveSentence, LiveSession } from "../../shared/live-history";
import { CHROME_LOCALE, i18n } from "../i18n";

const clock = new Intl.DateTimeFormat(CHROME_LOCALE, { hour: "2-digit", minute: "2-digit" });
const weekdayDate = new Intl.DateTimeFormat(CHROME_LOCALE, { weekday: "long", day: "numeric", month: "long" });
const weekdayDateYear = new Intl.DateTimeFormat(CHROME_LOCALE, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const dayName = (d: Date, now: Date) => (d.getFullYear() === now.getFullYear() ? weekdayDate : weekdayDateYear).format(d).replace(",", "");

/** "Today", "Yesterday", else the date ("Tuesday 3 November"; with the year when it isn't this year). */
export function dayLabel(at: number, now: Date): string {
  const d = new Date(at);
  const days = Math.round((dayStart(now) - dayStart(d)) / 86_400_000);
  return days === 0 ? i18n.t("time.today") : days === 1 ? i18n.t("time.yesterday") : dayName(d, now);
}

/** "14:02 – 14:40"; just the start while the session is open, or when it lasted under a minute. */
export function sessionTimes(s: Pick<LiveSession, "startedAt" | "endedAt">): string {
  const start = clock.format(s.startedAt);
  const end = s.endedAt === null ? null : clock.format(s.endedAt);
  return end && end !== start ? `${start} – ${end}` : start;
}

export interface EarlierGroup {
  label: string;
  sessions: LiveSession[];
}

/** Sessions grouped by the day they started, newest first. */
export function earlierGroups(sessions: LiveSession[], now: Date): EarlierGroup[] {
  const groups: EarlierGroup[] = [];
  for (const s of [...sessions].sort((a, b) => b.startedAt - a.startedAt)) {
    const label = dayLabel(s.startedAt, now);
    const last = groups.at(-1);
    if (last?.label === label) last.sessions.push(s);
    else groups.push({ label, sessions: [s] });
  }
  return groups;
}

/** A paragraph ends after this many sentences, at a pause this long (seconds), or where the stream's clock restarts (a reconnect). */
const PARAGRAPH_SENTENCES = 5;
const PARAGRAPH_PAUSE = 12;

/** A session as a read-only live-style article: its sentences in paragraphs, each keeping its live-history id.
 * `streamUrl`: the station's address when known (its translation settings are kept by address). */
export function pastTranscriptArticle(session: LiveSession, sentences: LiveSentence[], streamUrl?: string): Article {
  const blocks: { type: "p"; sentences: string[] }[] = [];
  const cues: [number, number][][] = [];
  const liveIds: string[][] = [];
  let prev: LiveSentence | null = null;
  for (const s of sentences) {
    const fresh = !prev || s.t < prev.t || s.t - prev.t > PARAGRAPH_PAUSE || blocks[blocks.length - 1].sentences.length >= PARAGRAPH_SENTENCES;
    if (fresh) {
      blocks.push({ type: "p", sentences: [] });
      cues.push([]);
      liveIds.push([]);
    }
    blocks[blocks.length - 1].sentences.push(s.text);
    cues[cues.length - 1].push([s.t, s.t]);
    liveIds[liveIds.length - 1].push(s.id);
    prev = s;
  }
  const start = new Date(session.startedAt);
  // The translations it was shown, kept in its target language: they aren't fetched again.
  const kept = session.target ? Object.fromEntries(sentences.filter((s) => s.translation).map((s) => [s.text, s.translation as string])) : {};
  return {
    id: `past:${session.id}`,
    url: streamUrl || (session.stationId && /^https?:/i.test(session.stationId) ? session.stationId : ""),
    source: i18n.t(session.kind === "tv" ? "past.liveTv" : "past.radio"),
    title: session.stationName || i18n.t(session.kind === "tv" ? "past.tvChannel" : "past.radioStation"),
    subtitle: "",
    author: "",
    date: i18n.t("time.dayTime", { day: dayName(start, start), time: sessionTimes(session) }),
    readingTime: 0,
    imageUrl: "",
    language: session.lang,
    blocks,
    translations: {},
    ...(session.target && Object.keys(kept).length > 0 && { translationsTo: { [session.target]: kept } }),
    progress: 0,
    savedAt: start.toISOString(),
    kind: session.kind,
    cues,
    liveIds,
    live: true,
    past: { sessionId: session.id, stationId: session.stationId },
  };
}

/** The reader's key ("block:sentence") of a live sentence in a past transcript, or null. */
export function sentenceKeyOf(article: Article, liveSentenceId: string): string | null {
  const ids = article.liveIds ?? [];
  for (let b = 0; b < ids.length; b++) {
    const s = ids[b].indexOf(liveSentenceId);
    if (s >= 0) return `${b}:${s}`;
  }
  return null;
}

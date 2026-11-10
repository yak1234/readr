// Anki export: a folder holding a tab-separated notes file Anki imports (File > Import), and a media
// folder with each card's clip, which the notes name with Anki's [sound:…] tag. The note's text is
// pure (ankiNote); exportCards only writes it out.

import fs from "node:fs/promises";
import path from "node:path";
import { findSpan, type CardExample, type CardWithExamples } from "../shared/cards";

export const NOTES_FILE = "readr-cards.txt";
export const MEDIA_DIR = "media";

const HEADER = ["#separator:tab", "#html:true", "#columns:Front\tBack\tAudio\tSource\tTags", "#tags column:5"];

/** One field: tabs and line breaks (which would end the field or the note) become spaces; HTML is escaped. */
const field = (s: string) =>
  s
    .replace(/\r\n|[\t\r\n]/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** The clip's file name in the media folder (Anki's media folder is flat: the example id keeps it unique). */
export const clipFile = (exampleId: string) => `readr-${exampleId.replace(/[^\w-]/g, "_")}.ogg`;

/** The example a note shows: one with audio when there is one, else the most recent. */
export const shownExample = (c: CardWithExamples): CardExample | undefined => c.examples.find((e) => e.hasClip) ?? c.examples[0];

/** The sentence with its phrase in bold: the stored span, else the form found in it. */
function markedSentence(e: CardExample, form: string): string {
  const span = e.span && e.span[0] >= 0 && e.span[0] < e.span[1] && e.span[1] <= e.sentence.length ? e.span : findSpan(e.sentence, form);
  if (!span) return field(e.sentence);
  return `${field(e.sentence.slice(0, span[0]))}<b>${field(e.sentence.slice(span[0], span[1]))}</b>${field(e.sentence.slice(span[1]))}`;
}

/** A card as one line of the notes file: Front, Back, Audio, Source, Tags. */
export function ankiNote(c: CardWithExamples): string {
  const e = shownExample(c);
  const front = [`<b>${field(c.form)}</b>`, e && `<i>${markedSentence(e, c.form)}</i>`];
  const back = [field(c.translation), c.definition && field(c.definition), e?.sentenceTranslation && `<i>${field(e.sentenceTranslation)}</i>`];
  const audio = e?.hasClip ? `[sound:${clipFile(e.id)}]` : "";
  const source = field(e?.sourceName || e?.sourceTitle || "");
  const tags = `readr readr::${c.lang.replace(/\s/g, "_")}`;
  const join = (parts: (string | null | undefined | false | "")[]) => parts.filter(Boolean).join("<br>");
  return [join(front), join(back), audio, source, tags].join("\t");
}

/** The whole notes file. */
export const ankiNotes = (cards: CardWithExamples[]): string => [...HEADER, ...cards.map(ankiNote)].join("\n") + "\n";

/** Clips are fetched and written this many at a time, so a large collection never sits in memory at once. */
const BATCH = 16;

/**
 * Writes `readr-cards.txt` and, for each card shown with a clip, `media/readr-<exampleId>.ogg` into
 * `dir`. A shown example's clip comes from `loadClip` (by default its own bytes, when loaded), so the
 * cards can be passed without them. Returns the notes file and how many clips were written.
 */
export async function exportCards(
  cards: CardWithExamples[],
  dir: string,
  loadClip: (e: CardExample) => Promise<Uint8Array | null> = async (e) => e.clip,
): Promise<{ file: string; media: number }> {
  const file = path.join(dir, NOTES_FILE);
  const heard = cards.map(shownExample).filter((e): e is CardExample => Boolean(e?.hasClip));
  let media = 0;
  if (heard.length) {
    const folder = path.join(dir, MEDIA_DIR);
    await fs.mkdir(folder, { recursive: true });
    for (let i = 0; i < heard.length; i += BATCH) {
      const written = await Promise.all(
        heard.slice(i, i + BATCH).map(async (e) => {
          const clip = await loadClip(e);
          if (clip) await fs.writeFile(path.join(folder, clipFile(e.id)), clip);
          return clip ? 1 : 0;
        }),
      );
      media += written.reduce<number>((a, b) => a + b, 0);
    }
  }
  await fs.writeFile(file, ankiNotes(cards), "utf8");
  return { file, media };
}

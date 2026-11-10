import type { Kysely } from "kysely";
import type { DB } from "../schema";

// This migration is frozen: it carries its own copy of the script table and detection, so later
// changes to shared/languages.ts can never change what it does to a library being upgraded.

/** A frozen copy (as of this migration) of the scripts that point at a language, with every Readr language written in each (the first is the one a
 * word in that script is taken to be in). Latin and other widely shared scripts are left out: they say nothing. */
const SCRIPTS: { script: RegExp; langs: string[] }[] = [
  { script: /[\p{Script=Hiragana}\p{Script=Katakana}]/u, langs: ["ja"] },
  { script: /\p{Script=Arabic}/u, langs: ["ar", "fa", "ur", "ug", "ps", "ku"] },
  { script: /\p{Script=Cyrillic}/u, langs: ["ru", "uk", "bg", "sr", "kk", "mn", "mk", "be", "bs"] },
  { script: /\p{Script=Han}/u, langs: ["zh", "zh-Hant", "ja"] },
  { script: /\p{Script=Hangul}/u, langs: ["ko"] },
  { script: /\p{Script=Hebrew}/u, langs: ["he"] },
  { script: /\p{Script=Greek}/u, langs: ["el"] },
  { script: /\p{Script=Devanagari}/u, langs: ["hi", "mr", "ne"] },
  { script: /\p{Script=Thai}/u, langs: ["th"] },
  { script: /\p{Script=Bengali}/u, langs: ["bn"] },
  { script: /\p{Script=Tamil}/u, langs: ["ta"] },
  { script: /\p{Script=Telugu}/u, langs: ["te"] },
  { script: /\p{Script=Gujarati}/u, langs: ["gu"] },
  { script: /\p{Script=Kannada}/u, langs: ["kn"] },
  { script: /\p{Script=Malayalam}/u, langs: ["ml"] },
  { script: /\p{Script=Gurmukhi}/u, langs: ["pa"] },
  { script: /\p{Script=Sinhala}/u, langs: ["si"] },
  { script: /\p{Script=Lao}/u, langs: ["lo"] },
  { script: /\p{Script=Khmer}/u, langs: ["km"] },
  { script: /\p{Script=Myanmar}/u, langs: ["my"] },
  { script: /\p{Script=Georgian}/u, langs: ["ka"] },
  { script: /\p{Script=Armenian}/u, langs: ["hy"] },
  { script: /\p{Script=Ethiopic}/u, langs: ["am"] },
  { script: /\p{Script=Tibetan}/u, langs: ["bo"] },
];

/** The telling script most of the text's letters are in (kana marks Japanese even beside Han). */
function scriptOf(text: string): (typeof SCRIPTS)[number] | null {
  const counts = new Map<(typeof SCRIPTS)[number], number>();
  for (const ch of text) {
    const s = SCRIPTS.find((x) => x.script.test(ch));
    if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  if (counts.has(SCRIPTS[0])) return SCRIPTS[0];
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** `lang`, unless the text's script can't be written in it: then the script's language. */
function languageForText(text: string, lang: string): string {
  const s = scriptOf(text);
  return !s || s.langs.includes(lang) ? lang : s.langs[0];
}

/**
 * Cards whose form is written in a script their language can't be (an Arabic word filed under
 * "fr" because its article was gone and the app showed French) move to the script's language.
 * When that language already has the same card, the examples and reviews join it and the
 * duplicate goes.
 */
export async function up(untyped: Kysely<unknown>): Promise<void> {
  const db = untyped as unknown as Kysely<DB>;
  const cards = await db.selectFrom("cards").select(["id", "lang", "form", "form_key", "translation"]).execute();
  for (const card of cards) {
    const lang = languageForText(card.form, card.lang);
    if (lang === card.lang) continue;
    const twin = await db.selectFrom("cards").select(["id", "translation"]).where("lang", "=", lang).where("form_key", "=", card.form_key).executeTakeFirst();
    if (!twin) {
      await db.updateTable("cards").set({ lang }).where("id", "=", card.id).execute();
      continue;
    }
    await db.updateTable("card_examples").set({ card_id: twin.id }).where("card_id", "=", card.id).execute();
    await db.updateTable("reviews").set({ card_id: twin.id }).where("card_id", "=", card.id).execute();
    if (!twin.translation && card.translation) await db.updateTable("cards").set({ translation: card.translation }).where("id", "=", twin.id).execute();
    await db.deleteFrom("cards").where("id", "=", card.id).execute();
  }
}

/** Nothing to undo: the old language was wrong. */
export async function down(): Promise<void> {}

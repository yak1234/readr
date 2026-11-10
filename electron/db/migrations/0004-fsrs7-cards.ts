// Note: this imports the live ts-fsrs, not a frozen copy, and on a new install it does nothing (there are no cards yet).
import type { Kysely } from "kysely";
import { DefaultScheduler } from "ts-fsrs";
import type { DB } from "../schema";

/**
 * Cards stored by the first version of flashcards hold ts-fsrs's legacy card (`due`, `reps`, ...).
 * The scheduler is now ts-fsrs's current one (FSRS-7), whose card has another shape.
 *
 * - A card never reviewed has no memory to carry over: it is re-created as an empty FSRS-7 card
 *   (its `due` column, which the study queue uses, is untouched).
 * - A reviewed card is left as it is. ts-fsrs offers no conversion: FSRS-7 needs a `stabilityFast`
 *   that only a replay of the complete review history can produce, and FSRS-6 weights must not be
 *   reused, so a state would have to be invented. No library has reviewed cards yet (flashcard
 *   review did not exist before this change), so there is nothing to lose; `cards.review` refuses
 *   such a card with a clear error rather than guess.
 */
export async function up(untyped: Kysely<unknown>): Promise<void> {
  const db = untyped as unknown as Kysely<DB>;
  const scheduler = await DefaultScheduler({ enableFuzz: true });
  const cards = await db.selectFrom("cards").select(["id", "created_at", "fsrs_json", "due"]).execute();
  for (const c of cards) {
    let stored: Record<string, unknown>;
    try {
      stored = JSON.parse(c.fsrs_json);
    } catch {
      stored = {};
    }
    if ("scheduleStatus" in stored) continue; // already the current shape
    if (stored.reps !== undefined && stored.reps !== 0) continue; // reviewed: kept (see above)
    const fresh = scheduler.newCard({ now: new Date(c.created_at), cardId: c.id }); // as `addCard` makes one
    await db.updateTable("cards").set({ fsrs_json: JSON.stringify(fresh) }).where("id", "=", c.id).execute();
  }
}

/** Nothing to undo: an empty card is an empty card in either shape. */
export async function down(): Promise<void> {}

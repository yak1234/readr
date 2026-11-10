// What the reader did, by study day: articles opened, cards reviewed, minutes listened. One row per
// event; "today" runs from 4 AM to 4 AM, like the cards.

import crypto from "node:crypto";
import type { Kysely } from "kysely";
import type { DB } from "./db";
import { studyDayEnd, studyDayStart, type ActivityToday } from "../shared/cards";

export type ActivityKind = "article" | "review" | "listen";
const KINDS: readonly ActivityKind[] = ["article", "review", "listen"];

/** Records one event. `amount`: 1 for an article or a review, minutes for listening. */
export async function record(db: Kysely<DB>, kind: ActivityKind, ref: string | null, amount: number, now: Date): Promise<void> {
  if (!KINDS.includes(kind)) throw new Error(`Unknown activity: ${String(kind)}`);
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`An activity's amount must be a number of at least 0, not ${amount}`);
  await db.insertInto("activity").values({ id: crypto.randomUUID(), at: now.getTime(), kind, ref, amount }).execute();
}

/** Reviews done and minutes listened (rounded) in the study day `now` falls in. */
export async function today(db: Kysely<DB>, now: Date): Promise<ActivityToday> {
  const rows = await db
    .selectFrom("activity")
    .select(["kind", (eb) => eb.fn.sum<number>("amount").as("total")])
    .where("at", ">=", studyDayStart(now))
    .where("at", "<", studyDayEnd(now))
    .where("kind", "in", ["review", "listen"])
    .groupBy("kind")
    .execute();
  const total = (kind: ActivityKind) => Number(rows.find((r) => r.kind === kind)?.total ?? 0);
  return { reviews: Math.round(total("review")), listenMinutes: Math.round(total("listen")) };
}

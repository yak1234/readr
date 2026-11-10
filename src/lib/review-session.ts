// A review sitting, as a pure state machine: the queue of cards still to see (the current one
// first), whether its back is showing, a rating being saved, and how many have been rated. Each step
// returns a new state; the view only renders it and sends the rating to the main process.
//
//   startReview → reveal → rate (pending) → commit (next card) | fail (same card, notice)

/** What the session needs of a card: who it is and when it is next due (epoch ms). */
export interface SessionCard {
  id: string;
  due: number;
}

export interface PendingRating {
  /** The showing it rates (see cardKey). */
  key: string;
  rating: 1 | 2 | 3 | 4;
}

export interface ReviewSession<C extends SessionCard = SessionCard> {
  /** Cards still to see, the current one first. */
  readonly queue: readonly C[];
  readonly current: C | null;
  /** Whether the current card's back is showing. */
  readonly revealed: boolean;
  /** A rating sent and not yet saved: any other rating meanwhile is ignored. */
  readonly pending: PendingRating | null;
  /** The last rating couldn't be saved (the card is still showing). */
  readonly failed: boolean;
  /** Cards left, the current one included. */
  readonly remaining: number;
  /** Ratings saved this session. */
  readonly reviewed: number;
}

/** How far ahead an Again card may be due and still come back in this sitting (Anki's learn-ahead limit). */
export const LEARN_AHEAD_MS = 20 * 60_000;

/** One showing of a card: a re-queued Again card has the same id but a new due time. */
export const cardKey = (c: SessionCard) => `${c.id}@${c.due}`;

function state<C extends SessionCard>(queue: readonly C[], fields: { revealed: boolean; reviewed: number; pending?: PendingRating | null; failed?: boolean }): ReviewSession<C> {
  const any = queue.length > 0;
  return { queue, current: queue[0] ?? null, revealed: fields.revealed && any, pending: (any && fields.pending) || null, failed: any && Boolean(fields.failed), remaining: queue.length, reviewed: fields.reviewed };
}

/** A sitting over `cards`, in the order given (each card once). */
export function startReview<C extends SessionCard>(cards: readonly C[]): ReviewSession<C> {
  const seen = new Set<string>();
  return state(cards.filter((c) => !seen.has(c.id) && seen.add(c.id)), { revealed: false, reviewed: 0 });
}

/** Shows the current card's back. */
export function reveal<C extends SessionCard>(s: ReviewSession<C>): ReviewSession<C> {
  return s.current && !s.revealed ? { ...s, revealed: true } : s;
}

/** Rates the current card: the rating is pending until `commit` or `fail`. Only once the back is
 * showing, and never while another rating is being saved. */
export function rate<C extends SessionCard>(s: ReviewSession<C>, rating: 1 | 2 | 3 | 4): ReviewSession<C> {
  if (!s.current || !s.revealed || s.pending) return s;
  return { ...s, pending: { key: cardKey(s.current), rating }, failed: false };
}

/**
 * The pending rating of showing `key` was saved: `updated` is the card as the scheduler left it
 * (null: it was deleted meanwhile, and just leaves). An Again card due within the learn-ahead limit
 * goes to the end of the queue, to be seen again this sitting. An answer for any other showing is ignored.
 */
export function commit<C extends SessionCard>(s: ReviewSession<C>, key: string, updated: C | null, now: number): ReviewSession<C> {
  if (!s.pending || s.pending.key !== key || !s.current || cardKey(s.current) !== key) return s;
  const rest = s.queue.slice(1);
  if (!updated) return state(rest, { revealed: false, reviewed: s.reviewed });
  const again = s.pending.rating === 1 && updated.due - now <= LEARN_AHEAD_MS;
  return state(again ? [...rest, updated] : rest, { revealed: false, reviewed: s.reviewed + 1 });
}

/** The pending rating of showing `key` couldn't be saved: the card stays, revealed, to be rated again. */
export function fail<C extends SessionCard>(s: ReviewSession<C>, key: string): ReviewSession<C> {
  return s.pending?.key === key ? { ...s, pending: null, failed: true } : s;
}

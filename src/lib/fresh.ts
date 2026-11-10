// Which items arrived after a view was opened, so only they fade in. The first
// observation is the baseline (history never animates); an item stays "fresh"
// for ttl ms, long enough for its fade to finish, so remounting it later
// (scrolling back, switching view mode) shows it plainly.

export class Fresh {
  private seen = new Set<string>();
  private fresh = new Set<string>();
  private started = false;

  constructor(
    private ttl = 500,
    private later: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms),
  ) {}

  observe(keys: Iterable<string>) {
    for (const k of keys) {
      if (this.seen.has(k)) continue;
      this.seen.add(k);
      if (!this.started) continue;
      this.fresh.add(k);
      this.later(() => this.fresh.delete(k), this.ttl);
    }
    this.started = true;
  }

  has(k: string) {
    return this.fresh.has(k);
  }
}

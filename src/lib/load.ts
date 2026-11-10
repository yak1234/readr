/** Runs the first loads side by side and always finishes: true when every one worked.
 * A load that rejects (or throws before returning a promise) never holds the others back. */
export async function loadAll(tasks: (() => Promise<unknown>)[]): Promise<boolean> {
  const results = await Promise.allSettled(tasks.map(async (t) => t()));
  return results.every((r) => r.status === "fulfilled");
}

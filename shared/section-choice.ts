/** The name a source's one feed is saved under when it has no sections: the word the chrome shows for it
 * (en.json's sourcePage.latest; a test keeps the two the same). English in every language, like the chrome. */
export const LATEST_FEED_NAME = "Latest";

/** What Done should save: the ticked ids in picker order, or null when the source
 * offered no sections (nothing to choose, so nothing is saved and the default stays). */
export function selectionToSave(sections: { id: string }[], ticked: string[]): string[] | null {
  if (sections.length === 0) return null;
  return sections.filter((s) => ticked.includes(s.id)).map((s) => s.id);
}

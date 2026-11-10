// One sound at a time. Each player (the radio or TV, read-aloud, a flashcard's clip, a word said aloud) registers how
// to stop it; whichever starts claims the audio, which stops the others. Nothing resumes by itself.

export type AudioOwner = "radio" | "reader" | "clip" | "word";

export function createAudioFocus() {
  const stops = new Map<AudioOwner, () => void>();
  return {
    /** How to stop `owner`; returns its unregister (which leaves a newer registration alone). */
    register(owner: AudioOwner, stop: () => void): () => void {
      stops.set(owner, stop);
      return () => {
        if (stops.get(owner) === stop) stops.delete(owner);
      };
    },
    /** `owner` is about to play: every other player stops. */
    claim(owner: AudioOwner): void {
      for (const [other, stop] of stops) {
        if (other === owner) continue;
        try {
          stop();
        } catch (e) {
          console.error(`Stopping ${other} failed:`, e);
        }
      }
    },
  };
}

/** The app's one audio focus. */
export const audioFocus = createAudioFocus();

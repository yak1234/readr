// Paywall detection. Only logged-out truncation markers count; subscriber
// labels ("Article réservé aux abonnés") also appear on articles a signed-in
// reader can open, so they say nothing about access.

export const PAYWALL_MARKERS = [
  "Il vous reste",
  "La suite est réservée aux abonnés",
  "Pour lire la suite",
  "Déjà abonné ?",
];

export const PAYWALL_MAX_WORDS = 600;

export function looksPaywalled(bodyText: string, wordCount: number): boolean {
  return wordCount < PAYWALL_MAX_WORDS && PAYWALL_MARKERS.some((m) => bodyText.includes(m));
}

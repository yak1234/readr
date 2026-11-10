// Keyboard shortcuts' shared rule.

/** The modifier key as the platform names it, for a shortcut's tooltip. */
export const MOD_KEY = typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "⌘" : "Ctrl+";

/** Where typing happens: shortcuts there belong to the field. */
export const isTypingTarget = (el: EventTarget | null) => {
  const t = el as HTMLElement | null;
  return Boolean(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable));
};

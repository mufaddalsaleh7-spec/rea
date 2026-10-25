/**
 * Tally's function-key map.
 *
 * Tally Prime users reach for F4–F9 without looking; Alt+F5/F6 add the two
 * note vouchers. Registered once at the shell so every screen gets them.
 */

export const SHORTCUTS = [
  { keys: "f4", type: "CONTRA", label: "F4 Contra" },
  { keys: "f5", type: "PAYMENT", label: "F5 Payment" },
  { keys: "f6", type: "RECEIPT", label: "F6 Receipt" },
  { keys: "f7", type: "JOURNAL", label: "F7 Journal" },
  { keys: "f8", type: "SALES", label: "F8 Sales" },
  { keys: "f9", type: "PURCHASE", label: "F9 Purchase" },
  { keys: "alt+f5", type: "CREDIT_NOTE", label: "Alt+F5 Credit note" },
  { keys: "alt+f6", type: "DEBIT_NOTE", label: "Alt+F6 Debit note" },
];

export function matchShortcut(event) {
  const key = event.key.toLowerCase();
  const combo = `${event.altKey ? "alt+" : ""}${event.ctrlKey ? "ctrl+" : ""}${event.metaKey ? "meta+" : ""}${key}`;
  return SHORTCUTS.find((shortcut) => shortcut.keys === combo) ?? null;
}

/** True when typing in a field, where a bare F-key still belongs to the app. */
export function isEditing(target) {
  const tag = target?.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable === true;
}

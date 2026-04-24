import { useEffect, useRef } from "react";

export interface Shortcut {
  id: string;
  key: string;
  modifiers: ("meta" | "ctrl" | "shift" | "alt")[];
  description: string;
  action: () => void;
}

const isMac =
  typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

export function useShortcuts(shortcuts: Shortcut[]): void {
  const ref = useRef(shortcuts);
  ref.current = shortcuts;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      for (const shortcut of ref.current) {
        if (event.key.toLowerCase() !== shortcut.key.toLowerCase()) continue;

        const wantMeta = shortcut.modifiers.includes("meta") || shortcut.modifiers.includes("ctrl");
        const wantShift = shortcut.modifiers.includes("shift");
        const wantAlt = shortcut.modifiers.includes("alt");

        const hasMeta = event.metaKey || event.ctrlKey;
        const hasShift = event.shiftKey;
        const hasAlt = event.altKey;

        if (wantMeta !== hasMeta) continue;
        if (wantShift !== hasShift) continue;
        if (wantAlt !== hasAlt) continue;

        event.preventDefault();
        event.stopPropagation();
        shortcut.action();
        return;
      }
    };

    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, []);
}

export function getShortcutLabel(shortcut: Shortcut): string {
  const parts: string[] = [];

  if (isMac) {
    if (shortcut.modifiers.includes("ctrl")) parts.push("⌃");
    if (shortcut.modifiers.includes("alt")) parts.push("⌥");
    if (shortcut.modifiers.includes("shift")) parts.push("⇧");
    if (shortcut.modifiers.includes("meta")) parts.push("⌘");
    parts.push(shortcut.key.charAt(0).toUpperCase() + shortcut.key.slice(1));
  } else {
    if (shortcut.modifiers.includes("meta") || shortcut.modifiers.includes("ctrl")) parts.push("Ctrl");
    if (shortcut.modifiers.includes("alt")) parts.push("Alt");
    if (shortcut.modifiers.includes("shift")) parts.push("Shift");
    parts.push(shortcut.key.charAt(0).toUpperCase() + shortcut.key.slice(1));
  }

  return isMac ? parts.join("") : parts.join("+");
}

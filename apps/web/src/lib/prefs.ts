import { useSyncExternalStore } from 'react';

export interface Prefs {
  theme: 'dark' | 'light';
  layout: 'card' | 'list';
  tourSeen: boolean;
}

const KEY = 'mergewatch:prefs';
const DEFAULTS: Prefs = { theme: 'dark', layout: 'card', tourSeen: false };
const listeners = new Set<() => void>();

function read(): Prefs {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>) };
  } catch {
    return DEFAULTS;
  }
}

let current = read();

export function setPrefs(patch: Partial<Prefs>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Storage unavailable (private mode): prefs last for this tab only.
  }
  applyTheme();
  for (const fn of listeners) fn();
}

export function applyTheme() {
  document.documentElement.dataset.theme = current.theme;
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
}

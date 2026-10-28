import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark' | 'system';

const KEY = 'pulse-theme';
const listeners = new Set<() => void>();
const media = matchMedia('(prefers-color-scheme: dark)');

let current: Theme = (() => {
  try {
    return (localStorage.getItem(KEY) as Theme) || 'system';
  } catch {
    return 'system';
  }
})();

const apply = () => document.documentElement.classList.toggle('dark', current === 'dark' || (current === 'system' && media.matches));
media.addEventListener('change', apply);

export function setTheme(theme: Theme) {
  current = theme;
  try {
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {}
  apply();
  listeners.forEach((l) => l());
}

export const isDarkNow = () => document.documentElement.classList.contains('dark');

/** One theme for the whole app, shared by the user menu and the command bar. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
  return [theme, setTheme];
}

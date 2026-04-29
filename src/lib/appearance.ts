export type Theme = 'light' | 'dark' | 'system';
export type Density = 'compact' | 'comfortable' | 'spacious';

export interface AppearanceState {
  theme: Theme;
  density: Density;
  accent: string;
}

const KEY = 'workbench-appearance';

export const APPEARANCE_DEFAULTS: AppearanceState = {
  theme: 'light',
  density: 'comfortable',
  accent: '#2d6b5d',
};

export function loadAppearance(): AppearanceState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...APPEARANCE_DEFAULTS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...APPEARANCE_DEFAULTS };
}

export function applyAppearanceToDom(state: AppearanceState): void {
  const root = document.documentElement;

  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  const dark = state.theme === 'dark' || (state.theme === 'system' && prefersDark);
  if (dark) {
    root.dataset.theme = 'dark';
  } else {
    delete root.dataset.theme;
  }

  if (state.density === 'compact') {
    root.dataset.density = 'compact';
  } else {
    delete root.dataset.density;
  }

  root.style.setProperty('--accent', state.accent);
}

export function saveAppearanceLocal(state: AppearanceState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

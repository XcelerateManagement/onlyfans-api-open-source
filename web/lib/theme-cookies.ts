export type Theme = 'light' | 'dark';

/**
 * Get theme preference from cookies (SSR-safe)
 * @returns Theme value or null if not set
 */
export function getThemeCookie(): Theme | null {
  if (typeof window === 'undefined') return null;

  const match = document.cookie.match(/theme=(light|dark)/);
  return match ? (match[1] as Theme) : null;
}

/**
 * Save theme preference to cookies
 * Cookie persists for 1 year
 */
export function setThemeCookie(theme: Theme): void {
  if (typeof window === 'undefined') return;

  document.cookie = `theme=${theme}; path=/; max-age=31536000; SameSite=Lax`;
}

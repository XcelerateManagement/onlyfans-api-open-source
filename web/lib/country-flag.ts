/**
 * ISO 3166-1 alpha-2 country code → flag emoji, via Unicode regional-indicator
 * letters (🇺 + 🇸 = 🇺🇸). Pure and dependency-free. Returns "" for anything
 * that isn't a two-letter code, so callers can render it unconditionally.
 */
export function countryCodeToFlag(code?: string | null): string {
  if (!code || !/^[a-zA-Z]{2}$/.test(code)) return "";
  const base = 0x1f1e6; // regional indicator "A"
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => base + c.charCodeAt(0) - 65),
  );
}

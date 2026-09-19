/**
 * The decode alphabet, shared by ScrambleWord and DecodeText.
 *
 * Extracted so the two matrix-decode effects on this page can never drift to
 * different character sets — which would read as two different systems.
 *
 * Half-width katakana + digits + a few symbols. Deliberately excludes
 * characters with unusual widths, which would make the line jitter as glyphs
 * cycle.
 */
export const GLYPHS =
  "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜ0123456789<>/\{}[]*+-=$#@%&";

export const randomGlyph = () =>
  GLYPHS[Math.floor(Math.random() * GLYPHS.length)];

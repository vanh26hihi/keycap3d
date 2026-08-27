import * as opentypeNS from "opentype.js";
import { NOTO_EMOJI_ICONS_TTF_BASE64 } from "./iconFontData";
import { setReferenceGlyph } from "./legendLayout";

// See legendFont.ts for why this ESM/CJS interop fallback is needed.
const opentype = ((opentypeNS as unknown as { default?: typeof opentypeNS }).default ?? opentypeNS) as typeof opentypeNS;

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = typeof atob === "function" ? atob(base64) : Buffer.from(base64, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

let cachedFont: opentype.Font | null = null;

/** Lazily parses and caches the embedded icon font (idempotent). */
export function getIconFont(): opentype.Font {
  if (!cachedFont) {
    cachedFont = opentype.parse(base64ToArrayBuffer(NOTO_EMOJI_ICONS_TTF_BASE64));
    // Icon glyphs (emoji) have no Latin 'H' to measure cap-height against --
    // use a full-bleed square glyph (check mark button) as the reference
    // instead. All icons in this font share the same ~2600 advance/emoji
    // square metrics, so any glyph would do; this one is guaranteed present.
    setReferenceGlyph(cachedFont, "✅");
  }
  return cachedFont;
}

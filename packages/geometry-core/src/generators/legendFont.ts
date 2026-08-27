import * as opentypeNS from "opentype.js";
import { NUNITO_EXTRABOLD_WOFF_BASE64 } from "./fontData";

// opentype.js ships as a UMD/CJS bundle with no package.json "exports" map,
// so under Node's real ESM loader `import * as opentypeNS` yields only a
// synthetic `default` (the actual module.exports object) -- the named
// exports the .d.ts promises (opentype.parse, opentype.Font, ...) aren't
// statically detectable from a UMD wrapper. Bundlers (webpack/Turbopack)
// sometimes DO flatten this to real named exports depending on their CJS
// interop analysis, so this falls back to the namespace object itself if
// `.default` isn't there, working correctly in both cases.
const opentype = ((opentypeNS as unknown as { default?: typeof opentypeNS }).default ?? opentypeNS) as typeof opentypeNS;

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  // Platform-agnostic: this module is imported both from Node (Vitest/tsx)
  // and from the browser (apps/web, via Turbopack -- see fontData.ts's doc
  // comment on why the font is embedded as base64 rather than a binary
  // asset import in the first place).
  const binary = typeof atob === "function" ? atob(base64) : Buffer.from(base64, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

let cachedFont: opentype.Font | null = null;

/** Lazily parses and caches the embedded legend font (idempotent). */
export function getLegendFont(): opentype.Font {
  if (!cachedFont) {
    cachedFont = opentype.parse(base64ToArrayBuffer(NUNITO_EXTRABOLD_WOFF_BASE64));
  }
  return cachedFont;
}

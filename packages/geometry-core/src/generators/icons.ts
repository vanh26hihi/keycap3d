/**
 * The curated set of icons available in the icon legend picker. Unlike the
 * previous emoji-font-based set, `char` here is just this icon's own id
 * string, used as the lookup key into `pixelIcons.ts`'s
 * `PIXEL_ICON_GRIDS` -- there's no real Unicode character involved anymore
 * (each icon is a hand-authored/formula-generated pixel bitmap, matching a
 * reference keycap-set mockup's flat pixel-art style, not a font glyph), but
 * `legendText` (where this value gets stored) and this `char` field are kept
 * as the storage/lookup contract so the rest of the app (KeycapPanel's icon
 * picker, batch-create, etc.) didn't need to change shape.
 */
export interface IconOption {
  id: string;
  char: string;
  label: string;
}

export const ICON_OPTIONS: IconOption[] = [
  { id: "smiley", char: "smiley", label: "Smiley" },
  { id: "neutralFace", char: "neutralFace", label: "Neutral face" },
  { id: "haha", char: "haha", label: "Haha" },
  { id: "sparkle", char: "sparkle", label: "Sparkle" },
  { id: "heartFilled", char: "heartFilled", label: "Heart" },
  { id: "brokenHeart", char: "brokenHeart", label: "Broken heart" },
  { id: "starFilled", char: "starFilled", label: "Star" },
  { id: "sparkleCluster", char: "sparkleCluster", label: "Sparkles" },
  { id: "music", char: "music", label: "Music note" },
  { id: "dollar", char: "dollar", label: "Dollar" },
  { id: "clover", char: "clover", label: "Clover" },
  { id: "arrowDown", char: "arrowDown", label: "Arrow down" },
  { id: "sleepZ", char: "sleepZ", label: "Sleep (Z)" },
  { id: "question", char: "question", label: "Question" },
  { id: "exclamation", char: "exclamation", label: "Exclamation" },
  { id: "splash", char: "splash", label: "Splash" },
  { id: "infinity", char: "infinity", label: "Infinity" },
  { id: "cross", char: "cross", label: "Cross" },
  { id: "circleO", char: "circleO", label: "Circle" },
  { id: "sparklingHeart", char: "sparklingHeart", label: "Sparkling heart" },
];

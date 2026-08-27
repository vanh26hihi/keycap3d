import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createKeycapMeshParts } from "../src/generators/keycap.js";
import { exportMultiPart3MF } from "../src/threemf.js";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "m4-keycap");
mkdirSync(outDir, { recursive: true });

const { base, bubble, legend } = await createKeycapMeshParts({
  legendText: "A",
  legendMode: "emboss",
  legendBubble: true,
});

const parts = [{ name: "Vo keycap", mesh: base }];
if (bubble) parts.push({ name: "Nen bong bong chat", mesh: bubble });
if (legend) parts.push({ name: "Chu - Icon", mesh: legend });

const bytes = exportMultiPart3MF(parts);
writeFileSync(join(outDir, "keycap_multicolor_sample.3mf"), Buffer.from(bytes));
console.log(`Wrote ${parts.length}-part 3MF (${bytes.length} bytes) to ${outDir}/keycap_multicolor_sample.3mf`);

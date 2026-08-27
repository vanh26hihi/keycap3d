export * from "./units";
export * from "./mesh";
export * from "./transform";
export * from "./validate";
export * from "./stl";
export * from "./convert/three";
export * from "./primitives/cube";
export * from "./primitives/cylinder";
export * from "./primitives/roundedRect";
export * from "./generators/loft";

// `boolean.ts`, `convert/manifold.ts`, and `generators/keycap.ts` are
// deliberately NOT re-exported here. They're the boundary that touches the
// manifold-3d WASM module, which per the blueprint's architecture belongs
// behind an explicit subpath (the future `csg-worker` package, or a
// browser Worker), not eagerly pulled into every consumer of this barrel --
// e.g. a UI that only renders/exports STL shouldn't bundle WASM it never
// calls. Import "@keycap-web/geometry-core/boolean" or
// "@keycap-web/geometry-core/keycap" directly (or the source path in tests)
// when you actually need the Boolean Engine or the keycap generator.

import { beforeEach, describe, expect, it } from "vitest";
import { loadSavedDefaultParams, saveDefaultParams, clearSavedDefaultParams } from "../src/lib/keycapDefaults.js";
import { DEFAULT_KEYCAP_PARAMS } from "@keycap-web/geometry-core/keycap";

/** Node's test environment has no real localStorage -- this is a minimal
 *  in-memory stand-in, just enough for these round-trip tests. Mirrors the
 *  real Web Storage API surface keycapDefaults.ts actually calls. */
function installFakeLocalStorage(): Storage {
  const store = new Map<string, string>();
  const fake: Storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
  (globalThis as unknown as { localStorage: Storage }).localStorage = fake;
  return fake;
}

describe("keycapDefaults: saved default keycap params (localStorage)", () => {
  beforeEach(() => {
    installFakeLocalStorage();
  });

  it("returns null when nothing has been saved yet", () => {
    expect(loadSavedDefaultParams()).toBeNull();
  });

  it("round-trips a saved params object exactly", () => {
    const custom = { ...DEFAULT_KEYCAP_PARAMS, socketDepthMm: 8.25, ribHeightMm: 6 };
    saveDefaultParams(custom);
    expect(loadSavedDefaultParams()).toEqual(custom);
  });

  it("clearSavedDefaultParams removes a previously saved value", () => {
    saveDefaultParams(DEFAULT_KEYCAP_PARAMS);
    expect(loadSavedDefaultParams()).not.toBeNull();
    clearSavedDefaultParams();
    expect(loadSavedDefaultParams()).toBeNull();
  });

  it("loadSavedDefaultParams doesn't throw when localStorage is entirely unavailable", () => {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
    expect(() => loadSavedDefaultParams()).not.toThrow();
    expect(loadSavedDefaultParams()).toBeNull();
  });

  it("saveDefaultParams doesn't throw when localStorage is entirely unavailable", () => {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
    expect(() => saveDefaultParams(DEFAULT_KEYCAP_PARAMS)).not.toThrow();
  });

  it("returns null (not a crash) for corrupted/non-JSON stored data", () => {
    localStorage.setItem("keycap-forge:default-keycap-params", "{not valid json");
    expect(loadSavedDefaultParams()).toBeNull();
  });
});

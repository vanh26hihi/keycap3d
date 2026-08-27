import type { KeycapParams } from "@keycap-web/geometry-core/keycap";

const STORAGE_KEY = "keycap-forge:default-keycap-params";

/**
 * The user's own saved "starting point" for new keycaps -- persisted in
 * localStorage (per-browser, not synced anywhere) so "+ Keycap" and page
 * reloads start from whatever they last tuned instead of the hardcoded
 * DEFAULT_KEYCAP_PARAMS every time. Wrapped in try/catch throughout: this
 * is a convenience, not core functionality, so a private-browsing tab or
 * localStorage disabled outright should silently fall back to the
 * hardcoded default rather than breaking keycap creation.
 */
export function loadSavedDefaultParams(): KeycapParams | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as KeycapParams) : null;
  } catch {
    return null;
  }
}

export function saveDefaultParams(params: KeycapParams): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
  } catch {
    // Ignore -- see doc comment above.
  }
}

export function clearSavedDefaultParams(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore -- see doc comment above.
  }
}

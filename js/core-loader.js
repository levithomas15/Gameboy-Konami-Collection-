/**
 * Loads the vendored binjgb WebAssembly core.
 *
 * binjgb.js is an Emscripten *classic* script: it declares `var Binjgb = ...`
 * at top level and works out where its .wasm lives from
 * `document.currentScript.src`. Inside an ES module `document.currentScript`
 * is always null, so a plain `import` would leave the core fetching
 * "binjgb.wasm" relative to the page rather than to the vendor directory —
 * which 404s the moment the site is served from a subpath (as it is on
 * GitHub Pages).
 *
 * So we do two things, either of which would be sufficient on its own:
 *   1. inject a real <script> tag, so currentScript is populated, and
 *   2. pass an explicit locateFile, so the path never depends on step 1.
 */

const CORE_URL = new URL('../vendor/binjgb/binjgb.js', import.meta.url);

/** @type {Promise<object>|null} single-flight cache — the core is loaded once */
let pending = null;

/**
 * @returns {Promise<object>} the instantiated Emscripten module
 */
export function loadCore() {
  if (pending) return pending;

  pending = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = CORE_URL.href;
    script.async = true;

    script.addEventListener('load', () => {
      const factory = globalThis.Binjgb;
      if (typeof factory !== 'function') {
        reject(new Error('binjgb.js loaded but did not define Binjgb()'));
        return;
      }
      // The factory is async and returns the ready module.
      factory({ locateFile: (file) => new URL(file, CORE_URL).href })
        .then(resolve, reject);
    });

    script.addEventListener('error', () => {
      reject(new Error(`could not load the emulator core (${CORE_URL.href})`));
    });

    document.head.appendChild(script);
  });

  // A failed load should not poison every later attempt.
  pending.catch(() => { pending = null; });

  return pending;
}

/**
 * Runtime base-path helpers for the appliance.
 *
 * The web bundle is built with Vite `base: '/__VIBE_BASE_PATH__/'`
 * (apps/web/vite.config.ts) and the container entrypoint
 * (apps/web/docker/web-entrypoint.sh) sed-replaces the sentinel
 * across html/js/css/json/map files at startup. So at runtime,
 * `import.meta.env.BASE_URL` is either:
 *   - "/"                   — standalone deploy (single-app)
 *   - "/<slug>/"            — Vibe-Appliance path-prefix routing
 *
 * BASE_PATH strips the trailing slash so it can be used as
 *   • a BrowserRouter `basename` (must not have trailing slash, "" = root)
 *   • a fetch URL prefix (apiUrl("/api/v1/...") works for both modes)
 */

export const BASE_PATH: string = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * Prepend the runtime base prefix to a leading-slash path.
 * Standalone:  apiUrl("/api/v1/auth/me") -> "/api/v1/auth/me"
 * Appliance:   apiUrl("/api/v1/auth/me") -> "/vibe-calculators/api/v1/auth/me"
 */
export function apiUrl(path: string): string {
  return BASE_PATH + path;
}

// Tile provider configuration (step 5: live basemaps).
//
// MapTiler is the only supported production tile provider. The API key must come
// from the environment (VITE_MAPTILER_KEY) — it is never hardcoded and .env is
// gitignored; .env.example carries a placeholder. A missing key is acceptable in
// local development only, where we fall back to the public OSM raster with a
// visible on-map warning. Production builds are guarded twice: a Vite build-time
// check fails the build without a key, and getTileProfile() throws at runtime as
// a backstop — so a MapTiler-less deployment is impossible, not merely defaulted.

export interface TileProfile {
  provider: 'maptiler' | 'osm-dev';
  /** Leaflet XYZ template. */
  urlTemplate: string;
  /** HTML attribution for the basemap provider. */
  attribution: string;
  /** True only for the development-only OSM fallback (drives the on-map warning). */
  devFallback: boolean;
  key?: string;
  style?: string;
}

export class TileConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TileConfigError';
  }
}

export interface TileConfigInput {
  provider?: string;
  key?: string;
  style?: string;
  /** import.meta.env.DEV */
  dev: boolean;
}

/**
 * Pure resolver (unit-testable). Never reads the environment itself.
 *
 * - provider 'maptiler' + key → MapTiler raster profile.
 * - provider 'maptiler' without a key → OSM public raster in dev only, otherwise
 *   a TileConfigError (production cannot silently fall back).
 * - provider 'osm' → explicit dev-only choice, also refused in production.
 */
export function resolveTileProfile(input: TileConfigInput): TileProfile {
  const provider = (input.provider || 'maptiler').trim().toLowerCase();
  const key = (input.key || '').trim();
  const style = (input.style || 'streets-v2').trim();

  if (provider === 'osm') {
    // Explicit opt-in to the public OSM raster — development only. Production
    // must use a provider with a private key so the app is never dependent on
    // a public tile server's usage policy.
    if (!input.dev) {
      throw new TileConfigError(
        'VITE_MAP_TILE_PROVIDER=osm is development-only. Production requires MapTiler tiles.'
      );
    }
    return {
      provider: 'osm-dev',
      urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      devFallback: true,
    };
  }

  if (provider !== 'maptiler') {
    throw new TileConfigError(
      `Unknown VITE_MAP_TILE_PROVIDER "${provider}". Supported: maptiler.`
    );
  }

  if (!key) {
    if (input.dev) {
      // Development fallback — never reachable in a production build thanks to
      // the vite.config.ts guard, and flagged on the map itself.
      return {
        provider: 'osm-dev',
        urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        devFallback: true,
      };
    }
    throw new TileConfigError(
      'VITE_MAPTILER_KEY is required for production. Set it in .env (MapTiler API key) and rebuild.'
    );
  }

  if (key.length < 8 || /\s/.test(key)) {
    throw new TileConfigError(
      'VITE_MAPTILER_KEY looks invalid: MapTiler keys are URL-safe tokens without spaces.'
    );
  }

  return {
    provider: 'maptiler',
    urlTemplate: `https://api.maptiler.com/maps/${encodeURIComponent(style)}/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`,
    attribution:
      '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    devFallback: false,
    key,
    style,
  };
}

let cached: TileProfile | null = null;
let cachedError: TileConfigError | null = null;

/**
 * Environment-backed profile for the browser bundle. Memoised per page load;
 * MapPanel catches TileConfigError and shows the misconfiguration banner.
 */
export function getTileProfile(): TileProfile {
  if (cached) return cached;
  if (cachedError) throw cachedError;
  try {
    cached = resolveTileProfile({
      provider: import.meta.env.VITE_MAP_TILE_PROVIDER,
      key: import.meta.env.VITE_MAPTILER_KEY,
      style: import.meta.env.VITE_MAPTILER_STYLE,
      dev: import.meta.env.DEV,
    });
    return cached;
  } catch (err) {
    cachedError = err instanceof TileConfigError ? err : new TileConfigError(String(err));
    throw cachedError;
  }
}
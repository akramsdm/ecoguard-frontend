import {api, ApiError} from './api';
import type {Category, MapAreaGeo, NearbyResponse, PlaceResult, SavedLocation} from './types';

// Public "near me" surface (step 6). Radius bounds mirror the backend knobs in
// app/public.py: DEFAULT_RADIUS_KM=10, MAX_RADIUS_KM=50; the server rejects
// anything outside 1..50 km. Every query is anonymous and rate-limited per IP.

export const MAX_RADIUS_KM = 50;
export const DEFAULT_RADIUS_KM = 10;
export const RADII_KM = [5, 10, 25, 50] as const;
export const CATEGORY_PATTERN = /^(wildlife|wetland|flood)$/;

// Uganda country bounds: the public map starts here (no location permission is
// ever requested automatically — only explicit GPS / pick / search actions).
// Shared by the public near-me page and the public landing map so both open on
// exactly the same country view.
export const UGANDA_BOUNDS: [[number, number], [number, number]] = [[-1.7, 28.8], [4.3, 35.1]];

/** Pure query-string builder for /public/nearby (unit-tested). */
export function nearbyQuery(
  lat: number,
  lon: number,
  radiusKm: number,
  category?: Category | '',
): string {
  const p = new URLSearchParams({
    lat: lat.toFixed(6),
    lon: lon.toFixed(6),
    radius_km: String(radiusKm),
  });
  if (category) p.set('category', category);
  return '/public/nearby?' + p.toString();
}

export function fetchNearby(
  lat: number,
  lon: number,
  radiusKm: number,
  category?: Category | '',
): Promise<NearbyResponse> {
  const clamped = Math.min(Math.max(radiusKm, 1), MAX_RADIUS_KM);
  return api<NearbyResponse>(nearbyQuery(lat, lon, clamped, category));
}

/** District boundary overlay for the public map: the already-anonymous
 * /areas-osm browse surface, one representative simplified polygon each. */
export function fetchDistricts(): Promise<MapAreaGeo[]> {
  return api<{items: Array<{id: number; name: string; area_type: string; simplified_geom: unknown}>}>(
    '/areas-osm?area_type=district&include_geometry=true&limit=200',
  ).then((r) => r.items.map((a) => ({
    id: a.id,
    name: a.name,
    area_type: a.area_type,
    assigned: false,
    geometry: (a.simplified_geom as {type: string; coordinates: unknown} | null) || null,
  })));
}

export function searchPlaces(q: string, limit = 8): Promise<{items: PlaceResult[]}> {
  return api<{items: PlaceResult[]}>(`/public/places?q=${encodeURIComponent(q)}&limit=${limit}`);
}

const CLIENT_ID_KEY = 'ecoguard:nearby:client_id';

/** Anonymous device id used to key the opt-in saved location (never an account). */
export function getClientId(): string {
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id || id.length > 64) {
      id = 'anon-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    // Storage unavailable (private mode): a fresh id per page load is fine.
    return 'anon-session-' + Date.now().toString(36);
  }
}

/** Opt-in save; the server coarsens BEFORE persisting (only the ~1 km grid point
 * is stored). Returns the coarsened value the server actually kept. */
export function savePreferredLocation(
  latitude: number,
  longitude: number,
  name?: string,
): Promise<SavedLocation> {
  return api<SavedLocation>('/public/preferred-location', {
    method: 'POST',
    body: JSON.stringify({client_id: getClientId(), latitude, longitude, name}),
  });
}

export async function loadPreferredLocation(): Promise<SavedLocation | null> {
  try {
    return await api<SavedLocation>(`/public/preferred-location?client_id=${encodeURIComponent(getClientId())}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export async function clearPreferredLocation(): Promise<void> {
  await api<void>(`/public/preferred-location?client_id=${encodeURIComponent(getClientId())}`, {method: 'DELETE'});
}
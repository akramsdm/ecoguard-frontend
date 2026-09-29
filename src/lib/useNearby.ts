import {useCallback, useEffect, useRef, useState} from 'react';
import {
  clearPreferredLocation, DEFAULT_RADIUS_KM, fetchNearby,
  loadPreferredLocation, nearbyQuery, savePreferredLocation, searchPlaces,
} from './nearby';
import type {
  Category, NearbyMethod, NearbyResponse, NearbySource, PlaceResult, SavedLocation,
} from './types';

/** Step-0 decision: the public "near me" surface polls (20 s), it does not use
 * the auth-gated SSE in AppShell. The server cache keys on the ~1 km grid cell,
 * so five volunteers polling the same cell share one backend hit.
 * Polling ticks are skipped while the document is hidden.
 */
export const NEARBY_POLL_MS = 20000;
export const SEARCH_DEBOUNCE_MS = 250;

export interface UseNearby {
  source: NearbySource;                        // GPS machine state
  gpsMessage: string;                          // human copy for denied/unsupported/error
  point: {lat: number; lon: number} | null;    // the ONE active query location
  method: NearbyMethod;
  radiusKm: number;
  category: Category | '';
  data: NearbyResponse | null;
  error: string;
  loading: boolean;
  saved: SavedLocation | null;
  center: {lat: number; lon: number; zoom: number} | null; // recentre the map (place search / saved load)
  searchText: string;
  places: PlaceResult[];
  searching: boolean;
  query: string;                               // current /public/nearby URL (display/tests)
  locate(): void;                              // explicit GPS button; no silent retry
  applyPick(lat: number, lon: number): void;   // manual map tap / marker drag
  choosePlace(p: PlaceResult): void;           // place-search hit
  clear(): void;
  setRadiusKm(n: number): void;
  setCategory(c: Category | ''): void;
  setSearchText(t: string): void;
  reload(): void;
  save(): Promise<void>;                       // opt-in: server coarsens to ~1 km before storing
  clearSaved(): Promise<void>;
}

export function useNearby(): UseNearby {
  const [source, setSource] = useState<NearbySource>('idle');
  const [gpsMessage, setGpsMessage] = useState('');
  const [point, setPoint] = useState<{lat: number; lon: number} | null>(null);
  const [method, setMethod] = useState<NearbyMethod>(null);
  const [radiusKm, setRadiusKm] = useState<number>(DEFAULT_RADIUS_KM);
  const [category, setCategory] = useState<Category | ''>('');
  const [data, setData] = useState<NearbyResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState<SavedLocation | null>(null);
  const [center, setCenter] = useState<UseNearby['center']>(null);
  const [searchText, setSearchText] = useState('');
  const [places, setPlaces] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [tick, setTick] = useState(0);         // poll ticks / manual reload
  const searchTimer = useRef<number | undefined>(undefined);
  const placeSeq = useRef(0);
  const dataSeq = useRef(0);

  // Auto-load the opt-in saved location (coarsened to ~1 km on the server) once.
  useEffect(() => {
    let active = true;
    loadPreferredLocation()
      .then((s) => {
        if (!active || !s) return;
        setSaved(s);
        setSource('ok');
        setMethod('saved');
        setPoint({lat: s.latitude, lon: s.longitude});
        setCenter({lat: s.latitude, lon: s.longitude, zoom: 10});
      })
      .catch(() => {/* network hiccup: stay in idle; user can still pick */});
    return () => { active = false; };
  }, []);

  // Explicit GPS fix. No silent retry: the button is always user-triggered and a
  // denial clears the active location instead of leaving a stale search point.
  const locate = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setSource('unsupported');
      setGpsMessage('This browser does not provide a GPS position.');
      return;
    }
    setSource('locating');
    setGpsMessage('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setSource('ok');
        setMethod('gps');
        setPoint({lat: pos.coords.latitude, lon: pos.coords.longitude});
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setSource('denied');
          setGpsMessage('Location permission was denied. You can tap the button again or pick a point on the map.');
        } else if (err.code === err.POSITION_UNAVAILABLE || err.code === err.TIMEOUT) {
          setSource('error');
          setGpsMessage('A position could not be determined right now. Try again or pick a point on the map.');
        } else {
          setSource('error');
          setGpsMessage('GPS could not be used. Pick a point on the map instead.');
        }
        setPoint(null);
      },
      {enableHighAccuracy: false, timeout: 10000, maximumAge: 30000},
    );
  }, []);

  const applyPick = useCallback((lat: number, lon: number) => {
    setSource('ok');
    setMethod('manual');
    setPoint({lat, lon});
  }, []);

  const choosePlace = useCallback((p: PlaceResult) => {
    setSource('ok');
    setMethod('place');
    setPoint({lat: p.lat, lon: p.lon});
    setCenter({lat: p.lat, lon: p.lon, zoom: 12});
    setSearchText(p.name);
    setPlaces([]);
  }, []);

  const clear = useCallback(() => {
    setPoint(null);
    setMethod(null);
    setSource('idle');
    setGpsMessage('');
    setData(null);
    setError('');
  }, []);

  // Debounced place search against /public/places (areas_osm + gazetteer).
  useEffect(() => {
    if (searchText.trim().length < 2) {
      setPlaces([]);
      setSearching(false);
      return;
    }
    const seq = ++placeSeq.current;
    setSearching(true);
    window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => {
      searchPlaces(searchText.trim())
        .then((r) => { if (seq === placeSeq.current) setPlaces(r.items); })
        .catch(() => { if (seq === placeSeq.current) setPlaces([]); })
        .finally(() => { if (seq === placeSeq.current) setSearching(false); });
    }, SEARCH_DEBOUNCE_MS);
    return () => { window.clearTimeout(searchTimer.current); };
  }, [searchText]);

  // Step-0 polling: 20 s while an active location exists (skip when hidden).
  useEffect(() => {
    if (!point) return;
    const id = window.setInterval(() => {
      if (!document.hidden) setTick((n) => n + 1);
    }, NEARBY_POLL_MS);
    return () => window.clearInterval(id);
  }, [!!point]);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  // Data fetch: only with an active location. In-flight responses are ignored
  // once a newer one has started (poll ticks can race a manual reload).
  useEffect(() => {
    if (!point) {
      setLoading(false);
      return;
    }
    const seq = ++dataSeq.current;
    setLoading(true);
    fetchNearby(point.lat, point.lon, radiusKm, category)
      .then((d) => {
        if (seq !== dataSeq.current) return;
        setData(d);
        setError('');
      })
      .catch((e: Error) => {
        if (seq === dataSeq.current) setError(e.message);
      })
      .finally(() => {
        if (seq === dataSeq.current) setLoading(false);
      });
  }, [point?.lat, point?.lon, radiusKm, category, tick]);

  const save = useCallback(async () => {
    if (!point) return;
    const coarsened = await savePreferredLocation(point.lat, point.lon);
    setSaved(coarsened);
  }, [point]);

  const clearSaved = useCallback(async () => {
    await clearPreferredLocation();
    setSaved(null);
  }, []);

  return {
    source, gpsMessage, point, method, radiusKm, category, data, error, loading,
    saved, center, searchText, places, searching,
    query: point ? nearbyQuery(point.lat, point.lon, radiusKm, category) : '',
    locate, applyPick, choosePlace, clear, setRadiusKm, setCategory, setSearchText,
    reload, save, clearSaved,
  };
}
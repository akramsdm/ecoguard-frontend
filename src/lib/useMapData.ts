import {useCallback,useEffect,useRef,useState} from 'react';
import {api} from './api';
import {useApp} from './context';
import type {GeoData} from './types';

// Viewport-scoped map data fetching (steps 4/5 client side).
//
// The map component reports its live viewport (bbox + zoom); this hook debounces
// those updates (~350ms), in-flight requests are cancelled, and every response is
// cached client-side keyed by the exact query, so panning back to a visited area
// is instant (warm cache skips the round trip). The opening request runs without
// a bbox (whole-scope default): before the first payload there is no map on
// screen to take a viewport from, so pages fetch once to mount MapPanel, whose
// first moveend then scopes every later request. Realtime events
// (reports./advisory./areas. updated) evict this view's cached scopes and refetch
// ONLY the currently visible bbox — never other viewports, never a full reload.
// Community/public maps pass realtime:false and keep a poll interval instead
// (the server cache makes polling cheap); interval screens always fetch so a poll
// can never be pinned by a stale client entry.
//
// The hook exposes the same {data,error,loading,reload,setData} surface as useData
// so screens swap over without presentation changes.

export interface MapViewport { bbox: string; zoom: number }

export interface MapDataOptions {
  view: 'community' | 'staff';
  category?: string;
  /** true when the map drives its own viewport through onViewportChange */
  viewport?: boolean;
  /** poll interval in ms (public/community maps). 0 = no polling. */
  interval?: number;
  /** subscribe to realtime events for scoped refetch (authed screens only) */
  realtime?: boolean;
}

/** Event kinds that can change what a map pixel shows. */
export const MAP_RELEVANT = /^(reports\.|advisory\.|areas\.)/;

const CACHE_LIMIT = 24;
const clientCache = new Map<string, GeoData>();

/** Query string sent to /map (pure, unit-tested). */
export function mapQuery(opts: { view: string; category?: string }, viewport: MapViewport | null): string {
  const parts = [`view=${opts.view}`];
  if (opts.category) parts.push(`category=${opts.category}`);
  if (viewport) {
    parts.push(`bbox=${viewport.bbox}`);
    parts.push(`zoom=${viewport.zoom}`);
  }
  return '/map?' + parts.join('&');
}

/** Client cache key for a scope (view+category+bounds, and the staff user id). */
export function mapCacheKey(
  opts: { view: string; category?: string },
  uid: string | undefined,
  viewport: MapViewport | null,
): string {
  const scope = opts.view === 'staff' ? `staff:${uid || 'anon'}` : 'community';
  const cat = opts.category || 'all';
  if (!viewport) return `view-${scope}:${cat}`;
  return `${scope}:${cat}:z${viewport.zoom}:${viewport.bbox}`;
}

/** Every cache-key prefix belonging to one view (viewport + mini-map shapes). */
function viewPrefixes(view: string, uid: string | undefined): string[] {
  if (view === 'staff') {
    const u = `staff:${uid || 'anon'}`;
    return [`${u}:`, `view-${u}:`, 'staff:'];
  }
  return ['community:', 'view-community:'];
}

/** Evict every cached scope for one view (pure, unit-tested). */
export function evictView(cache: Map<string, GeoData>, prefixes: string[]): number {
  let removed = 0;
  for (const k of [...cache.keys()]) {
    if (prefixes.some((p) => k.startsWith(p))) {
      cache.delete(k);
      removed += 1;
    }
  }
  return removed;
}

/** Test-only reset for the module-level client cache. */
export function __mapDataTestReset() {
  clientCache.clear();
}

export function useMapData(opts: MapDataOptions) {
  const {user, realtimeEvents} = useApp();
  const [data, setData] = useState<GeoData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  // `applied` is the debounced viewport the last fetch actually used.
  const [applied, setApplied] = useState<MapViewport | null>(null);
  const pendingVp = useRef<MapViewport | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const [poll, setPoll] = useState(0);
  const [force, setForce] = useState(0);
  const [rt, setRt] = useState(0);

  // Debounced viewport application: pans/zooms flood in; only the settled one
  // triggers a fetch.
  const scheduleViewport = useCallback((vp: MapViewport) => {
    pendingVp.current = vp;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (pendingVp.current) setApplied({...pendingVp.current});
    }, 350);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Realtime: on a map-relevant event, drop this view's cached scopes and bump rt
  // so the fetch effect re-runs for the CURRENT bbox only.
  useEffect(() => {
    if (!opts.realtime) return;
    if (!realtimeEvents.some((ev) => MAP_RELEVANT.test(ev.type))) return;
    evictView(clientCache, viewPrefixes(opts.view, user?.id));
    setRt((n) => n + 1);
  }, [realtimeEvents, opts.realtime, opts.view, user?.id]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const viewport = opts.viewport ? applied : null;
    if (opts.viewport && !applied && data) {
      // Viewport-driven maps refetch on the map's settled moveend. Between
      // settles (or before the first one once initial content is on screen)
      // keep serving current data — fetching a bbox nobody is looking at would
      // be wasted work. On first paint there is no map yet (pages mount
      // MapPanel only once data exists), so the code below fetches the default
      // no-bbox scope once; the panel's own first moveend then scopes it.
      setLoading(false);
      return () => { active = false; controller.abort(); };
    }
    const q = mapQuery(opts, viewport);
    const ck = mapCacheKey(opts, user?.id, viewport);
    const cached = clientCache.get(ck);
    if (cached && !opts.interval) {
      // Warm client cache: instant. Reload and realtime events evict first, so
      // they still reach the server. Polling screens always fetch.
      setData(cached);
      setError('');
      setLoading(false);
      return () => { active = false; controller.abort(); };
    }
    setLoading(true);
    if (opts.viewport) setError('');
    api<GeoData>(q, {signal: controller.signal})
      .then((d) => {
        if (!active) return;
        if (clientCache.has(ck)) clientCache.delete(ck); // refresh MRU order
        clientCache.set(ck, d);
        while (clientCache.size > CACHE_LIMIT) {
          const oldest = clientCache.keys().next().value as string | undefined;
          if (!oldest) break;
          clientCache.delete(oldest);
        }
        setData(d);
        setError('');
        setLoading(false);
      })
      .catch((e: Error) => {
        if (!active) return;
        if (!(e instanceof DOMException && e.name === 'AbortError')) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
    // rt: bump on relevant realtime events → scoped refetch. force: explicit reload.
    // poll: interval tick. applied: debounced viewport.
  }, [opts.view, opts.category, opts.viewport, applied, force, poll, rt, user?.id]);

  useEffect(() => {
    if (!opts.interval) return;
    const id = window.setInterval(() => {
      if (!document.hidden) setPoll((n) => n + 1);
    }, opts.interval);
    return () => window.clearInterval(id);
  }, [opts.interval]);

  const reload = useCallback(() => {
    // A manual refresh must bypass the client cache for this view.
    evictView(clientCache, viewPrefixes(opts.view, user?.id));
    setForce((n) => n + 1);
  }, [opts.view, user?.id]);

  const onViewport = useCallback((vp: MapViewport) => scheduleViewport(vp), [scheduleViewport]);

  return {data, error, loading, reload, setData, onViewport};
}
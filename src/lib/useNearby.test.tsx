/** @vitest-environment jsdom */
// React 19 only wires act() when this environment flag is set (jsdom).
(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
import React from 'react';
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import type {Root} from 'react-dom/client';
import {useNearby,NEARBY_POLL_MS,SEARCH_DEBOUNCE_MS} from './useNearby';
import {nearbyQuery,getClientId,DEFAULT_RADIUS_KM,MAX_RADIUS_KM,RADII_KM} from './nearby';
import type {NearbyResponse,PlaceResult,SavedLocation} from './types';

type HookResult = ReturnType<typeof useNearby>;
let captured: HookResult | null = null;
let root: Root | null = null;

const nearbyResponse = (count = 1): NearbyResponse => ({
  type: 'FeatureCollection',
  features: Array.from({length: count}, (_, i) => ({
    id: `adv-${i}`,
    type: 'Feature',
    geometry: {type: 'Point', coordinates: [31.1, 0.15]},
    properties: {
      id: `adv-${i}`, kind: 'case', category: 'wildlife', state: 'published',
      distance_km: 0.6, area_name: 'Community A',
      observed_at: '2026-09-01T10:00:00Z', published_at: '2026-09-02T10:00:00Z',
      location_precision: 'generalised',
    },
  })),
  clusters: [],
  areas: [],
  location_policy: 'generalised',
  attribution: '© OSM',
  debug: {source: 'cache', cache_key: 'public:nearby:all:r10:31.1,0.15'},
});

const placeHit: PlaceResult = {id: '9001', name: 'Community A', kind: 'place', area_type: null, lat: 0.15, lon: 31.1};

const savedFixture: SavedLocation = {
  client_id: 'anon-test-1', latitude: 0.1509, longitude: 31.1054, name: null, precision: 'generalised',
};

type Geo = {ok: (p: {coords: {latitude: number; longitude: number}}) => void; err: (e: any) => void};

function setGeolocation(kind: 'ok' | 'denied' | 'error' | 'none') {
  if (kind === 'none') {
    Object.defineProperty(navigator, 'geolocation', {value: undefined, configurable: true});
    return;
  }
  Object.defineProperty(navigator, 'geolocation', {
    value: {
      getCurrentPosition: (ok: Geo['ok'], err: (e: any) => void) => {
        if (kind === 'ok') ok({coords: {latitude: 0.15, longitude: 31.105}});
        else if (kind === 'denied') err({code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3});
        else err({code: 2, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3});
      },
    },
    configurable: true,
  });
}

interface FetchOptions {savedGet?: 'saved' | 'missing'; places?: PlaceResult[]}

function router(opts: FetchOptions = {}) {
  return async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = (init?.method || 'GET').toUpperCase();
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
    if (url.includes('/public/nearby')) {
      const n = url.match(/radius_km=(\d+)/);
      return json(nearbyResponse(parseInt(n?.[1] || '10', 10) >= 10 ? 1 : 0));
    }
    if (url.includes('/public/places')) return json({items: opts.places || [placeHit]});
    if (url.includes('/public/preferred-location')) {
      if (method === 'DELETE') return new Response(null, {status: 204});
      if (method === 'POST') return json({...savedFixture, latitude: 0.1509, longitude: 31.1054}, 201);
      return opts.savedGet === 'saved' ? json(savedFixture) : json({detail: 'Not found.'}, 404);
    }
    return json({detail: 'unexpected ' + url}, 500);
  };
}

function Probe() {
  captured = useNearby();
  return null;
}

function mount(opts: FetchOptions = {}, geo: 'ok' | 'denied' | 'error' | 'none' = 'none') {
  setGeolocation(geo);
  fetchMock.mockImplementation(router(opts));
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<Probe />));
}

const flush = async () => { await act(async () => {}); };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
  captured = null;
  root = null;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('pure helpers (lib/nearby)', () => {
  it('builds the /public/nearby query with fixed decimals and optional category', () => {
    expect(nearbyQuery(0.150001, 31.104999, 10)).toBe('/public/nearby?lat=0.150001&lon=31.104999&radius_km=10');
    expect(nearbyQuery(0.15, 31.1, 25, 'wildlife'))
      .toBe('/public/nearby?lat=0.150000&lon=31.100000&radius_km=25&category=wildlife');
  });

  it('exposes the documented radius knobs (10 km default, 50 km cap)', () => {
    expect(DEFAULT_RADIUS_KM).toBe(10);
    expect(MAX_RADIUS_KM).toBe(50);
    expect(RADII_KM).toEqual([5, 10, 25, 50]);
  });

  it('creates one stable anonymous client id per browser', () => {
    const a = getClientId();
    const b = getClientId();
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(8);
  });
});

describe('useNearby GPS machine', () => {
  it('GPS denied clears the active location and shows a message (no silent retry)', async () => {
    mount({}, 'denied');
    act(() => captured!.locate());
    await flush();
    expect(captured!.source).toBe('denied');
    expect(captured!.point).toBeNull();
    expect(captured!.gpsMessage).toContain('permission was denied');
    // Re-press is allowed but is an explicit user action, not an automatic retry.
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/public/nearby'))).toHaveLength(0);
  });

  it('GPS success becomes the active point and drives a nearby fetch', async () => {
    mount({}, 'ok');
    act(() => captured!.locate());
    await flush();
    expect(captured!.source).toBe('ok');
    expect(captured!.method).toBe('gps');
    expect(captured!.point).toEqual({lat: 0.15, lon: 31.105});
    const nearbyCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/public/nearby'));
    expect(nearbyCalls).toHaveLength(1);
    expect(String(nearbyCalls[0][0])).toContain('lat=0.150000&lon=31.105000&radius_km=10');
  });

  it('unsupported browser reports the state without throwing', async () => {
    mount({}, 'none');
    act(() => captured!.locate());
    await flush();
    expect(captured!.source).toBe('unsupported');
    expect(captured!.point).toBeNull();
  });

  it('manual pick and clear replace / remove the one active location', async () => {
    mount();
    act(() => captured!.applyPick(0.2, 32.5));
    await flush();
    expect(captured!.point).toEqual({lat: 0.2, lon: 32.5});
    expect(captured!.method).toBe('manual');
    act(() => captured!.clear());
    expect(captured!.point).toBeNull();
    expect(captured!.data).toBeNull();
    expect(captured!.source).toBe('idle');
  });
});

describe('useNearby place search + saved location', () => {
  it('debounces a place search and chooses the hit as the active location', async () => {
    vi.useFakeTimers();
    mount({places: [placeHit]});
    act(() => captured!.setSearchText('comm'));
    expect(captured!.searching).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS + 50); });
    expect(captured!.places).toEqual([placeHit]);
    act(() => captured!.choosePlace(placeHit));
    expect(captured!.point).toEqual({lat: 0.15, lon: 31.1});
    expect(captured!.method).toBe('place');
    expect(captured!.center).toEqual({lat: 0.15, lon: 31.1, zoom: 12});
  });

  it('auto-loads the opted-in saved location as the starting point', async () => {
    mount({savedGet: 'saved'});
    await flush();
    expect(captured!.saved).toEqual(savedFixture);
    expect(captured!.method).toBe('saved');
    expect(captured!.point).toEqual({lat: 0.1509, lon: 31.1054});
    expect(captured!.source).toBe('ok');
  });

  it('opt-in save coarsens via the server and clear removes it', async () => {
    mount({savedGet: 'missing'});
    await flush();
    act(() => captured!.applyPick(0.15111, 31.10666));
    await act(async () => { await captured!.save(); });
    expect(captured!.saved).toBeTruthy();
    expect(captured!.saved!.precision).toBe('generalised');
    // Must await the async act scope: an un-awaited async act leaks its scope
    // into the next test and corrupts the shared act queue.
    await act(async () => { await captured!.clearSaved(); });
    expect(captured!.saved).toBeNull();
  });
});

describe('useNearby polling (step-0 decision: 20 s, not SSE)', () => {
  it('polls /public/nearby every 20 s while a location is active', async () => {
    vi.useFakeTimers();
    mount({savedGet: 'missing'});
    await flush();
    act(() => captured!.applyPick(0.15, 31.1));
    await flush();
    const nearby = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes('/public/nearby'));
    expect(nearby()).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(NEARBY_POLL_MS); });
    expect(nearby()).toHaveLength(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(NEARBY_POLL_MS); });
    expect(nearby()).toHaveLength(3);
    // Clearing the location stops polling (no further ticks).
    act(() => captured!.clear());
    await act(async () => { await vi.advanceTimersByTimeAsync(NEARBY_POLL_MS * 2); });
    expect(nearby()).toHaveLength(3);
  });

  it('radius changes refetch immediately with the new radius', async () => {
    mount({savedGet: 'missing'});
    await flush();
    act(() => captured!.applyPick(0.15, 31.1));
    await flush();
    act(() => captured!.setRadiusKm(25));
    await flush();
    const last = String(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/public/nearby')).at(-1)?.[0]);
    expect(last).toContain('radius_km=25');
  });
});
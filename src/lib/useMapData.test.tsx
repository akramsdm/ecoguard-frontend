/** @vitest-environment jsdom */
// React 19 only wires act() when this environment flag is set (jsdom).
(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
import React from 'react';
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import type {Root} from 'react-dom/client';
import {AppContext} from './context';
import type {AppContextType} from './context';
import {useMapData,__mapDataTestReset,mapQuery,mapCacheKey,evictView} from './useMapData';
import type {GeoData} from './types';

type HookResult = ReturnType<typeof useMapData>;
let captured: HookResult | null = null;
let currentCtx: AppContextType;
let root: Root | null = null;

function geoFixture(tag: string): GeoData {
  return {
    type: 'FeatureCollection',
    features: [],
    clusters: [],
    areas: [],
    location_policy: 'staff',
    debug: {source: 'db', tag},
  } as GeoData;
}

const fetchMock = vi.fn(async (input: string) => {
  const url = String(input);
  return {ok: true, status: 200, json: async () => geoFixture('f' + url.length)} as unknown as Response;
});

function Probe({opts}: {opts: Parameters<typeof useMapData>[0]}) {
  captured = useMapData(opts);
  return null;
}

function makeCtx(over: Partial<AppContextType> = {}): AppContextType {
  return {
    user: {id: 'u1', name: 'Tester', email: 't@x.io', roles: ['reviewer']} as any,
    setUser: () => {},
    areas: [],
    config: null,
    draft: null,
    setDraft: () => {},
    saveLocal: async () => {},
    startDraft: () => {},
    notify: () => {},
    nav: () => {},
    logout: async () => {},
    mode: 'workspace',
    page: 'map',
    id: '',
    tab: '',
    refresh: 0,
    changed: () => {},
    realtimeTick: 0,
    realtimeEvents: [],
    ...over,
  } as AppContextType;
}

function mountApp(opts: Parameters<typeof useMapData>[0], over: Partial<AppContextType> = {}) {
  currentCtx = makeCtx(over);
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(
    <AppContext.Provider value={currentCtx}><Probe opts={opts} /></AppContext.Provider>
  ));
  return root;
}

function rerender(opts: Parameters<typeof useMapData>[0], over: Partial<AppContextType> = {}) {
  currentCtx = makeCtx(over);
  act(() => root!.render(
    <AppContext.Provider value={currentCtx}><Probe opts={opts} /></AppContext.Provider>
  ));
}

const flush = async () => { await act(async () => {}); };

beforeEach(() => {
  __mapDataTestReset();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  captured = null;
  currentCtx = makeCtx();
  root = null;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('mapQuery / mapCacheKey / evictView (pure helpers)', () => {
  it('composes the /map query with bbox+zoom only when a viewport exists', () => {
    expect(mapQuery({view: 'staff', category: 'wildlife'}, {bbox: '30,0,32,1', zoom: 10}))
      .toBe('/map?view=staff&category=wildlife&bbox=30,0,32,1&zoom=10');
    expect(mapQuery({view: 'community'}, null)).toBe('/map?view=community');
  });

  it('keys the client cache by view+category+bounds+staff-user', () => {
    expect(mapCacheKey({view: 'staff', category: 'wildlife'}, 'u1', {bbox: '30,0,32,1', zoom: 7}))
      .toBe('staff:u1:wildlife:z7:30,0,32,1');
    // Mini-maps (no viewport): view-scoped key.
    expect(mapCacheKey({view: 'community'}, undefined, null)).toBe('view-community:all');
  });

  it('evicts only the requested view scope', () => {
    const cache = new Map<string, GeoData>([
      ['staff:u1:all:z8:30,0,32,1', geoFixture('a')],
      ['view-staff:u1:all', geoFixture('b')],
      ['community:all:z6:31,0,33,1', geoFixture('c')],
    ]);
    expect(evictView(cache, ['staff:u1:', 'view-staff:u1:', 'staff:'])).toBe(2);
    expect([...cache.keys()]).toEqual(['community:all:z6:31,0,33,1']);
  });
});

describe('useMapData viewport fetching (steps 4/5)', () => {
  it('bootstraps with a default no-bbox fetch on first paint, then debounces the first viewport into one bbox+zoom request (regression: map pages hung on Loading)', async () => {
    vi.useFakeTimers();
    mountApp({view: 'staff', viewport: true, realtime: false});
    await flush();
    // On first paint there is no map yet (pages mount MapPanel only once data
    // exists), so a default scope is fetched immediately. The panel's first
    // moveend then scopes subsequent requests to the visible bbox.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/v1/map?view=staff');

    act(() => captured!.onViewport({bbox: '30,0,32,1', zoom: 8}));
    act(() => captured!.onViewport({bbox: '30,5,32,6', zoom: 8}));
    act(() => captured!.onViewport({bbox: '31,0,33,1', zoom: 9}));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const url = String(fetchMock.mock.calls[1][0]);
    expect(url).toContain('view=staff');
    expect(url).toContain('bbox=31,0,33,1');
    expect(url).toContain('zoom=9');
  });

  it('reuses the warm client cache when returning to a visited viewport', async () => {
    vi.useFakeTimers();
    mountApp({view: 'staff', viewport: true, realtime: false});
    act(() => captured!.onViewport({bbox: '30,0,32,1', zoom: 8}));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2); // default bootstrap + first viewport

    act(() => captured!.onViewport({bbox: '30,2,32,4', zoom: 10}));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Pan back to the first viewport: served from cache, no third request.
    act(() => captured!.onViewport({bbox: '30,0,32,1', zoom: 8}));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('refetches only the current bbox on relevant realtime events, ignoring unrelated ones', async () => {
    vi.useFakeTimers();
    mountApp({view: 'staff', viewport: true, realtime: true});
    act(() => captured!.onViewport({bbox: '30,0,32,1', zoom: 8}));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await flush();
    const base = fetchMock.mock.calls.length;
    expect(base).toBe(2); // default bootstrap + first viewport scope

    // reports.updated → evict this view, refetch ONLY the visible bbox.
    rerender({view: 'staff', viewport: true, realtime: true}, {
      realtimeEvents: [{type: 'reports.updated', object_id: 'r9', event: 'reports.updated', at: 1}],
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    await flush();
    expect(fetchMock.mock.calls.length).toBe(base + 1);
    expect(String(fetchMock.mock.calls[base][0])).toContain('bbox=30,0,32,1');

    // prediction.updated is not map-relevant → no refetch.
    rerender({view: 'staff', viewport: true, realtime: true}, {
      realtimeEvents: [{type: 'prediction.updated', object_id: 'p1', event: 'prediction.updated', at: 2}],
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    await flush();
    expect(fetchMock.mock.calls.length).toBe(base + 1);
  });

  it('mini-maps fetch once without a viewport (dashboard/overview path)', async () => {
    vi.useFakeTimers();
    mountApp({view: 'community', interval: 20000, realtime: true});
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/v1/map?view=community');
  });
});
import React,{useEffect,useRef,useState,useCallback} from 'react';
import {Badge,Notice} from './ui';
import type {GeoData,GeoFeature,MapAreaGeo} from '../lib/types';
import {getTileProfile,TileConfigError} from '../lib/tiles';
import type {MapViewport} from '../lib/useMapData';
import 'leaflet/dist/leaflet.css';

// Single shared map component (step 1 consolidation): incident map, overview
// mini-map, workspaces, community map and the admin area preview all render
// through MapPanel / AreaPolygonMap, so every screen gets the same tile profile,
// attributions and failure handling. All geometry handling stays client-side:
// nothing but the tile URL (with the provider key) ever touches the tile host.

const CAT_COLORS: Record<string, string> = {
  wildlife: '#a85615',
  flood: '#286581',
  wetland: '#1c694c',
};
const ASSIGNED_STYLE = {color:'#1c694c',weight:2.5,fillColor:'#1c694c',fillOpacity:0.18};
const MUTED_STYLE = {color:'#6b8f7e',weight:1.5,dashArray:'6 6',fillColor:'#9db8a8',fillOpacity:0.06};
const DEFAULT_VIEW: [number, number] = [0.3, 31.1];
const DEFAULT_ZOOM = 7;

function categoryColor(category: string) {
  return CAT_COLORS[category] || '#5b8a72';
}

/** Shared banner region: dev-fallback warning, tile-failure banner, record badge. */
function MapStatus({devFallback, tileError, configError, count}: {
  devFallback: boolean; tileError: boolean; configError: string; count: number;
}) {
  return (
    <div className="map-top">
      {!!configError && (
        <div className="map-banner error" role="alert">
          Map configuration error: {configError}
        </div>
      )}
      {!configError && devFallback && (
        <div className="map-banner warn" role="status">
          Development-only tile source (OpenStreetMap). Configure VITE_MAPTILER_KEY before production.
        </div>
      )}
      {!configError && tileError && (
        <div className="map-banner error" role="alert">
          Map tiles failed to load — check VITE_MAPTILER_KEY / your network. Markers
          and boundary overlays still render, since they come from the EcoGuard API.
        </div>
      )}
      <Badge>{count} mapped records</Badge>
    </div>
  );
}

function captions(profileLabel: string) {
  return `Basemap: ${profileLabel} • Community markers show area centres, not animal positions.`;
}

interface MapPanelProps {
  data: GeoData;
  onSelect?: (f: GeoFeature) => void;
  onViewportChange?: (v: MapViewport) => void;
  large?: boolean;
  /** Automatically fit to the data. False for viewport-driven maps (the viewer navigates). */
  fit?: boolean;
  height?: number | string;
}

export function useMapPanel(containerRef: React.RefObject<HTMLDivElement | null>) {
  const mapRef = useRef<any>(null);
  const rootRef = useRef<any>(null);
  const LRef = useRef<any>(null);
  const onViewportRef = useRef<((v: MapViewport) => void) | null>(null);
  const [ready, setReady] = useState(false);
  const [tileError, setTileError] = useState(false);
  const [configError, setConfigError] = useState('');
  const [devFallback, setDevFallback] = useState(false);
  const [count, setCount] = useState(0);

  const setOnViewport = useCallback((fn: ((v: MapViewport) => void) | null) => {
    onViewportRef.current = fn;
  }, []);

  useEffect(() => {
    let active = true;
    setReady(false);
    let profile: ReturnType<typeof getTileProfile> | null = null;
    try {
      profile = getTileProfile();
    } catch (err) {
      if (err instanceof TileConfigError) setConfigError(err.message);
      else setConfigError(String(err));
    }
    import('leaflet')
      .then((module) => {
        if (!active || !containerRef.current) return;
        const L = module.default || module;
        LRef.current = L;
        const map = L.map(containerRef.current, {
          attributionControl: true,
          scrollWheelZoom: false,
        }).setView(DEFAULT_VIEW, DEFAULT_ZOOM);
        mapRef.current = map;
        const layers = L.layerGroup().addTo(map);
        rootRef.current = layers;
        if (profile) {
          const layer = L.tileLayer(profile.urlTemplate, {
            maxZoom: 19,
            attribution: profile.attribution,
          });
          layer.on('tileerror', () => { if (active) setTileError(true); });
          layer.on('tileload', () => { if (active) setTileError(false); });
          layer.addTo(map);
          setDevFallback(profile.devFallback);
        }
        // Both attributions are always visible: the basemap's (MapTiler or OSM)
        // plus the ODbL boundary attribution for the areas_osm overlays.
        map.attributionControl.addAttribution(
          'Boundary data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (ODbL)'
        );
        map.on('moveend', () => {
          const fn = onViewportRef.current;
          if (!fn) return;
          const b = map.getBounds();
          fn({
            bbox: `${b.getWest().toFixed(4)},${b.getSouth().toFixed(4)},${b.getEast().toFixed(4)},${b.getNorth().toFixed(4)}`,
            zoom: Math.round(map.getZoom()),
          });
        });
        setReady(true);
        setTimeout(() => map.invalidateSize(), 60);
      })
      .catch(() => {
        if (active && !configError) setConfigError('Spatial rendering library could not load.');
      });
    const ro = new ResizeObserver(() => {
      try { mapRef.current?.invalidateSize(); } catch {}
    });
    if (containerRef.current) ro.observe(containerRef.current);
    return () => {
      active = false;
      ro.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
      rootRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef]);

  const renderGeo = useCallback((data: GeoData, fit: boolean, onSelect?: (f: GeoFeature) => void) => {
    const map = mapRef.current;
    const L = LRef.current;
    const root = rootRef.current;
    if (!map || !L || !root) return;
    root.clearLayers();
    const points: [number, number][] = [];
    const polygonLayerBounds: any[] = [];

    const features = data.features || [];
    const clusters = data.clusters || [];
    const areas = data.areas || [];

    for (const a of areas) {
      if (!a.geometry) continue;
      const layer = L.geoJSON(a.geometry, {
        style: a.assigned ? ASSIGNED_STYLE : MUTED_STYLE,
      });
      const label = a.assigned
        ? (a.name ? `${a.name} — assigned to you` : 'Area boundary')
        : (a.name ? `${a.name} — outside your assignment` : 'Area boundary');
      layer.bindTooltip(label, {direction: 'center'});
      root.addLayer(layer);
      polygonLayerBounds.push(layer);
    }

    for (const f of features) {
      const p = f.geometry.coordinates;
      points.push([p[1], p[0]]);
      const redacted = f.properties.redacted;
      const marker = L.circleMarker([p[1], p[0]], {
        radius: redacted ? 7 : 10,
        color: '#fff', weight: 3,
        fillColor: redacted ? '#7b8d84' : categoryColor(f.properties.category),
        fillOpacity: redacted ? 0.55 : 1,
      });
      marker.bindTooltip(redacted ? 'Restricted case' : (f.properties.title || 'Case'));
      if (onSelect) marker.on('click', () => onSelect(f));
      root.addLayer(marker);
    }

    for (const c of clusters) {
      const p = c.geometry.coordinates;
      points.push([p[1], p[0]]);
      const icon = L.divIcon({
        className: 'map-cluster',
        html: `<b>${c.properties.count}</b>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      });
      const marker = L.marker([p[1], p[0]], {icon});
      const cats = Object.entries(c.properties.categories || {})
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      marker.bindTooltip(`${c.properties.count} records in this cluster (${cats})`, {direction: 'top'});
      marker.on('click', () => {
        // Zoom in: the viewport change triggers a refetch that disaggregates the cluster.
        const z = Math.min(map.getZoom() + 1, 18);
        map.setView([p[1], p[0]], z);
      });
      root.addLayer(marker);
    }

    setCount(features.length + clusters.length);

    if (fit) {
      if (points.length) {
        map.fitBounds(points, {padding: [45, 45], maxZoom: 10});
      } else if (polygonLayerBounds.length) {
        const bnd = new L.LatLngBounds([]);
        for (const layer of polygonLayerBounds) bnd.extend(layer.getBounds());
        if (bnd.isValid()) map.fitBounds(bnd, {padding: [16, 16], maxZoom: 11});
      }
    }
  }, []);

  return {ready, tileError, configError, devFallback, count, renderGeo, setOnViewport, setCount};
}

export function MapPanel({data, onSelect, onViewportChange, large = false, fit = true, height}: MapPanelProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const {ready, tileError, configError, devFallback, count, renderGeo, setOnViewport} = useMapPanel(ref);

  useEffect(() => {
    setOnViewport(onViewportChange || null);
  }, [onViewportChange, setOnViewport]);

  const prevData = useRef<GeoData | null>(null);
  useEffect(() => {
    if (!ready) return;
    // Do not autofit again when a realtime refetch returns the same viewport:
    // only the very first paint fits.
    const first = prevData.current === null;
    prevData.current = data;
    renderGeo(data, fit && first, onSelect);
  }, [data, ready, fit, onSelect, renderGeo]);

  return (
    <div className={'map-panel ' + (large ? 'large' : '')}>
      <div ref={ref} className="leaflet-container-host" style={height ? {height} : undefined} />
      {!ready && !configError && <span className="map-loading">Preparing map…</span>}
      <MapStatus devFallback={devFallback} tileError={tileError} configError={configError} count={count} />
      <div className="map-caption">{captions(devFallback ? 'OpenStreetMap (development fallback)' : 'MapTiler')}</div>
    </div>
  );
}

/** Static single/multi-polygon preview (admin area browser, report area context). */
export function AreaPolygonMap({geojson, height = 240}: {geojson: any; height?: number}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const {ready, tileError, configError, devFallback, renderGeo} = useMapPanel(ref);

  useEffect(() => {
    if (!ready) return;
    renderGeo({
      type: 'FeatureCollection',
      features: [],
      clusters: [],
      areas: [
        {id: 0, name: '', area_type: '', assigned: true, geometry: geojson} as MapAreaGeo,
      ],
      location_policy: '',
    }, true);
  }, [ready, geojson, renderGeo]);

  return (
    <div className="stack">
      <div ref={ref} style={{height}} className="leaflet-container-host" />
      {!ready && !configError && <span className="map-loading">Preparing map…</span>}
      {configError ? (
        <Notice>Map configuration error: {configError}</Notice>
      ) : devFallback ? (
        <Notice>Development-only tile source (OpenStreetMap). Configure VITE_MAPTILER_KEY before production.</Notice>
      ) : tileError ? (
        <Notice>Map tiles failed to load — check VITE_MAPTILER_KEY / your network. The polygon below still renders from the EcoGuard API.</Notice>
      ) : null}
    </div>
  );
}
import React,{useEffect,useState} from 'react';
import {useApp} from '../lib/context';
import {useNearby} from '../lib/useNearby';
import {fetchDistricts, MAX_RADIUS_KM, RADII_KM, UGANDA_BOUNDS} from '../lib/nearby';
import {MapPanel} from '../components/MapPanel';
import {Button,Card,Notice,Loading,ErrorBox,PageHead,Icon,Badge,Empty,date,nice,categoryIcon} from '../components/ui';
import type {GeoData,MapAreaGeo,NearbyCaseFeature} from '../lib/types';

export function Nearby() {
  const {nav, notify, user} = useApp();
  const n = useNearby();
  const [districts, setDistricts] = useState<MapAreaGeo[]>([]);
  const [saving, setSaving] = useState(false);

  // District boundary overlay: fetched once from the already-anonymous
  // /areas-osm surface, not on every 20 s poll.
  useEffect(() => {
    let active = true;
    fetchDistricts().then((d) => { if (active) setDistricts(d); }).catch(() => {});
    return () => { active = false; };
  }, []);

  // Adapt the public payload to the shared MapPanel contract: the nearby case
  // carries exactly CASE_FIELDS (no title/body/reporter), so the panel's title
  // slot is filled with the category label and nothing sensitive is repeated.
  const geoData: GeoData | null = n.data
    ? {
        ...n.data,
        areas: districts,
        features: n.data.features.map((f) => ({
          id: f.id,
          type: 'Feature' as const,
          geometry: f.geometry,
          properties: {
            id: f.id,
            title: nice(f.properties.category),
            category: f.properties.category,
            state: f.properties.state,
            area_name: f.properties.area_name,
            precision: f.properties.location_precision,
            kind: 'case',
          },
        })),
      }
    : null;

  async function saveLocation() {
    if (!n.point || saving) return;
    setSaving(true);
    try {
      await n.save();
      notify('Location saved for your next visit. Only a rounded ~1 km point is kept.');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const busy = n.loading && !n.data;

  return (
    <>
      <PageHead label="NEAR ME" title="What's near you right now?"
        subtitle="Only human-reviewed, currently-published advisories appear within your chosen radius. Positions are generalised to a ~1 km grid."/>
      <div className="nearby-grid">
        <section className="nearby-controls">
          <Card>
            <h3>Your location</h3>
            {n.point ? (
              <p className="location-status">
                <span className="dot dot-ok" aria-hidden/>
                Using {n.method === 'gps' ? 'your GPS position' : n.method === 'manual' ? 'a point you picked' : n.method === 'place' ? `“${n.searchText}”` : 'your saved location'}:
                {" "}{n.point.lat.toFixed(3)}°, {n.point.lon.toFixed(3)}°
                <Badge>{radiusLabel(n.radiusKm)}</Badge>
              </p>
            ) : (
              <p className="location-status muted">No location yet — use GPS, search for a place, or tap the map.</p>
            )}
            <div className="nearby-actions">
              <Button icon="map" disabled={n.source === 'locating'} onClick={n.locate}>
                {n.source === 'locating' ? 'Locating…' : n.source === 'ok' ? 'Use GPS again' : 'Use my location'}
              </Button>
              <Button variant="ghost" onClick={n.clear} disabled={!n.point}>Clear location</Button>
            </div>
            {(n.source === 'denied' || n.source === 'error' || n.source === 'unsupported') && n.gpsMessage && (
              <Notice tone="amber">{n.gpsMessage}</Notice>
            )}
            <details className="privacy-note">
              <summary>How is my position used?</summary>
              <p>Your exact position is sent only as the search centre for this request and is never stored. If you save the location for a future visit, the server keeps only a coarsened point rounded to roughly a 1 km grid. You can remove it at any time.</p>
            </details>
          </Card>

          <Card>
            <h3>Find a place</h3>
            <label className="searchbox"><Icon name="search" size={16}/>
              <input type="search" value={n.searchText} placeholder="Search districts, towns, villages…"
                onChange={(e) => n.setSearchText(e.target.value)} autoComplete="off"/>
              {n.searching && <span className="search-spinner" aria-label="Searching…"/>}
            </label>
            {n.places.length > 0 && (
              <ul className="place-results" role="listbox">
                {n.places.map((p) => (
                  <li key={`${p.kind}-${p.id}`}>
                    <button onClick={() => n.choosePlace(p)}>
                      <Icon name={p.kind === 'area' ? 'drop' : 'home'} size={16}/>
                      <span><strong>{p.name}</strong><small>{p.kind === 'place' ? 'village / town point' : p.area_type || 'area'}</small></span>
                      <Icon name="arrow" size={15}/>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h3>Search radius & categories</h3>
            <div className="tabrow">
              {RADII_KM.map((r) => (
                <button key={r} className={'tab ' + (n.radiusKm === r ? 'active' : '')} onClick={() => n.setRadiusKm(r)}>{r} km</button>
              ))}
            </div>
            <div className="tabrow">
              {(['', 'wildlife', 'wetland', 'flood'] as const).map((c) => (
                <button key={c} className={'tab ' + (n.category === c ? 'active' : '')} onClick={() => n.setCategory(c)}>{c ? nice(c) : 'All'}</button>
              ))}
            </div>
            <small>Radius is capped at {MAX_RADIUS_KM} km.</small>
            {n.point && (
              <div className="save-row">
                {n.saved ? (
                  <div className="saved-location">
                    <span><Icon name="check" size={15}/> Saved here — rounded to ~1 km: {n.saved.latitude.toFixed(3)}°, {n.saved.longitude.toFixed(3)}°</span>
                    <Button variant="ghost small" onClick={() => n.clearSaved().catch((e) => notify((e as Error).message))}>Remove</Button>
                  </div>
                ) : (
                  <Button variant="ghost" disabled={saving} onClick={saveLocation}>
                    {saving ? 'Saving…' : 'Save this location for next visit'}
                  </Button>
                )}
              </div>
            )}
          </Card>
          <Notice tone="blue"><Icon name="lock" size={15}/> {n.data?.location_policy || 'Precise fixes are never exposed on the public map.'}</Notice>
        </section>

        <section className="nearby-map">
          <MapPanel
            data={geoData || {type: 'FeatureCollection', features: [], clusters: [], areas: districts, location_policy: n.data?.location_policy || '', debug: undefined}}
            fit={false}
            large
            initialBounds={UGANDA_BOUNDS}
            locationMarker={n.point}
            pickMode
            onPick={n.applyPick}
            center={n.center}
          />
          <p className="map-hint">Tap the map to place the marker, or drag it to fine-tune. The nearby list updates below.</p>

          {busy ? <Loading/> : n.error ? <ErrorBox message={n.error} retry={n.reload}/> : n.data ? (
            <Card>
              <div className="row between"><h3>Nearby advisories</h3><Badge>{n.data.features.length} within {n.radiusKm} km</Badge></div>
              {n.data.features.length ? (
                <div className="nearby-list">
                  {n.data.features.map((f) => (
                    <CaseRow key={f.id} f={f} canOpen={!!user} onOpen={() => nav('alertdetail', 'community', f.id)}/>
                  ))}
                </div>
              ) : (
                <Empty title="Nothing nearby yet" action={<Button variant="ghost" onClick={n.clear}>Clear location</Button>}>
                  No reviewed advisory is currently published within {n.radiusKm} km of your point. Try a larger radius (up to {MAX_RADIUS_KM} km) or another location.
                </Empty>
              )}
              <small className="refresh-note">Updated every 20 seconds.</small>
            </Card>
          ) : <Empty title="Choose a location" action={<Button onClick={n.locate} icon="map">Use my location</Button>}/>}
        </section>
      </div>
      <Button variant="ghost" onClick={() => nav('map')}><Icon name="map" size={16}/> Community map (country-wide view)</Button>
    </>
  );
}

function radiusLabel(km: number): string {
  return `${km} km radius`;
}

/** A nearby case row. The advisory detail page is auth-gated, so the row is
 * only actionable for signed-in users; anonymous visitors see the same public
 * fields inline (category, area, distance, published date — nothing more). */
function CaseRow({f, canOpen, onOpen}: {f: NearbyCaseFeature; canOpen: boolean; onOpen: () => void}) {
  const inner = (
    <>
      <Icon name={categoryIcon(f.properties.category)}/>
      <span className="grow">
        <strong>{nice(f.properties.category)}</strong>
        <small>{f.properties.area_name} • published {f.properties.published_at ? date(f.properties.published_at) : 'recently'}</small>
      </span>
      <span className="distance"><strong>{f.properties.distance_km.toFixed(1)}</strong><small>km away</small></span>
      {canOpen && <Icon name="arrow"/>}
    </>
  );
  return canOpen
    ? <button className="report-row" onClick={onOpen}>{inner}</button>
    : <div className="report-row">{inner}</div>;
}
import React,{useEffect,useMemo,useState} from 'react';
import {useApp} from '../lib/context';
import {useNearby} from '../lib/useNearby';
import {useMapData} from '../lib/useMapData';
import {fetchDistricts, MAX_RADIUS_KM, RADII_KM, UGANDA_BOUNDS} from '../lib/nearby';
import {startReportIntent} from '../lib/landing';
import {MapPanel} from '../components/MapPanel';
import {Button,Card,Notice,Loading,ErrorBox,Brand,Icon,Badge,Empty,date,nice,categoryIcon} from '../components/ui';
import type {GeoData,MapAreaGeo,NearbyCaseFeature,Category} from '../lib/types';

/**
 * Public landing (root route) for signed-out visitors.
 *
 * The map is Prompt 6's public map, unmodified: the same MapPanel fed by the
 * community `/map` viewport data (area-centre pins only) that opens on the same
 * Uganda country bounds as the near-me page, with the district boundary overlay
 * reused from `fetchDistricts()`. Search and the three location methods (live
 * GPS, manual map pick, place search) come straight from `useNearby()` — the
 * same hook the near-me page uses — so there is no second implementation to
 * drift. Everything here is anonymous; only "Report" needs an account, and it
 * parks the intent so sign-in continues into the existing report flow.
 *
 * Layout choice: a floating top menu over a full-viewport map, with the location
 * / search / browse tools in one collapsible side sheet. It keeps the map as the
 * primary surface (the brief) while the four menu actions stay one tap away, and
 * on narrow screens the sheet becomes a bottom sheet.
 */
export function PublicLanding(){
  const {nav,startDraft,user}=useApp();
  const n=useNearby();
  const [districts,setDistricts]=useState<MapAreaGeo[]>([]);
  const [showBoundaries,setShowBoundaries]=useState(true);
  const [picking,setPicking]=useState(false);
  const [sheetOpen,setSheetOpen]=useState(()=>typeof window==='undefined'||window.innerWidth>=1000);
  // The community view already carries published advisories and every open case
  // at its area centre; anonymous callers get the exact same public payload.
  const map=useMapData({view:'community',category:n.category||undefined,viewport:true,interval:20000,realtime:false});

  // District boundary overlay: fetched once from the already-anonymous
  // /areas-osm surface, never on every poll (matches the near-me page).
  useEffect(()=>{let active=true;fetchDistricts().then(d=>{if(active)setDistricts(d)}).catch(()=>{});
    return()=>{active=false};},[]);

  const geoData:GeoData=useMemo(()=>({
    type:'FeatureCollection',
    features:map.data?.features||[],
    clusters:map.data?.clusters||[],
    areas:showBoundaries?districts:[],
    location_policy:map.data?.location_policy||'Precise fixes are never exposed on the public map.',
    debug:map.data?.debug,
  }),[map.data,districts,showBoundaries]);

  const advisories=(map.data?.features||[]).filter(f=>f.properties.kind==='advisory');
  const cases=(map.data?.features||[]).filter(f=>f.properties.kind==='report');

  /** Report is the only gated action: park the intent (with any chosen point)
   *  and enter the existing sign-in flow; the shell completes the journey. */
  function report(){
    if(user){startDraft('wildlife');nav('upload','community');return;}
    startReportIntent('wildlife',n.point);
    nav('signin');
  }
  function openSearch(){setSheetOpen(true);focusSection('landing-search');}
  function openLocation(){setSheetOpen(true);focusSection('landing-location');}
  function focusSection(id:string){
    window.setTimeout(()=>document.getElementById(id)?.scrollIntoView({block:'start',behavior:'smooth'}),0);
  }

  return <div className="landing-wrap">
    <div className="landing-map">
      <MapPanel
        data={geoData}
        height="100%"
        large
        fit={false}
        initialBounds={UGANDA_BOUNDS}
        locationMarker={n.point}
        pickMode={picking}
        onPick={(lat,lon)=>{n.applyPick(lat,lon);setPicking(false);}}
        center={n.center}
        onViewportChange={map.onViewport}
        onSelect={()=>setSheetOpen(true)}
      />
    </div>

    <header className="landing-menu" role="banner">
      <span className="landing-brand"><Brand/></span>
      <div className="landing-actions">
        <Button variant="ghost small" icon="paw" onClick={report}><span className="menu-label">Report</span></Button>
        <Button variant="ghost small" icon="search" onClick={openSearch}><span className="menu-label">Search</span></Button>
        <Button variant="ghost small" icon="pin" onClick={openLocation}><span className="menu-label">Location</span></Button>
        <Button variant="ghost small" icon="map" onClick={()=>setShowBoundaries(v=>!v)} aria-pressed={showBoundaries}><span className="menu-label">Boundaries</span></Button>
        <Button variant="small" onClick={()=>nav('signin')} icon="arrow"><span className="menu-label">Sign in</span></Button>
      </div>
    </header>

    <Card className="landing-intro">
      <strong>EcoGuard Uganda</strong>
      <p>Explore human-reviewed advisories and open cases across Uganda. No account
        is needed to look around — markers are district centres, never exact positions.</p>
      <small>Reporting and case details need a free account.</small>
    </Card>

    {sheetOpen&&<aside className="landing-sheet" aria-label="Search, location and public cases">
      <div className="landing-sheet-head">
        <strong>Explore</strong>
        <div className="row">
          <Button variant="ghost small" onClick={()=>setShowBoundaries(v=>!v)} aria-pressed={showBoundaries}>{showBoundaries?'Hide boundaries':'Show boundaries'}</Button>
          <button className="link" onClick={()=>setSheetOpen(false)} aria-label="Close panel">Close</button>
        </div>
      </div>
      <div className="landing-sheet-body">
        <section id="landing-search">
          <h3>Find a place</h3>
          <label className="searchbox"><Icon name="search" size={16}/>
            <input type="search" value={n.searchText} placeholder="Search districts, towns, villages…"
              onChange={(e)=>n.setSearchText(e.target.value)} autoComplete="off"/>
            {n.searching&&<span className="search-spinner" aria-label="Searching…"/>}
          </label>
          {n.places.length>0&&<ul className="place-results" role="listbox">
            {n.places.map(p=><li key={`${p.kind}-${p.id}`}>
              <button onClick={()=>n.choosePlace(p)}>
                <Icon name={p.kind==='area'?'drop':'home'} size={16}/>
                <span><strong>{p.name}</strong><small>{p.kind==='place'?'village / town point':p.area_type||'area'}</small></span>
                <Icon name="arrow" size={15}/>
              </button>
            </li>)}
          </ul>}
        </section>

        <section id="landing-location">
          <h3>Location</h3>
          <p className="muted small">Use live GPS, pick a point on the map, or search above. The public map only ever shows a ~1 km area centre.</p>
          <div className="location-actions">
            <Button variant="ghost small" icon="pin" disabled={n.source==='locating'} onClick={n.locate}>{n.source==='locating'?'Getting location…':'Use live location'}</Button>
            <Button variant={picking?'small':'ghost small'} icon="map" onClick={()=>setPicking(v=>!v)}>{picking?'Tap the map…':'Choose on map'}</Button>
          </div>
          {n.gpsMessage&&<small className="gps-note" role="status">{n.gpsMessage}</small>}
          {n.point?<div className="saved-location">
            <span><Icon name="check" size={15}/> Active point: {n.point.lat.toFixed(3)}°, {n.point.lon.toFixed(3)}°{n.saved?' (saved, rounded)':''}</span>
            <Button variant="ghost small" onClick={n.clear}>Clear</Button>
          </div>:<small className="muted">No location chosen yet.</small>}
          {n.point&&!n.saved&&<Button variant="ghost small" disabled={n.loading} onClick={()=>n.save().catch(()=>{})}>Save this location for next visit</Button>}
          {n.saved&&<Button variant="ghost small" onClick={()=>n.clearSaved().catch(()=>{})}>Remove saved location</Button>}
        </section>

        <section id="landing-nearby">
          <div className="row between"><h3>Nearby cases</h3><Badge>{n.data?`${n.data.features.length} within ${n.radiusKm} km`:'—'}</Badge></div>
          <div className="tabrow">
            {RADII_KM.map(r=><button key={r} className={'tab '+(n.radiusKm===r?'active':'')} onClick={()=>n.setRadiusKm(r)}>{r} km</button>)}
          </div>
          <small className="muted">Radius is capped at {MAX_RADIUS_KM} km.</small>
          {!n.point?<Empty title="Choose a location" action={<Button onClick={n.locate} icon="pin">Use my location</Button>}>
              Pick a point to list reviewed advisories published near it.
            </Empty>
            :n.error?<ErrorBox message={n.error} retry={n.reload}/>
            :n.loading&&!n.data?<Loading/>
            :n.data?.features.length?<div className="nearby-list">
              {n.data.features.map(f=><NearbyRow key={f.id} f={f}/>)}
            </div>
            :<Empty title="Nothing nearby yet">No reviewed advisory is currently published within {n.radiusKm} km of this point.</Empty>}
        </section>

        <section id="landing-browse">
          <div className="row between"><h3>Advisories &amp; open cases</h3><small className="muted">Pins are area centres</small></div>
          <div className="tabrow">
            {(['','wildlife','wetland','flood'] as const).map(c=><button key={c} className={'tab '+(n.category===c?'active':'')} onClick={()=>n.setCategory(c)}>{c?nice(c):'All'}</button>)}
          </div>
          {map.error?<ErrorBox message={map.error} retry={map.reload}/>
            :advisories.length||cases.length?<>
              {advisories.map(f=><div key={f.id} className="report-row case-row">
                <span className="iconbox"><Icon name={categoryIcon(f.properties.category)}/></span>
                <span>{f.properties.title}<small>{f.properties.area_name} • published advisory</small></span>
                <Badge tone="green">Advisory</Badge>
              </div>)}
              {cases.length>0&&<div className="map-section-head"><strong>Open cases</strong><small>Case details stay private to the reporter and assigned staff.</small></div>}
              {cases.map(f=><div key={f.id} className="report-row case-row">
                <span className="iconbox"><Icon name={categoryIcon(f.properties.category)}/></span>
                <span>{f.properties.title||nice(f.properties.category)}<small>{f.properties.area_name}</small></span>
                <Badge>{nice(f.properties.state)}</Badge>
              </div>)}
            </>
            :<Empty title="Nothing to show yet">No published advisory or open case is in view. Pan or zoom the map.</Empty>}
          <small className="muted">Sign in to open advisory details. Updated every 20 seconds.</small>
        </section>

        <Notice tone="blue"><Icon name="lock" size={15}/> {geoData.location_policy}</Notice>
      </div>
    </aside>}
  </div>;
}

/** A nearby (published-advisory) row: the same public fields the near-me page
 *  shows. The advisory detail page is account-gated, so anonymous visitors read
 *  the fields inline rather than being sent to a sign-in wall. */
function NearbyRow({f}:{f:NearbyCaseFeature}){
  return <div className="report-row">
    <Icon name={categoryIcon(f.properties.category)}/>
    <span className="grow">
      <strong>{nice(f.properties.category)}</strong>
      <small>{f.properties.area_name} • published {f.properties.published_at?date(f.properties.published_at):'recently'}</small>
    </span>
    <span className="distance"><strong>{f.properties.distance_km.toFixed(1)}</strong><small>km away</small></span>
  </div>;
}

export default PublicLanding;

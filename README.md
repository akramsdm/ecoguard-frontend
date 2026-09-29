# EcoGuard Uganda — frontend

Community environmental intelligence. Vite + React SPA that talks to the
EcoGuard API. In development it proxies `/api/v1` to the local backend; on
Vercel it is baked to `VITE_API_BASE_URL` at build time and shares a session
cookie with the API domain.

## Run locally

```bash
npm install
API_PROXY_TARGET=http://localhost:8000 npm run dev
```

## Build

```bash
npm run build
```

## Image assistance

The reporter can ask the API to suggest a species for an uploaded photo. The
model runs **on the API, not in the browser** — there is no model code or
inference in this bundle, and no weights are shipped to the client. The app
calls `POST /api/v1/evidence` then `POST /api/v1/predictions` and renders
whatever the API returns.

The UI is deliberately worded so a suggestion is never read as a confirmed
identification:

- States are shown in plain language — `completed` renders as "Suggestion
  ready", not "Identified". See `PREDICTION_STATE` in `src/components/ui.tsx`.
- The reporter sees "Model confidence: 87%. This is a candidate, not
  confirmation." and a one-tap "Use candidate as a suggestion" that only
  pre-fills the species field. A human still submits, and a reviewer still
  confirms.
- Provenance: the reporter is told "SpeciesNet whole-image classifier"; the
  review workspace shows the exact `model_version` next to the candidate.
- The API's whole-image classifier returns no detection boxes, so the app does
  not draw any. `boxes` is always `[]`.
- A prediction never sets `reports.species` and never approves a case.

`GET /api/v1/config` supplies `image_assistance`:

| State | Meaning in the UI |
| --- | --- |
| `ready` | suggestions are available |
| `degraded` | not available right now — the app keeps manual species entry working |
| `not_configured` | turned off server-side |

`degraded` is intentionally broad: it covers *still loading* (the API needs
~30 s to load the model at startup), *model or weights absent*, and *load
failed*. The reporter only ever sees that suggestions are unavailable; the
reason is an operator concern. **Assistance being unavailable must never block
reporting** — a human always confirms the species.

## Troubleshooting

**Suggestions unavailable but you expected them.** Check the API, not the
browser:

```bash
curl localhost:8000/api/v1/config
docker compose logs api | grep '\[AI\]'
```

The API client sends `cache: 'no-store'` and `image_assistance` is read live on
every `/config` call, so **reloading the page will not fix this**. A `degraded`
state means the model genuinely is not loaded in the API process.

**The UI still shows the old behaviour after changing API code.** A page refresh
is not enough, because the stale thing is the container, not the browser cache:

```bash
docker compose up -d --build api
```

Confirm the rebuild really replaced the running container with
`docker compose ps` and `docker compose logs api | grep '\[AI\]'` before
concluding a change had no effect. This is the most common way to believe the
feature is broken when it is simply not deployed.

## Deploy (Vercel)

Project `ecoguard` → `https://ecoguard.vercel.app`.
Set `VITE_API_BASE_URL=https://ecoguard-api.vercel.app/api/v1` in the Vercel
project for production, and set `VITE_MAPTILER_KEY` to your MapTiler key — the
build fails without it. The workspace signs in against the live API and
subscribes to `/api/v1/stream` (SSE) for realtime updates.

Note that Vercel has no SpeciesNet runtime, so production reports
`image_assistance: "degraded"` and the app hides the suggestion flow. That is
expected. Set `IMAGE_ASSISTANCE=disabled` on the Vercel API project to make
that explicit.

## Live maps (step 5: basemaps, viewport fetching, realtime)

Every map screen renders through the same `MapPanel` / `AreaPolygonMap`
(`src/components/MapPanel.tsx`). Basemap configuration comes from the
environment — keys are never hardcoded:

| Variable | Meaning |
| --- | --- |
| `VITE_MAP_TILE_PROVIDER` | `maptiler` (default). `osm` is development-only. |
| `VITE_MAPTILER_KEY` | MapTiler API key. **Required for any production build.** |
| `VITE_MAPTILER_STYLE` | Raster style id, default `streets-v2`. |

Copy `.env.example` → `.env` and put your real key there (`.env` is
gitignored). Without a key:

- `npm run dev` still works — maps fall back to the public OSM raster and show
  a **development-only tile source** warning banner on the map.
- `npm run build` **fails** with a clear message: the OSM fallback must never
  ship to production, and `VITE_MAPTILER_KEY` is missing or invalid. The
  runtime `getTileProfile()` error is only a second line of defence.

Tile-load failures show a distinct **"Map tiles failed to load"** banner; the
boundary overlays and markers still render because they come from the EcoGuard
API, not from the tile server.

Maps fetch from `GET /api/v1/map` with the live `bbox` + `zoom` (debounced
~350 ms client-side, cached per viewport in an LRU of 24). Low zoom levels
return server-side clusters; higher levels return individual points plus the
assigned-area polygon overlays from `areas_osm`. Responses are cached server
side keyed by `view + category + zoom + bbox` (per user for staff).

**Realtime.** The authenticated `/stream` (SSE) subscription lives once in
`AppShell` and is open only for signed-in users (closed on logout). Staff map
screens evict their cached viewport scopes and re-fetch only the visible bbox
on `reports.` / `advisory.` / `areas.` events. The **public community map does
not subscribe anonymously** — the stream is session-only and its metadata would
leak internal ids and activity timing, so it polls every 20 s (the server cache
keeps that cheap).

## Area management (OSM geographic areas)

Staff areas come from the OSM import (`areas_osm`), not from hand-drawn
circles, and every area-scoped UI reads the assignments the API returns.

- **Team & settings → team.** Each account's row shows its assigned OSM areas
  as badges. The create/edit form's **"Assigned OSM areas"** picker searches
  and multi-selects real areas (district, park, reserve …) by name/alias and
  saves their numeric ids. This replaced the legacy "assigned communities"
  checkboxes, which sent legacy keys that the PostGIS backend now rejects with
  422. The picker only offers areas that are `active` for assignment; the API
  refuses to save areas an administrator has deactivated.
- **Team & settings → areas.** The former "community centroids" management
  (legacy `/admin/areas` circles) was replaced by an **OSM area catalogue**:
  search + type filter + pagination, an `Active`/`Inactive` gate with an
  admin-only toggle (audited, non-destructive), and a **coverage** pane showing
  per-area open/total case counts and assigned-staff counts (areas needing
  staff flagged). Clicking an area name loads its detail with a polygon preview
  (`AreaPolygonMap`, from `GET /areas-osm/{id}`).
- **Overview.** Staff accounts see **"Your assigned areas"** with live open-case
  counts, served by `GET /my-areas`.
- **Admin page.** The "Area coverage" tile and card now use
  `GET /admin/areas-osm/coverage` (OSM areas with staff / open-case load)
  instead of the legacy circle list.
- **Out-of-area staff.** Redacted reports render as "Restricted case" rows in
  every list, the verification page shows a limited-facts read card instead of
  crashing on the withheld fields, the incident map lists them as "Restricted
  case", and the assign dropdown no longer filters by the report's (legacy)
  area key — the API validates overlap and answers 422/403.
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
project for production. The workspace signs in against the live API and
subscribes to `/api/v1/stream` (SSE) for realtime updates.

Note that Vercel has no SpeciesNet runtime, so production reports
`image_assistance: "degraded"` and the app hides the suggestion flow. That is
expected. Set `IMAGE_ASSISTANCE=disabled` on the Vercel API project to make
that explicit.
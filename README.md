# Routecast

A mobile-friendly, web-first pre-trip weather planner. Enter two cities, select the intended locations, and choose a departure time in the origin's timezone. Routecast draws a real driving route and shows hourly forecasts at estimated arrival points along it.

**Status: local development preview, not deployed or production-ready.** There are no accounts, payments, email signup, saved routes, native apps, sharing links, traffic predictions or navigation. The original roadmap remains in `routecast-build-plan.md`, explicitly marked historical.

## Run locally

Use Node 22.12+ (tested on Node 24) and npm:

```sh
npm ci
cp .env.example .env
npm run dev
```

Open http://127.0.0.1:5173. Copying `.env.example` explicitly enables limited public services for **private noncommercial evaluation only**. No keys or accounts are required. Do not enable this configuration for commercial development, a promotional site, a public launch or a shared server. Read [PROVIDERS.md](PROVIDERS.md) first. Without the flag the UI runs, but API requests return an actionable disabled-provider error.

Try **La Vernia** → **Midland**, selecting **Texas, United States** for both. A city match is mandatory; the app never silently takes the first geocoder result. Street addresses and waypoints are not supported.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium --only-shell
npm run test:ui
```

Playwright uses its installed Chromium by default. Set `CHROMIUM_PATH` if using a compatible system browser. The browser suite tests desktop and iPhone-sized Chromium viewports; it is not Safari device certification. All ordinary tests use clearly identified synthetic fixtures and intercept network requests, including tiles. Fixtures are only in `tests/`, not exposed as live results in the app.

An optional live test sends a small number of city-level requests; never run it in CI or a loop:

```sh
RUN_LIVE_PROVIDERS=1 npx vitest run tests/live.test.ts
```

The opt-in browser check exercises the real API plus either loaded tiles or an explicit tile-failure notice:

```sh
ROUTECAST_DEV_PROVIDERS=1 RUN_LIVE_PROVIDERS=1 npm run test:ui -- tests/ui/live.spec.ts --project desktop
```

`npm run build` produces static files in `dist/`. `npm run preview` verifies that output, with API access explicitly disabled. A static host alone cannot provide live lookups. No deployment has been configured.

## How it works

- React + TypeScript + Vite frontend, Leaflet map, plain CSS using the original dark blue/orange palette.
- A Vite development-only Node middleware provides `GET /api/places?q=...` and `POST /api/trip`. It validates inputs, bounds concurrency, serializes and caches upstream requests, caps upstream attempts at 1,000 per rolling day, and uses 15-second upstream timeouts. It does not proxy arbitrary URLs or log trip bodies.
- Open-Meteo geocoding returns disambiguated city matches and IANA timezones. Luxon interprets the departure in the **origin's** zone, independent of the browser's timezone. Nonexistent spring-forward times and ambiguous fall-back times are rejected with instructions to choose a different time.
- OSRM full GeoJSON geometry plus per-segment duration annotations determines sample coordinates. Segment timing is normalized to the returned route duration; it is not uniform-speed distance sampling. Drives up to 48 hours get 2–8 samples, roughly hourly until the eight-point cap.
- Open-Meteo returns seven days of hourly weather as UTC epoch seconds. Each stop uses the nearest available hour (at most 30 minutes away), after strict coverage checks. Missing values stay missing; arrival outside coverage never uses the last available hour as a substitute.
- Timeline times all use the origin timezone with date and abbreviation. Destination arrival also displays its own timezone. This handles cross-zone trips without mixing clocks in the timeline.
- Every field edit cancels/invalidates the previous UI lookup. Sequence guards discard late responses; submit buttons prevent duplicate concurrent submission. Already-sent server/provider work may finish and populate cache. Explicit retries reuse successful cached requests; failed requests are not cached.
- One or all weather failures keep the route and label missing stops. Map tile failure leaves the geometry/timeline available and adds a notice. No weather or route data is invented.

## Limits and next work

Forecast samples can miss hazardous conditions between points. Route times exclude traffic, breaks, closures and real-time changes. City centers can snap to nearby roads (snaps over 10 km are rejected). No route alternatives, stopovers, trucks/EV constraints, road advisories or emergency alerts. No turn-by-turn instructions or safety classification.

Before a public release: choose and authorize production routing/geocoding/weather/tile services; implement a production API with shared quotas/cache and monitoring; review privacy/terms for actual hosting; add deployment and cross-browser/device validation. Do not deploy the Vite development server. See [PROVIDERS.md](PROVIDERS.md) for the specific licensing/usage blockers.

# Verification record — 2026-11-14

This is evidence of a local development run, not a deployment or current forecast. Test location inputs were city centers only: La Vernia and Midland, Texas.

## Passed checks

- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run format:check` — passed.
- `npm test` — 34 tests passed; opt-in live test skipped by default.
- `npm run build` — passed. Vite emitted non-blocking upstream Zod PURE-comment warnings.
- `npm run test:ui` — 12 tests passed across desktop and iPhone-sized Chromium; two opt-in live project cases skipped by default.
- `RUN_LIVE_PROVIDERS=1 npx vitest run tests/live.test.ts` — one real-provider integration test passed.
- `ROUTECAST_DEV_PROVIDERS=1 RUN_LIVE_PROVIDERS=1 npm run test:ui -- tests/ui/live.spec.ts --project desktop` — one real browser/API test passed, including the explicit map-tile fallback.
- `npm audit --omit=dev --audit-level=high` — zero reported runtime dependency vulnerabilities.
- `git diff --check` — passed.

The offline suite covers DST gaps/overlaps, origin-timezone interpretation, past/distant departures, forecast coverage and nulls, segment-duration sampling, no route, same city, partial/all weather failures, network failures, explicit retries, cached/in-flight request reuse, provider pacing and daily budget, API validation/access gating, city disambiguation, repeated submissions and stale-response cancellation. Browser fixtures are synthetic and are not shipped as application data.

## Real-provider observation

At 2026-11-14 15:58:17 UTC, the live browser/API flow returned:

- La Vernia → Midland: 349 miles, 376 driving minutes.
- 3,620 route geometry points and 8 of 8 weather samples available.
- Departure: 2026-11-14 16:00 UTC (10:00 AM America/Chicago).

See [machine-readable summary](live-summary.json) and [captured desktop result](live-desktop.png). These values are a test snapshot, not a route recommendation or live forecast for a reader.

## Verification limitation

Real OpenStreetMap background tiles could not load from the hosted test environment (`ERR_EMPTY_RESPONSE`; a separate HTTP diagnostic also reported provider access blocking). The real route geometry, numbered stops, forecast timeline and visible tile-failure notice rendered correctly. Successful live basemap loading therefore remains unverified here and should be checked from the intended local network. No alternate source or invented tile data was used to disguise the failure.

The initial system Chromium launch failed due to an environment socket restriction. Playwright's pinned 1.56.1 headless Chromium installed from its official fallback CDN and completed the tests. The separate cloud-browser route to localhost was unavailable; the final verification used the local Playwright browser.

This is Chromium viewport coverage, not physical iOS/Safari certification. Public/commercial hosting remains deliberately disabled pending authorized production providers and a production API; see [PROVIDERS.md](../../PROVIDERS.md).

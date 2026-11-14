# Provider decisions and production limits

Checked against official documentation on **2026-11-14**. No service accounts were created and no paid service was activated. These are limited local development defaults, not an entitlement to free commercial operation. Recheck policies before release.

| Component | Preview choice | Conditions and implementation |
| --- | --- | --- |
| City lookup | Open-Meteo geocoding / GeoNames | Explicit city search only, up to eight matches, user selects the administrative region/country; no keystroke autocomplete. Server cache: 10 minutes. |
| Route | OSRM demonstration server, OpenStreetMap road data | Reasonable noncommercial use only, maximum 1 request/second, no SLA. Gateway serializes upstream requests with at least 1.1 seconds between starts. Routes cached one hour. Identifying Routecast User-Agent, visible OSRM/OSM attribution and “Fix the map” link. |
| Forecast | Open-Meteo hosted free API | Noncommercial only; published limits are below 10,000/day, 5,000/hour and 600/minute. At most eight weather requests per trip, cached ten minutes. No claims of unlimited access. Temperature °F, wind mph, precipitation probability and WMO conditions; seven-day hourly forecast. |
| Map | Leaflet + standard OpenStreetMap raster tiles | HTTPS official tile URL, visible OSM attribution; browser sends normal Referer/User-Agent and respects HTTP cache headers. Viewport tiles only, no prefetch, bulk download, offline download or cache-busting. Best-effort availability, not a production SLA. |

The local single-process gateway also caps upstream attempts at 1,000 per rolling 24 hours. The counter is in memory and resets when the process stops; it is not a production-wide quota. Do not run multiple copies to evade provider limits. No API keys are put in frontend code. The provider gateway is enabled only in Vite's `development` mode with `ROUTECAST_DEV_PROVIDERS=1`; preview builds always return 503 for API requests. Static builds do not contain the server gateway.

## Official references

- [OSRM demo server](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server): reasonable noncommercial use and request ceiling.
- [FOSSGIS routing service policy and privacy](https://routing.openstreetmap.de/about.html): required attribution, identification, request rate and linked complete usage terms.
- [OSRM API](https://project-osrm.org/docs/v5.24.0/api/): `overview=full`, GeoJSON, per-segment `annotations=duration`, route durations and waypoint snapping.
- [Open-Meteo terms](https://open-meteo.com/en/terms): hosted free API noncommercial restriction, quotas, data licensing and provider logging.
- [Open-Meteo forecast API](https://open-meteo.com/en/docs): available horizon, hourly variables, Unix timestamps and units.
- [Open-Meteo geocoding API](https://open-meteo.com/en/docs/geocoding-api): city search, coordinates, timezone and GeoNames attribution.
- [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/): attribution, identification, caching and no bulk downloads.
- [Google Directions policies](https://developers.google.com/maps/documentation/directions/policies): route results displayed on a map must be displayed on a Google map. The historical plan's Google Directions + Mapbox renderer is not used.

## Production requirements

Commercial or promotional operation cannot use these OSRM demonstration/Open-Meteo free defaults. Obtain an appropriate commercial agreement or self-host compatible services, with the user's approval before incurring cost. Open-Meteo data's CC BY 4.0 license does not override hosted-service access restrictions. OpenStreetMap's open data license likewise does not guarantee unlimited hosted tile access.

Replace the development middleware with a production API and configurable, authorized providers. Add shared rate limits and budgets, cancellation, resilient caching, operational logs with a retention/privacy policy, monitoring and a tile host suitable for projected traffic. Keep attribution visible and provider secrets server-side. Do not simply enable the preview flag on a public server. No production credentials, billing, hosting or deployment have been set up here.

## Privacy/data flow

Browser → local Routecast API: city queries, selected city metadata, departure local time. Local API → geocoder: city query; → OSRM: city-center coordinates; → Open-Meteo: sampled coordinates (the server chooses arrival hours from the forecast response). Browser → OSM tile server: visible map tile coordinates. Each provider sees connection metadata. No precise-device geolocation, email, auth or payment data is requested. Routecast only retains page state and a bounded in-memory response cache; provider logging is subject to the linked policies.

> **Historical roadmap — superseded for the first working preview (2026-11-14).**
> Read README.md and PROVIDERS.md for the implementation and current provider policies.
> The Google Directions + Mapbox combination below is not implemented. Open-Meteo's hosted free API is noncommercial and rate limited, not unlimited free commercial access. Pricing, sharing, storage, auth and deployment ideas below remain unimplemented. This document is retained as planning history.

# Routecast — Claude Code Build Plan

> Hand this document to Claude Code at the start of every session.
> It is the source of truth for what we're building, how it's structured, and what to build next.

---

## What This Is

Routecast is a pre-trip weather planning app for road trippers. You enter an origin, destination, and departure time. You get back a map of your exact route with weather conditions overlaid — color-coded by severity — and a timeline strip showing what you'll drive through, hour by hour, timed to when you'll actually be there.

**The core insight:** Weather apps show you what's happening now. Routecast shows you what's happening at each point on your route when you'll actually arrive there. That's the whole product.

---

## Decisions Already Made

- **Web first** (React + Vite), not React Native. Ship fast, validate, go native later.
- **No auth for MVP.** Routes are saved in localStorage. No accounts.
- **Free tier:** 3 route lookups per month (tracked in localStorage).
- **Paid tier:** Unlimited lookups + shareable links. ($2.99/mo — Stripe integration deferred post-MVP)
- **No turn-by-turn.** This is a planning tool, not a navigation replacement.
- **No real-time alerts.** Pre-trip only for now.

---

## Tech Stack

```
Frontend:   React 18 + Vite + TypeScript
Styling:    Tailwind CSS
Maps:       Mapbox GL JS (free tier — use for rendering only)
Routing:    Google Maps Directions API (route + polyline + step durations)
Weather:    Open-Meteo API (completely free, no API key needed)
Backend:    Node.js + Fastify (single API service)
Database:   None for MVP (localStorage on client, in-memory cache on server)
Hosting:    Vercel (frontend) + Railway (backend)
```

**API Keys needed (store in .env, never commit):**
```
GOOGLE_MAPS_API_KEY=    # console.cloud.google.com — enable Directions API
VITE_MAPBOX_TOKEN=      # mapbox.com — public token, safe to expose
```

---

## File Structure

```
routecast/
├── apps/
│   ├── web/                          # React frontend
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── RouteSearch.tsx   # Origin / destination / departure inputs
│   │   │   │   ├── RouteMap.tsx      # Mapbox map with weather pins + colored route
│   │   │   │   ├── WeatherStrip.tsx  # Scrollable timeline below the map
│   │   │   │   ├── WeatherPin.tsx    # Individual map marker component
│   │   │   │   └── LoadingState.tsx  # Skeleton while fetching
│   │   │   ├── hooks/
│   │   │   │   ├── useRouteWeather.ts  # Main data fetching hook
│   │   │   │   └── useUsageLimit.ts    # Free tier 3/month tracking
│   │   │   ├── lib/
│   │   │   │   ├── api.ts            # Typed fetch wrapper for backend
│   │   │   │   └── mapUtils.ts       # Mapbox helpers, color mapping
│   │   │   ├── types.ts              # Shared TypeScript types
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   └── tailwind.config.ts
│   │
│   └── api/                          # Fastify backend
│       ├── src/
│       │   ├── routes/
│       │   │   └── routeWeather.ts   # POST /route-weather
│       │   ├── services/
│       │   │   ├── RouteService.ts   # Google Maps Directions API
│       │   │   ├── WeatherService.ts # Open-Meteo API
│       │   │   └── RouteWeather.ts   # Core orchestration — the real product
│       │   ├── utils/
│       │   │   ├── polyline.ts       # Decode Google's encoded polyline format
│       │   │   └── sampling.ts       # Sample N points along a route
│       │   └── index.ts              # Server entry point
│       ├── package.json
│       └── tsconfig.json
│
├── .env                              # Never commit this
├── .env.example                      # Commit this — shows required keys
└── package.json                      # Root — workspace scripts
```

---

## Core Data Types

Define these in `apps/web/src/types.ts` and import everywhere:

```typescript
export type WeatherCondition =
  | 'clear'
  | 'partly-cloudy'
  | 'cloudy'
  | 'rain'
  | 'heavy-rain'
  | 'snow'
  | 'heavy-snow'
  | 'storm'
  | 'fog'
  | 'wind';

export interface WeatherPoint {
  lat: number;
  lng: number;
  arriveAt: string;        // ISO 8601 — when the user will be at this point
  tempF: number;
  condition: WeatherCondition;
  precipChance: number;    // 0–100
  windMph: number;
  visibilityMiles: number;
  icon: string;            // emoji — ☀️ 🌤️ ⛅ 🌧️ 🌨️ ⛈️ 🌫️ 💨
}

export interface RouteData {
  polyline: string;          // Encoded Google polyline
  durationSeconds: number;
  distanceMeters: number;
  summary: string;           // e.g. "I-70 W"
}

export interface RouteWeatherResult {
  route: RouteData;
  weatherPoints: WeatherPoint[];
  overallSeverity: 'clear' | 'caution' | 'warning' | 'severe';
  generatedAt: string;       // ISO 8601
}

export interface TripInput {
  origin: string;
  destination: string;
  departAt: string;          // ISO 8601
}
```

---

## API Endpoint

### `POST /route-weather`

**Request:**
```json
{
  "origin": "Denver, CO",
  "destination": "Aspen, CO",
  "departAt": "2024-01-15T14:00:00-07:00"
}
```

**Response:** `RouteWeatherResult` (see types above)

**Error responses:**
```json
{ "error": "ROUTE_NOT_FOUND", "message": "Could not find a route between those locations." }
{ "error": "WEATHER_UNAVAILABLE", "message": "Weather forecast not available for this date range." }
{ "error": "INVALID_INPUT", "message": "departAt must be within the next 16 days." }
```

---

## The Core Algorithm

This is the most important file in the project: `apps/api/src/services/RouteWeather.ts`

Build it in this exact order. Do not skip steps.

```typescript
async function getRouteWeather(input: TripInput): Promise<RouteWeatherResult> {

  // STEP 1 — Get route from Google Maps Directions API
  // Returns: encoded polyline, total duration in seconds, array of steps
  // Each step has: duration_seconds, start_location {lat, lng}
  const route = await getRoute(input.origin, input.destination);

  // STEP 2 — Decode polyline to [lat, lng] array
  // Google uses their own encoding format. Use the @mapbox/polyline package.
  // Returns ~100–500 points depending on route length
  const points = decodePolyline(route.polyline);

  // STEP 3 — Sample 15 evenly-spaced points
  // Don't use every point — that's too many API calls.
  // Take every Nth point to get exactly 15, always including first and last.
  const samples = sampleEvenly(points, 15);

  // STEP 4 — Calculate ETA at each sampled point
  // Walk through Google's step array. Each step has a duration.
  // Accumulate durations to know how many seconds into the trip each step is.
  // Match each sampled point to the nearest step, add accumulated duration to departAt.
  const timedSamples = assignETAs(samples, route.steps, new Date(input.departAt));

  // STEP 5 — Fetch weather for each {lat, lng, arriveAt}
  // Open-Meteo endpoint: https://api.open-meteo.com/v1/forecast
  // Params: latitude, longitude, hourly=temperature_2m,precipitation_probability,
  //         windspeed_10m,weathercode,visibility
  // Match each point's arriveAt to the nearest hourly slot in the response.
  // Batch by making one request per unique location (don't batch into one call — 
  // Open-Meteo doesn't support multi-location in one request).
  // Run all 15 requests in parallel with Promise.all — takes ~500ms total.
  const weatherData = await fetchWeatherBatch(timedSamples);

  // STEP 6 — Map Open-Meteo WMO weather codes to our WeatherCondition type
  // WMO codes: 0=clear, 1-3=partly cloudy, 45-48=fog, 51-67=rain, 71-77=snow,
  //            80-82=showers, 85-86=snow showers, 95-99=thunderstorm
  // See: https://open-meteo.com/en/docs#weathervariables

  // STEP 7 — Determine overall severity for the route
  // If any point is snow/storm → 'severe'
  // If any point is heavy-rain/wind → 'warning'
  // If any point is rain/partly-cloudy → 'caution'
  // Otherwise → 'clear'

  return {
    route: {
      polyline: route.polyline,
      durationSeconds: route.duration,
      distanceMeters: route.distance,
      summary: route.summary,
    },
    weatherPoints: weatherData,
    overallSeverity: calculateSeverity(weatherData),
    generatedAt: new Date().toISOString(),
  };
}
```

---

## UI Layout

Three stacked zones. Keep it simple — no sidebars, no modals for MVP.

```
┌──────────────────────────────────────┐
│  SEARCH BAR                          │
│  [From: Denver, CO          ]        │
│  [To: Aspen, CO             ]        │
│  [Leaving: Today · 2:00 PM ▾]        │
│  [    Check My Route    ]            │
├──────────────────────────────────────┤
│                                      │
│  MAP (Mapbox)                        │
│  - Route line colored green→red      │
│  - Weather pins at sampled points    │
│  - Each pin shows: icon + temp       │
│                                      │
├──────────────────────────────────────┤
│  TIMELINE STRIP (horizontal scroll)  │
│  2pm   2:30  3pm   3:30  4pm   4:30  │
│  ☀️72° 🌤️69° 🌬️61° 🌧️54° 🌨️38° ❄️31°  │
│  ████░░░░░░░░░░░░░░░░░░░░░░░░ route  │
└──────────────────────────────────────┘
```

---

## Route Line Color Mapping

Color the route polyline itself by condition. This is the visual "wow" moment.

```typescript
export function conditionToColor(condition: WeatherCondition): string {
  const map: Record<WeatherCondition, string> = {
    'clear':        '#22c55e',   // green
    'partly-cloudy':'#86efac',   // light green
    'cloudy':       '#94a3b8',   // gray
    'fog':          '#cbd5e1',   // light gray
    'wind':         '#eab308',   // yellow
    'rain':         '#f97316',   // orange
    'heavy-rain':   '#ef4444',   // red
    'snow':         '#ef4444',   // red
    'heavy-snow':   '#7f1d1d',   // dark red
    'storm':        '#7f1d1d',   // dark red
  };
  return map[condition] ?? '#94a3b8';
}
```

To draw a multi-colored route line in Mapbox:
- Add each segment as a separate GeoJSON LineString layer
- Each segment is the polyline between two consecutive sampled points
- Color each segment by the condition at the starting point

---

## Usage Limit (Free Tier)

Track in localStorage. No backend needed for MVP.

```typescript
const MONTHLY_LIMIT = 3;
const STORAGE_KEY = 'routecast_usage';

interface UsageRecord {
  month: string;    // "2024-01" format
  count: number;
}

function getUsageThisMonth(): number { ... }
function incrementUsage(): void { ... }
function isAtLimit(): boolean { ... }
```

When user hits the limit, show a simple inline message:
> "You've used your 3 free route checks this month. Unlimited access coming soon — join the waitlist."

Link the waitlist CTA to the landing page email form.

---

## Build Order

Follow this exactly. Don't jump ahead.

### Phase 1 — Backend core (do this first, everything else depends on it)

1. Scaffold Fastify server with TypeScript
2. Add `.env` loading, CORS for localhost:5173
3. Build `RouteService.ts` — call Google Maps Directions API, return polyline + steps
4. Build `polyline.ts` utility — decode Google's encoded polyline
5. Build `sampling.ts` utility — sample N evenly spaced points, assign ETAs
6. Build `WeatherService.ts` — call Open-Meteo, map WMO codes to WeatherCondition
7. Build `RouteWeather.ts` — orchestrate steps 3–6
8. Wire up `POST /route-weather` route
9. **Test with curl before touching the frontend:**
```bash
curl -X POST http://localhost:3000/route-weather \
  -H "Content-Type: application/json" \
  -d '{"origin":"Denver, CO","destination":"Aspen, CO","departAt":"2024-06-15T14:00:00Z"}'
```
The response should show snow near Aspen and clear skies in Denver. If it doesn't look right, fix the algorithm before moving on.

### Phase 2 — Frontend shell

10. Scaffold React + Vite + TypeScript + Tailwind
11. Build `RouteSearch.tsx` — three inputs: origin, destination, departure datetime picker
12. Build `api.ts` — typed fetch wrapper for the backend
13. Build `useRouteWeather.ts` hook — handles loading/error/data states
14. Wire search form to hook, log the API response to console

### Phase 3 — Map

15. Add Mapbox GL JS
16. Build `RouteMap.tsx` — render the route polyline
17. Color the polyline segments by weather condition
18. Build `WeatherPin.tsx` — map markers with condition icon + temp
19. Add pins at each weather point

### Phase 4 — Timeline

20. Build `WeatherStrip.tsx` — horizontal scrollable timeline
21. Each item: time, icon, temp, colored bar
22. Color bar matches route line color for that segment

### Phase 5 — Polish

23. Build `LoadingState.tsx` — skeleton UI while fetching
24. Add error states (route not found, weather unavailable)
25. Implement `useUsageLimit.ts` — 3/month free tier
26. Usage limit gate on search submission
27. Mobile responsive pass — it needs to work on a phone

### Phase 6 — Deploy

28. Deploy backend to Railway (free tier)
29. Set environment variables in Railway dashboard
30. Deploy frontend to Vercel
31. Set `VITE_API_URL` in Vercel to Railway backend URL
32. Test the full flow on a real phone

---

## Open-Meteo Integration

No API key needed. Example request:

```
GET https://api.open-meteo.com/v1/forecast
  ?latitude=39.5501
  &longitude=-105.7821
  &hourly=temperature_2m,precipitation_probability,windspeed_10m,weathercode,visibility
  &temperature_unit=fahrenheit
  &windspeed_unit=mph
  &timezone=auto
  &forecast_days=16
```

Response gives hourly arrays. Match `arriveAt` to the nearest hour index.

WMO weather code mapping to use:
```typescript
function wmoToCondition(code: number): WeatherCondition {
  if (code === 0)              return 'clear';
  if (code <= 3)               return 'partly-cloudy';
  if (code <= 48)              return 'fog';
  if (code <= 57)              return 'rain';
  if (code <= 67)              return 'rain';
  if (code <= 77)              return 'snow';
  if (code <= 82)              return 'rain';
  if (code <= 86)              return 'snow';
  if (code >= 95)              return 'storm';
  return 'cloudy';
}
```

---

## Google Maps Directions API

Endpoint:
```
GET https://maps.googleapis.com/maps/api/directions/json
  ?origin=Denver,CO
  &destination=Aspen,CO
  &key=YOUR_KEY
```

What to extract from the response:
```typescript
const leg = data.routes[0].legs[0];

// Encoded polyline for the full route
const polyline = data.routes[0].overview_polyline.points;

// Steps with durations (for ETA calculation)
const steps = leg.steps.map(step => ({
  durationSeconds: step.duration.value,
  startLocation: step.start_location,  // { lat, lng }
}));

// Total trip stats
const totalDuration = leg.duration.value;   // seconds
const totalDistance = leg.distance.value;   // meters
const summary = data.routes[0].summary;     // "I-70 W"
```

---

## Known Traps to Avoid

**Polyline decoding:** Use the `@mapbox/polyline` npm package. Don't write your own decoder.

**ETA calculation:** The hardest part. Google's steps don't map cleanly to polyline points — they're at different resolutions. The safest approach: interpolate ETAs linearly based on distance along the route. Crude but correct enough.

**Open-Meteo timezone:** Always pass `timezone=auto`. It returns data in the local timezone of the requested location. When matching `arriveAt` to an hourly slot, convert `arriveAt` to local time first.

**Mapbox multi-color line:** You can't color a single LineString with multiple colors. You have to split the route into N segments and add each as a separate layer. Keep segment count low (15 max) or Mapbox performance suffers on mobile.

**CORS:** Fastify needs `@fastify/cors` registered before any routes. Allow `localhost:5173` in dev and your Vercel domain in production.

**Rate limiting:** Open-Meteo has no key and no stated rate limit but will block aggressive usage. 15 parallel requests per user search is fine. Don't poll.

---

## What We're Explicitly NOT Building Yet

- User accounts / auth
- Stripe payments
- Push notifications
- Real-time / live tracking
- CarPlay / Android Auto
- Native iOS app
- Saved routes (post-MVP)
- Shareable links (post-MVP)
- Severe weather alerts (post-MVP)

If Claude Code starts building any of these without being asked, stop it and redirect.

---

## Legal — Privacy Policy

**You need a privacy policy before collecting emails. This is not optional.**

A privacy policy is required any time you collect personal data — even just an email address on a waitlist. This covers you under CCPA (California), GDPR (Europe), and App Store review when you get there.

### What to do

1. Save the file `privacy-policy.html` (generated alongside this plan) to the same folder as your landing page
2. Deploy it at `routecast.app/privacy` (or wherever your landing page lives)
3. Add a link to it in the landing page footer — replace the existing footer line with:
   ```html
   © 2026 Routecast · Made for road trippers · <a href="/privacy">Privacy Policy</a>
   ```

### What the policy covers

- You collect email addresses only
- You use them only to send product updates and launch notifications
- You use Loops (or equivalent) to store and send emails
- You don't sell, share, or trade email data with third parties
- Users can request deletion by emailing you directly
- You'll update it when the app launches and you collect more data

### When to update it

Before launching the actual app, you'll need to expand the policy to cover:
- Route data (origin, destination — this is location-adjacent)
- Usage data (how many route lookups, free vs paid)
- Payment data (Stripe handles this, but you need to disclose it)

The generated policy has a placeholder note about this so you don't forget.

---

## Session Startup Prompt for Claude Code

Paste this at the start of each new Claude Code session:

> "I'm building Routecast — a pre-trip weather planning app for road trippers. Read ROUTECAST-BUILD-PLAN.md for the full spec. We are currently on Phase [X] of the build. The last thing we completed was [Y]. Today I want to work on [Z]. Do not deviate from the stack or file structure in the plan without asking me first."

---

*Last updated: June 2026*
*Current status: Phase 0 — landing page live, waitlist collecting*
*Next: Phase 1 — scaffold backend, build core algorithm*

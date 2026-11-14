import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { DateTime } from "luxon";
import { PlaceSearch } from "./PlaceSearch";
const RouteMap = lazy(() =>
  import("./RouteMap").then((module) => ({ default: module.RouteMap })),
);
import {
  departureInstant,
  label,
  timeLabel,
  weatherDescription,
  type Place,
  type Trip,
} from "./domain";
import { request } from "./api";

export default function App() {
  const [origin, setOrigin] = useState<Place | null>(null),
    [destination, setDestination] = useState<Place | null>(null);
  const [departure, setDeparture] = useState(""),
    [trip, setTrip] = useState<Trip | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null),
    version = useRef(0);
  useEffect(() => () => controller.current?.abort(), []);
  function invalidate() {
    version.current++;
    controller.current?.abort();
    setBusy(false);
    setTrip(null);
    setError("");
  }
  async function submit() {
    invalidate();
    if (!origin || !destination) {
      setError("Find and select both cities first.");
      return;
    }
    try {
      departureInstant(departure, origin.timezone);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    const id = version.current,
      c = new AbortController();
    controller.current = c;
    setBusy(true);
    try {
      const result = await request<Trip>("/api/trip", c.signal, {
        origin,
        destination,
        departure,
      });
      if (id === version.current) setTrip(result);
    } catch (e) {
      if (id === version.current)
        setError(
          e instanceof Error ? e.message : "Lookup failed. Please retry.",
        );
    } finally {
      if (id === version.current) setBusy(false);
    }
  }
  return (
    <>
      <header>
        <a className="brand" href="/" aria-label="Routecast home">
          <span className="brand-dot" />
          routecast
        </a>
        <span className="pill">WEB PREVIEW</span>
      </header>
      <main>
        <section className="hero">
          <p className="eyebrow">A little foresight. A better road trip.</p>
          <h1>
            Weather for
            <br />
            the <em>road ahead.</em>
          </h1>
          <p>
            See the forecast along your drive, timed to when you’ll get there.
            Pick your cities and a departure time to plan your next stretch of
            road.
          </p>
        </section>
        <div className="workspace">
          <section className="planner" aria-label="Plan your trip">
            <div className="section-heading">
              <span className="step">01</span>
              <h2>Make a plan</h2>
            </div>
            <p className="muted">
              City centers only. Search, then select a match.
            </p>
            <PlaceSearch
              title="From"
              selected={origin}
              onEdit={() => {
                invalidate();
                setOrigin(null);
                setDeparture("");
              }}
              onChange={(p) => {
                invalidate();
                setOrigin(p);
                setDeparture(
                  DateTime.now()
                    .setZone(p.timezone)
                    .plus({ hours: 2 })
                    .startOf("hour")
                    .toFormat("yyyy-MM-dd'T'HH:mm"),
                );
              }}
            />
            <div className="route-connector" aria-hidden="true">
              ↓
            </div>
            <PlaceSearch
              title="To"
              selected={destination}
              onEdit={() => {
                invalidate();
                setDestination(null);
              }}
              onChange={(p) => {
                invalidate();
                setDestination(p);
              }}
            />
            <form
              className="departure-form"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <label htmlFor="departure">Departure time</label>
              <input
                id="departure"
                type="datetime-local"
                value={departure}
                required
                disabled={!origin}
                onChange={(e) => {
                  invalidate();
                  setDeparture(e.target.value);
                }}
              />
              <p className="field-help">
                {origin
                  ? `Local time in ${origin.name} (${origin.timezone}).`
                  : "Select your starting city to set its local time."}{" "}
                Within the next six days.
              </p>
              <button
                className="primary"
                disabled={busy || !origin || !destination}
              >
                {busy ? "Building your forecast…" : "See my route forecast"}
                <span aria-hidden="true">↗</span>
              </button>
            </form>
            {busy && (
              <div role="status">
                <p>
                  Finding the road and checking up to eight forecasts. This can
                  take about 20 seconds.
                </p>
                <button className="text-button" onClick={invalidate}>
                  Cancel lookup
                </button>
              </div>
            )}
            {error && (
              <div role="alert" className="error">
                <p>{error}</p>
                <button className="secondary" onClick={() => void submit()}>
                  Retry lookup
                </button>
              </div>
            )}
            <p className="privacy-note">
              No account or email required. Searches, route coordinates and
              sampled weather locations go to the providers.{" "}
              <a href="/privacy-policy.html">Privacy details</a>
            </p>
          </section>
          <section
            className="results"
            aria-label="Route forecast"
            aria-live="polite"
            aria-busy={busy}
          >
            {!trip && (
              <div className="empty">
                <div className="road-art" aria-hidden="true">
                  <span>☀</span>
                  <svg viewBox="0 0 360 180">
                    <path d="M20 155 C60 30 155 195 195 90 S280 10 340 35" />
                  </svg>
                  <b>☁</b>
                </div>
                <p className="eyebrow">Your forecast starts here</p>
                <h2>One route. A look ahead.</h2>
                <p>
                  Your driving route and arrival-time forecasts will appear here
                  after you make a plan.
                </p>
                <div className="empty-facts">
                  <span>01 &nbsp; Choose cities</span>
                  <span>02 &nbsp; Pick a time</span>
                  <span>03 &nbsp; Check the forecast</span>
                </div>
              </div>
            )}
            {trip && (
              <>
                <div className="trip-heading">
                  <p className="eyebrow">Your road ahead</p>
                  <h2>
                    {trip.origin.name} <span aria-hidden="true">→</span>{" "}
                    {trip.destination.name}
                  </h2>
                  <p>
                    {Math.round(trip.route.distance / 1609.344)} miles ·{" "}
                    {Math.floor(trip.route.duration / 3600)} hr{" "}
                    {Math.round((trip.route.duration % 3600) / 60)} min driving
                    estimate
                  </p>
                  <p className="muted">
                    {label(trip.origin)} → {label(trip.destination)}
                  </p>
                </div>
                <Suspense
                  fallback={<p role="status">Loading the route map…</p>}
                >
                  <RouteMap key={trip.fetchedAt} trip={trip} />
                </Suspense>
                <div className="timeline-heading">
                  <h3>Along the way</h3>
                  <span>°F · mph</span>
                </div>
                <p className="muted">
                  Timeline times use {trip.origin.timezone}. No traffic, breaks
                  or stops included. Samples are spaced roughly{" "}
                  {Math.round(
                    trip.route.duration / (trip.stops.length - 1) / 60,
                  )}{" "}
                  minutes apart; conditions between them may differ.
                </p>
                <p className="muted">
                  Destination arrival:{" "}
                  {timeLabel(
                    trip.departure + trip.route.duration * 1000,
                    trip.destination.timezone,
                  )}{" "}
                  ({trip.destination.timezone}).
                </p>
                {trip.stops.some((s) => !s.weather) && (
                  <div className="notice" role="status">
                    <strong>
                      {trip.stops.filter((s) => !s.weather).length} of{" "}
                      {trip.stops.length} forecasts unavailable.
                    </strong>{" "}
                    The route remains visible.{" "}
                    <button
                      className="text-button"
                      onClick={() => void submit()}
                    >
                      Retry forecasts
                    </button>
                  </div>
                )}
                <ol className="timeline">
                  {trip.stops.map((s, i) => (
                    <li key={i}>
                      <span className="stop-number">{i + 1}</span>
                      <div>
                        <p className="stop-name">
                          {i === 0
                            ? trip.origin.name
                            : i === trip.stops.length - 1
                              ? trip.destination.name
                              : `Along the route · +${Math.round(s.elapsed / 60)} min`}
                        </p>
                        <time dateTime={new Date(s.arrival).toISOString()}>
                          {timeLabel(s.arrival, trip.origin.timezone)}
                        </time>
                        <p className="coordinates">
                          {s.coordinate[1].toFixed(3)},{" "}
                          {s.coordinate[0].toFixed(3)}
                        </p>
                        {s.weather ? (
                          <>
                            <p className="condition">
                              {weatherDescription(s.weather.code)}{" "}
                              <strong>
                                {s.weather.temperature === null
                                  ? "—"
                                  : Math.round(s.weather.temperature) + "°F"}
                              </strong>
                            </p>
                            <p className="weather-detail">
                              Precip.{" "}
                              {s.weather.rain === null
                                ? "unavailable"
                                : Math.round(s.weather.rain) + "%"}{" "}
                              · Wind{" "}
                              {s.weather.wind === null
                                ? "unavailable"
                                : Math.round(s.weather.wind) + " mph"}
                            </p>
                            <p className="field-help">
                              Forecast hour:{" "}
                              {timeLabel(
                                s.weather.forecastTime,
                                trip.origin.timezone,
                              )}
                            </p>
                          </>
                        ) : (
                          <p className="error">{s.error}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
                <p className="attribution">
                  Plan prepared{" "}
                  {timeLabel(trip.fetchedAt, trip.origin.timezone)}. Nearest
                  hourly forecast; not live observations. Weather responses may
                  be cached for up to 10 minutes. Weather:{" "}
                  <a href="https://open-meteo.com/">Open-Meteo</a> (
                  <a href="https://creativecommons.org/licenses/by/4.0/">
                    CC BY 4.0
                  </a>
                  ). Cities: <a href="https://www.geonames.org/">GeoNames</a>{" "}
                  via Open-Meteo.
                </p>
              </>
            )}
          </section>
        </div>
        <aside className="preview-note">
          <strong>Private development preview</strong>
          <p>
            Live lookups require the local development server with provider
            access enabled. This version uses limited, noncommercial public
            APIs. It is not ready for a public or commercial launch.
          </p>
        </aside>
        <p className="safety">
          Plan before you drive. Routecast is not navigation, an alert service,
          or a guarantee of safe conditions. Check official weather and road
          advisories before leaving.
        </p>
      </main>
      <footer>
        <a className="brand" href="/">
          routecast
        </a>
        <span>For the journey, before the journey.</span>
        <nav>
          <a href="/privacy-policy.html">Privacy</a>
          <a href="/terms-of-service.html">Terms</a>
        </nav>
      </footer>
    </>
  );
}

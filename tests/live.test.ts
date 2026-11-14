import { it, expect } from "vitest";
import { DateTime } from "luxon";
import { searchPlaces } from "../server/providers";
import { planTrip } from "../server/api";
// Explicit, opt-in smoke check. All ordinary tests are offline fixtures.
it.skipIf(process.env.RUN_LIVE_PROVIDERS !== "1")(
  "live city-level La Vernia to Midland route and forecasts",
  async () => {
    const origins = await searchPlaces("La Vernia");
    const destinations = await searchPlaces("Midland");
    const origin = origins.find((p) => p.region === "Texas")!;
    const destination = destinations.find((p) => p.region === "Texas")!;
    expect(origin).toBeTruthy();
    expect(destination).toBeTruthy();
    const departure = DateTime.now()
      .setZone(origin.timezone)
      .plus({ hours: 2 })
      .startOf("hour")
      .toFormat("yyyy-MM-dd'T'HH:mm");
    const trip = await planTrip({ origin, destination, departure });
    expect(trip.route.distance).toBeGreaterThan(300000);
    expect(trip.route.coordinates.length).toBeGreaterThan(100);
    expect(trip.stops.every((s) => s.weather)).toBe(true);
    console.log(
      JSON.stringify({
        origin: origin.name,
        destination: destination.name,
        departure,
        distanceMiles: Math.round(trip.route.distance / 1609.344),
        durationMinutes: Math.round(trip.route.duration / 60),
        routeVertices: trip.route.coordinates.length,
        samples: trip.stops.length,
        weatherAvailable: trip.stops.filter((s) => s.weather).length,
        fetchedAt: new Date(trip.fetchedAt).toISOString(),
      }),
    );
  },
  180000,
);

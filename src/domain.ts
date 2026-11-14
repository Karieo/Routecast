import { DateTime, IANAZone } from "luxon";
import { z } from "zod";

export const coordinate = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);
export const placeSchema = z.object({
  id: z.number().int(),
  name: z.string().min(1).max(200),
  region: z.string().max(200),
  country: z.string().max(200),
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
  timezone: z.string().refine((v) => IANAZone.isValidZone(v)),
});
export type Place = z.infer<typeof placeSchema>;
export type Coordinate = z.infer<typeof coordinate>;
export const planSchema = z.object({
  origin: placeSchema,
  destination: placeSchema,
  departure: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
});
export type PlanInput = z.infer<typeof planSchema>;
export interface Route {
  coordinates: Coordinate[];
  durations: number[];
  duration: number;
  distance: number;
}
export interface Sample {
  coordinate: Coordinate;
  elapsed: number;
  arrival: number;
}
export interface Weather {
  temperature: number | null;
  rain: number | null;
  wind: number | null;
  code: number | null;
  forecastTime: number;
  timezone: string;
}
export interface Stop extends Sample {
  weather: Weather | null;
  error?: string;
}
export interface Trip {
  origin: Place;
  destination: Place;
  departure: number;
  route: Route;
  stops: Stop[];
  fetchedAt: number;
}
export const label = (place: Place) =>
  [place.name, place.region, place.country].filter(Boolean).join(", ");

export function departureInstant(
  local: string,
  timezone: string,
  now = Date.now(),
): number {
  const dt = DateTime.fromISO(local, { zone: timezone });
  if (!dt.isValid || dt.toFormat("yyyy-MM-dd'T'HH:mm") !== local)
    throw new Error(
      "That local time does not exist. Choose another departure time.",
    );
  if (dt.getPossibleOffsets().length !== 1)
    throw new Error(
      "That time occurs twice when clocks change. Choose a time outside the repeated hour.",
    );
  const instant = dt.toMillis();
  if (instant < now) throw new Error("Choose a departure time in the future.");
  // Conservative planning window; actual hourly coverage is checked per stop.
  if (instant > now + 6 * 86400000)
    throw new Error("Choose a departure within the next six days.");
  return instant;
}

export function sampleRoute(route: Route, departure: number): Sample[] {
  if (
    route.coordinates.length !== route.durations.length + 1 ||
    !route.durations.length ||
    route.duration <= 0
  )
    throw new Error("Route timing is unavailable. Try a different route.");
  const total = route.durations.reduce((a, b) => a + b, 0);
  if (total <= 0) throw new Error("Route timing is unavailable.");
  // Up to eight points, roughly hourly on shorter trips. Geometry segments are timed
  // using OSRM annotations, not uniform speed or straight-line distance.
  const intervals = Math.min(7, Math.max(1, Math.ceil(route.duration / 3600)));
  return Array.from({ length: intervals + 1 }, (_, i) => {
    const elapsed = (route.duration * i) / intervals;
    const target = (total * i) / intervals;
    let segment = 0,
      before = 0;
    while (
      segment < route.durations.length - 1 &&
      before + route.durations[segment] < target
    )
      before += route.durations[segment++];
    const ratio = route.durations[segment]
      ? Math.min(1, (target - before) / route.durations[segment])
      : 0;
    const a = route.coordinates[segment],
      b = route.coordinates[segment + 1];
    return {
      coordinate:
        i === intervals
          ? route.coordinates.at(-1)!
          : [a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio],
      elapsed,
      arrival: departure + elapsed * 1000,
    };
  });
}

export function weatherDescription(code: number | null): string {
  if (code === null) return "Condition unavailable";
  if (code === 0) return "Clear sky";
  if (code <= 3)
    return (
      ["", "Mainly clear", "Partly cloudy", "Overcast"][code] ??
      "Unknown condition"
    );
  if ([45, 48].includes(code)) return "Fog";
  if ([51, 53, 55].includes(code)) return "Drizzle";
  if ([56, 57, 66, 67].includes(code)) return "Freezing precipitation";
  if ([61, 63, 65, 80, 81, 82].includes(code)) return "Rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
  if ([95, 96, 99].includes(code)) return "Thunderstorm";
  return "Unknown condition";
}
export function timeLabel(instant: number, zone: string) {
  return DateTime.fromMillis(instant, { zone }).toFormat(
    "ccc, LLL d · h:mm a ZZZZ",
  );
}

import { z } from "zod";
import {
  coordinate,
  type Place,
  type Route,
  type Weather,
} from "../src/domain";

export class ProviderError extends Error {}
type Fetcher = typeof fetch;
// A single queue bounds requests across tabs. Development only, one local process.
export function createGateway(
  fetcher: Fetcher = fetch,
  spacing = 1100,
  dailyBudget = 1000,
) {
  let requestStarts: number[] = [];
  let queue: Promise<unknown> = Promise.resolve();
  let lastStart = 0;
  const cache = new Map<string, { expires: number; value: unknown }>();
  const pending = new Map<string, Promise<unknown>>();
  return async (url: string, ttl = 600000): Promise<unknown> => {
    const hit = cache.get(url);
    if (hit && hit.expires > Date.now()) return hit.value;
    const inFlight = pending.get(url);
    if (inFlight) return inFlight;
    if (pending.size >= 24)
      throw new ProviderError(
        "Too many requests. Wait for the current lookup, then retry.",
      );
    const task = queue
      .catch(() => {})
      .then(async () => {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, lastStart + spacing - Date.now())),
        );
        const now = Date.now();
        requestStarts = requestStarts.filter((start) => start > now - 86400000);
        if (requestStarts.length >= dailyBudget)
          throw new ProviderError(
            "The local daily request budget is used up. Try again tomorrow.",
          );
        requestStarts.push(now);
        lastStart = now;
        let response: Response;
        try {
          response = await fetcher(url, {
            headers: {
              "User-Agent":
                "Routecast-local-preview/0.1 (+https://github.com/Karieo/Routecast)",
              Accept: "application/json",
            },
            signal: AbortSignal.timeout(15000),
          });
        } catch {
          throw new ProviderError(
            "The provider could not be reached or timed out. Please retry.",
          );
        }
        if (!response.ok)
          throw new ProviderError(
            response.status === 429
              ? "The provider is busy or rate limited. Wait a minute and retry."
              : "The provider could not complete the request. Please retry.",
          );
        let value: unknown;
        try {
          value = await response.json();
        } catch {
          throw new ProviderError(
            "The provider returned an unreadable response. Please retry.",
          );
        }
        if (cache.size >= 150) cache.delete(cache.keys().next().value!);
        cache.set(url, { value, expires: Date.now() + ttl });
        return value;
      });
    queue = task;
    pending.set(url, task);
    try {
      return await task;
    } finally {
      pending.delete(url);
    }
  };
}
export type Gateway = ReturnType<typeof createGateway>;
export const gateway = createGateway();

export async function searchPlaces(
  query: string,
  get = gateway,
): Promise<Place[]> {
  const data = z
    .object({
      results: z
        .array(
          z.object({
            id: z.number(),
            name: z.string(),
            admin1: z.string().optional(),
            country: z.string().optional(),
            longitude: z.number(),
            latitude: z.number(),
            timezone: z.string().optional(),
          }),
        )
        .optional(),
    })
    .parse(
      await get(
        `https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: query, count: "8", language: "en", format: "json" })}`,
      ),
    );
  return (data.results ?? [])
    .filter((p) => p.timezone)
    .map((p) => ({
      id: p.id,
      name: p.name,
      region: p.admin1 ?? "",
      country: p.country ?? "",
      longitude: p.longitude,
      latitude: p.latitude,
      timezone: p.timezone!,
    }));
}
export async function drivingRoute(
  origin: Place,
  destination: Place,
  get = gateway,
): Promise<Route> {
  const points = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
  const data = z
    .object({
      code: z.string(),
      routes: z
        .array(
          z.object({
            distance: z.number().nonnegative(),
            duration: z.number().positive(),
            geometry: z.object({ coordinates: z.array(coordinate).min(2) }),
            legs: z.array(
              z.object({
                annotation: z.object({
                  duration: z.array(z.number().nonnegative()),
                }),
              }),
            ),
          }),
        )
        .optional(),
      waypoints: z
        .array(z.object({ distance: z.number().nonnegative() }))
        .optional(),
    })
    .parse(
      await get(
        `https://router.project-osrm.org/route/v1/driving/${points}?overview=full&geometries=geojson&annotations=duration&steps=false&generate_hints=false`,
        3600000,
      ),
    );
  if (data.code !== "Ok" || !data.routes?.length)
    throw new ProviderError(
      "No driving route was found. Try different cities connected by roads.",
    );
  if (data.waypoints?.some((p) => p.distance > 10000))
    throw new ProviderError(
      "A selected city is too far from a routable road. Choose a nearby city.",
    );
  const route = data.routes[0];
  if (route.duration > 48 * 3600)
    throw new ProviderError(
      "This preview supports drives up to 48 hours. Plan a shorter leg.",
    );
  return {
    coordinates: route.geometry.coordinates,
    durations: route.legs.flatMap((l) => l.annotation.duration),
    duration: route.duration,
    distance: route.distance,
  };
}
const nullableNumbers = z.array(z.number().nullable());
const forecastSchema = z.object({
  timezone: z.string(),
  hourly: z.object({
    time: z.array(z.number()),
    temperature_2m: nullableNumbers,
    precipitation_probability: nullableNumbers,
    wind_speed_10m: nullableNumbers,
    weather_code: nullableNumbers,
  }),
});
export function selectWeather(raw: unknown, arrival: number): Weather {
  const { hourly, timezone } = forecastSchema.parse(raw);
  const seconds = arrival / 1000;
  if (
    !hourly.time.length ||
    seconds < hourly.time[0] ||
    seconds > hourly.time.at(-1)!
  )
    throw new ProviderError(
      "Arrival is outside the available forecast horizon.",
    );
  // Nearest hourly forecast, maximum 30-minute difference; never clamp to last hour.
  const i = hourly.time.reduce(
    (best, t, index) =>
      Math.abs(t - seconds) < Math.abs(hourly.time[best] - seconds)
        ? index
        : best,
    0,
  );
  if (Math.abs(hourly.time[i] - seconds) > 1800)
    throw new ProviderError("No forecast hour is available near this arrival.");
  const values = [
    hourly.temperature_2m[i],
    hourly.precipitation_probability[i],
    hourly.wind_speed_10m[i],
    hourly.weather_code[i],
  ];
  if (values.every((v) => v == null))
    throw new ProviderError("Weather values are missing for this arrival.");
  return {
    temperature: values[0] ?? null,
    rain: values[1] ?? null,
    wind: values[2] ?? null,
    code: values[3] ?? null,
    forecastTime: hourly.time[i] * 1000,
    timezone,
  };
}
export async function forecast(
  point: [number, number],
  arrival: number,
  get = gateway,
) {
  const query = new URLSearchParams({
    longitude: point[0].toFixed(4),
    latitude: point[1].toFixed(4),
    hourly:
      "temperature_2m,precipitation_probability,wind_speed_10m,weather_code",
    forecast_days: "7",
    timezone: "auto",
    timeformat: "unixtime",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
  });
  return selectWeather(
    await get(`https://api.open-meteo.com/v1/forecast?${query}`),
    arrival,
  );
}

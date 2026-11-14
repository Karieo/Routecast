import type { IncomingMessage, ServerResponse } from "node:http";
import { ZodError } from "zod";
import {
  planSchema,
  departureInstant,
  sampleRoute,
  type PlanInput,
  type Trip,
} from "../src/domain";
import {
  searchPlaces,
  drivingRoute,
  forecast,
  ProviderError,
} from "./providers";

export const providers = { searchPlaces, drivingRoute, forecast };
export async function planTrip(
  input: PlanInput,
  services = providers,
  now = Date.now(),
): Promise<Trip> {
  const departure = departureInstant(
    input.departure,
    input.origin.timezone,
    now,
  );
  if (
    Math.abs(input.origin.longitude - input.destination.longitude) < 0.0001 &&
    Math.abs(input.origin.latitude - input.destination.latitude) < 0.0001
  )
    throw new Error("Choose two different cities.");
  const route = await services.drivingRoute(input.origin, input.destination);
  const stops = await Promise.all(
    sampleRoute(route, departure).map(async (sample) => {
      try {
        return {
          ...sample,
          weather: await services.forecast(sample.coordinate, sample.arrival),
        };
      } catch (error) {
        return {
          ...sample,
          weather: null,
          error:
            error instanceof ProviderError
              ? error.message
              : "Weather is unavailable for this stop. Retry the forecast.",
        };
      }
    }),
  );
  return { ...input, departure, route, stops, fetchedAt: Date.now() };
}
function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}
export function apiMiddleware(enabled: boolean) {
  let active = 0;
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/")) return next();
    if (!enabled)
      return send(res, 503, {
        error:
          "Live providers are disabled. For private noncommercial evaluation, set ROUTECAST_DEV_PROVIDERS=1 and run npm run dev. Production providers are not configured.",
      });
    // No cross-origin API access; keep this development service bound to loopback.
    if (
      req.headers.origin &&
      req.headers.origin !== `http://${req.headers.host}`
    )
      return send(res, 403, {
        error: "Cross-origin requests are not allowed.",
      });
    if (active >= 2)
      return send(res, 429, {
        error: "A lookup is still running. Wait a moment and retry.",
      });
    active++;
    try {
      if (url.pathname === "/api/places" && req.method === "GET") {
        const q = (url.searchParams.get("q") ?? "").trim();
        if (q.length < 2 || q.length > 100)
          return send(res, 400, {
            error: "Enter a city name between 2 and 100 characters.",
          });
        return send(res, 200, await providers.searchPlaces(q));
      }
      if (url.pathname === "/api/trip" && req.method === "POST") {
        let body = "";
        for await (const part of req) {
          body += part;
          if (body.length > 10000)
            return send(res, 413, { error: "Request is too large." });
        }
        const input = planSchema.parse(JSON.parse(body));
        return send(res, 200, await planTrip(input));
      }
      send(res, 404, { error: "Unknown API endpoint." });
    } catch (error) {
      send(res, error instanceof ProviderError ? 502 : 400, {
        error:
          error instanceof ZodError || error instanceof SyntaxError
            ? "The request or provider response is invalid. Check the cities and retry."
            : error instanceof Error
              ? error.message
              : "The request failed. Please retry.",
      });
    } finally {
      active--;
    }
  };
}

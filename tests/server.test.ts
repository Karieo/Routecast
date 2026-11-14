import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { describe, it, expect, vi } from "vitest";
import { apiMiddleware, planTrip } from "../server/api";
import {
  createGateway,
  drivingRoute,
  ProviderError,
  searchPlaces,
} from "../server/providers";
import type { PlanInput, Place, Route } from "../src/domain";
const origin: Place = {
  id: 1,
  name: "TEST origin",
  region: "Texas",
  country: "United States",
  latitude: 29.35,
  longitude: -98.1,
  timezone: "America/Chicago",
};
const destination = {
  ...origin,
  id: 2,
  name: "TEST destination",
  longitude: -102.1,
};
const input: PlanInput = { origin, destination, departure: "2026-11-15T08:00" };
const now = Date.parse("2026-11-14T12:00Z");
const route: Route = {
  coordinates: [
    [-98.1, 29.35],
    [-102.1, 32],
  ],
  durations: [7200],
  duration: 7200,
  distance: 400000,
};
const weather = {
  temperature: 65,
  rain: 10,
  wind: 8,
  code: 0,
  forecastTime: Date.parse("2026-11-15T14:00Z"),
  timezone: "America/Chicago",
};
describe("trip orchestration", () => {
  it("keeps the route and successful samples on partial weather failure", async () => {
    const forecast = vi
      .fn()
      .mockResolvedValueOnce(weather)
      .mockRejectedValueOnce(new ProviderError("Weather is busy"))
      .mockResolvedValueOnce(weather);
    const trip = await planTrip(
      input,
      {
        searchPlaces,
        drivingRoute: vi.fn().mockResolvedValue(route),
        forecast,
      },
      now,
    );
    expect(trip.stops).toHaveLength(3);
    expect(trip.stops[1]).toMatchObject({
      weather: null,
      error: "Weather is busy",
    });
    expect(trip.stops[2].weather).toEqual(weather);
    expect(trip.departure).toBe(Date.parse("2026-11-15T14:00Z"));
  });
  it("retains route when all weather fails", async () => {
    const trip = await planTrip(
      input,
      {
        searchPlaces,
        drivingRoute: vi.fn().mockResolvedValue(route),
        forecast: vi.fn().mockRejectedValue(new Error()),
      },
      now,
    );
    expect(trip.stops.every((s) => s.weather === null)).toBe(true);
    expect(trip.route).toEqual(route);
  });
  it("rejects identical cities before calling routing", async () => {
    const drivingRoute = vi.fn();
    await expect(
      planTrip(
        { ...input, destination: origin },
        { searchPlaces, drivingRoute, forecast: vi.fn() },
        now,
      ),
    ).rejects.toThrow("different cities");
    expect(drivingRoute).not.toHaveBeenCalled();
  });
  it("propagates no-route failures", async () => {
    await expect(
      planTrip(
        input,
        {
          searchPlaces,
          drivingRoute: vi
            .fn()
            .mockRejectedValue(new ProviderError("No route")),
          forecast: vi.fn(),
        },
        now,
      ),
    ).rejects.toThrow("No route");
  });
});
describe("provider boundary", () => {
  it("enforces the local daily upstream budget but still serves cache", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}"));
    const get = createGateway(fetcher, 0, 1);
    await get("https://a.test");
    await expect(get("https://b.test")).rejects.toThrow("daily request budget");
    await expect(get("https://a.test")).resolves.toEqual({});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("returns an explicit no-route error", async () => {
    await expect(
      drivingRoute(origin, destination, async () => ({ code: "NoRoute" })),
    ).rejects.toThrow("No driving route");
  });
  it("normalizes geocoding results and keeps disambiguation", async () => {
    const result = await searchPlaces("Midland", async () => ({
      results: [
        {
          id: 1,
          name: "Midland",
          admin1: "Texas",
          country: "United States",
          latitude: 32,
          longitude: -102,
          timezone: "America/Chicago",
        },
        { id: 2, name: "Midland", latitude: 1, longitude: 2 },
      ],
    }));
    expect(result).toHaveLength(1);
    expect(result[0].region).toBe("Texas");
  });
  it("deduplicates in-flight calls and serves cached responses", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"ok":true}'));
    const get = createGateway(fetcher, 0);
    expect(
      await Promise.all([
        get("https://example.test"),
        get("https://example.test"),
      ]),
    ).toEqual([{ ok: true }, { ok: true }]);
    await get("https://example.test");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not cache failed requests and allows an explicit retry", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(new Response("{}"));
    const get = createGateway(fetcher, 0);
    await expect(get("https://example.test")).rejects.toThrow("rate limited");
    await expect(get("https://example.test")).resolves.toEqual({});
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("bounds provider request starts", async () => {
    const starts: number[] = [];
    const get = createGateway(
      vi.fn(async () => {
        starts.push(Date.now());
        return new Response("{}");
      }),
      40,
    );
    await Promise.all([get("https://a.test"), get("https://b.test")]);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(35);
  });
  it("handles network and invalid JSON failures", async () => {
    await expect(
      createGateway(
        vi.fn().mockRejectedValue(new TypeError("network")),
        0,
      )("https://example.test"),
    ).rejects.toThrow("timed out");
    await expect(
      createGateway(
        vi.fn().mockResolvedValue(new Response("<html>")),
        0,
      )("https://example.test"),
    ).rejects.toThrow("unreadable");
  });
});
describe("HTTP gateway", () => {
  async function run(enabled: boolean, fn: (base: string) => Promise<void>) {
    const middleware = apiMiddleware(enabled);
    const server = createServer(
      (req, res) =>
        void middleware(req, res, () => {
          res.writeHead(404);
          res.end();
        }),
    );
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    } finally {
      server.close();
      await once(server, "close");
    }
  }
  it("defaults to a disabled gateway without calling providers", async () =>
    run(false, async (base) => {
      const res = await fetch(base + "/api/places?q=La%20Vernia");
      expect(res.status).toBe(503);
      expect((await res.json()).error).toContain("disabled");
    }));
  it("rejects invalid request bodies", async () =>
    run(true, async (base) => {
      expect(
        (await fetch(base + "/api/trip", { method: "POST", body: "{}" }))
          .status,
      ).toBe(400);
    }));
  it("rejects cross-origin calls", async () =>
    run(true, async (base) => {
      expect(
        (
          await fetch(base + "/api/places?q=Midland", {
            headers: { Origin: "https://untrusted.test" },
          })
        ).status,
      ).toBe(403);
    }));
  it("rejects empty searches", async () =>
    run(true, async (base) => {
      expect((await fetch(base + "/api/places?q=")).status).toBe(400);
    }));
});

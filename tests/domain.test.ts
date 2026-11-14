import { describe, it, expect } from "vitest";
import {
  departureInstant,
  sampleRoute,
  weatherDescription,
  planSchema,
  type Route,
} from "../src/domain";
import { selectWeather } from "../server/providers";
const now = Date.parse("2026-11-01T00:00:00Z");
describe("departure in origin timezone", () => {
  it("converts local time independent of browser timezone", () =>
    expect(departureInstant("2026-11-01T03:00", "America/Chicago", now)).toBe(
      Date.parse("2026-11-01T09:00:00Z"),
    ));
  it("rejects repeated DST hour", () =>
    expect(() =>
      departureInstant("2026-11-01T01:30", "America/Chicago", now),
    ).toThrow("occurs twice"));
  it("rejects spring-forward gap instead of silently normalizing", () =>
    expect(() =>
      departureInstant(
        "2026-03-08T02:30",
        "America/Chicago",
        Date.parse("2026-03-08T00:00Z"),
      ),
    ).toThrow("does not exist"));
  it("rejects past departures", () =>
    expect(() =>
      departureInstant("2026-10-31T12:00", "America/Chicago", now),
    ).toThrow("future"));
  it("rejects distant departures", () =>
    expect(() =>
      departureInstant("2026-11-10T12:00", "America/Chicago", now),
    ).toThrow("six days"));
  it("rejects malformed dates", () =>
    expect(() =>
      departureInstant("invalid", "America/Chicago", now),
    ).toThrow());
  it("rejects a fake timezone at the API boundary", () =>
    expect(
      planSchema.safeParse({ origin: { timezone: "Not/AZone" } }).success,
    ).toBe(false));
});
describe("route sampling", () => {
  const route: Route = {
    coordinates: [
      [0, 0],
      [1, 0],
      [2, 0],
    ],
    durations: [3600, 10800],
    duration: 14400,
    distance: 200000,
  };
  it("samples elapsed segment time rather than uniform distance", () => {
    const s = sampleRoute(route, 0);
    expect(s).toHaveLength(5);
    expect(s[1].coordinate[0]).toBe(1);
    expect(s[2].coordinate[0]).toBeCloseTo(1 + 1 / 3);
    expect(s[4].arrival).toBe(14400000);
    expect(s[4].coordinate).toEqual([2, 0]);
  });
  it("caps long drives at eight samples", () =>
    expect(sampleRoute({ ...route, duration: 86400 }, 0)).toHaveLength(8));
  it("includes both endpoints for short trips", () =>
    expect(sampleRoute({ ...route, duration: 60 }, 0)).toHaveLength(2));
  it("handles zero-duration segments", () =>
    expect(
      sampleRoute({ ...route, durations: [0, 100] }, 0).every((s) =>
        s.coordinate.every(Number.isFinite),
      ),
    ).toBe(true));
  it("rejects mismatched geometry and annotations", () =>
    expect(() => sampleRoute({ ...route, durations: [100] }, 0)).toThrow(
      "timing",
    ));
});
describe("forecast selection", () => {
  const raw = {
    timezone: "America/Chicago",
    hourly: {
      time: [3600, 7200, 10800],
      temperature_2m: [40, null, 45],
      precipitation_probability: [10, 20, 30],
      wind_speed_10m: [5, 8, 10],
      weather_code: [0, 61, 71],
    },
  };
  it("selects the nearest absolute UTC hour", () =>
    expect(selectWeather(raw, 6900000)).toMatchObject({
      temperature: null,
      code: 61,
      forecastTime: 7200000,
    }));
  it("does not clamp beyond the last forecast", () =>
    expect(() => selectWeather(raw, 10800001)).toThrow("horizon"));
  it("does not use a future forecast for a past arrival", () =>
    expect(() => selectWeather(raw, 3599999)).toThrow("horizon"));
  it("preserves missing fields without inventing zero", () =>
    expect(selectWeather(raw, 7200000).temperature).toBeNull());
  it("fails when every field is missing", () =>
    expect(() =>
      selectWeather(
        {
          ...raw,
          hourly: {
            ...raw.hourly,
            temperature_2m: [null],
            precipitation_probability: [null],
            wind_speed_10m: [null],
            weather_code: [null],
          },
        },
        3600000,
      ),
    ).toThrow("missing"));
  it("rejects malformed provider data", () =>
    expect(() => selectWeather({}, 0)).toThrow());
  it("labels unknown weather instead of calling it clear", () =>
    expect(weatherDescription(999)).toBe("Unknown condition"));
});

import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import type { Trip } from "../../src/domain";

test("opt-in real La Vernia to Midland browser smoke", async ({
  page,
}, info) => {
  test.skip(
    process.env.RUN_LIVE_PROVIDERS !== "1" || info.project.name !== "desktop",
  );
  test.setTimeout(180000);
  await page.goto("/");
  await page.getByLabel("From", { exact: true }).fill("La Vernia");
  await page.getByRole("button", { name: "Find city" }).first().click();
  await page.getByRole("button", { name: /La Vernia.*Texas/ }).click();
  await page.getByLabel("To", { exact: true }).fill("Midland");
  await page.getByRole("button", { name: "Find city" }).last().click();
  await page.getByRole("button", { name: /Midland.*Texas/ }).click();
  const responsePromise = page.waitForResponse(
    (r) => r.url().endsWith("/api/trip"),
    { timeout: 150000 },
  );
  await page.getByRole("button", { name: "See my route forecast" }).click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  const trip = (await response.json()) as Trip;
  expect(trip.stops.every((s) => s.weather)).toBe(true);
  await expect(
    page.getByRole("heading", { name: "La Vernia Midland" }),
  ).toBeVisible();
  // Basemap egress can be blocked in hosted test environments. Require either
  // real tiles or the explicit, accessible fallback, never a silent blank map.
  const tile = page.locator(".leaflet-tile-loaded").first();
  const tileFailure = page.getByText("Map tiles could not load.", {
    exact: false,
  });
  await expect(tile.or(tileFailure).first()).toBeVisible();
  const liveMapTilesLoaded = (await tile.count()) > 0;
  if (!liveMapTilesLoaded) await expect(tileFailure).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/live-desktop.png",
    fullPage: true,
  });
  await writeFile(
    "test-results/live-summary.json",
    JSON.stringify(
      {
        origin: trip.origin.name,
        destination: trip.destination.name,
        miles: Math.round(trip.route.distance / 1609.344),
        drivingMinutes: Math.round(trip.route.duration / 60),
        geometryPoints: trip.route.coordinates.length,
        samples: trip.stops.length,
        availableForecasts: trip.stops.filter((s) => s.weather).length,
        departure: new Date(trip.departure).toISOString(),
        fetchedAt: new Date(trip.fetchedAt).toISOString(),
        liveMapTilesLoaded,
      },
      null,
      2,
    ),
  );
});

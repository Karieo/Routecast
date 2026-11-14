import { test, expect, type Page } from "@playwright/test";
const origin = {
  id: 1,
  name: "La Vernia",
  region: "Texas",
  country: "United States",
  longitude: -98.115,
  latitude: 29.356,
  timezone: "America/Chicago",
};
const destination = {
  id: 2,
  name: "Midland",
  region: "Texas",
  country: "United States",
  longitude: -102.078,
  latitude: 31.997,
  timezone: "America/Chicago",
};
// Synthetic fixtures only: never shipped to the application as live data.
const fixture = {
  origin,
  destination,
  departure: Date.parse("2026-11-15T14:00Z"),
  route: {
    coordinates: [
      [-98.115, 29.356],
      [-99.4, 30.1],
      [-102.078, 31.997],
    ],
    durations: [3600, 14400],
    duration: 18000,
    distance: 600000,
  },
  stops: [
    {
      coordinate: [-98.115, 29.356],
      elapsed: 0,
      arrival: Date.parse("2026-11-15T14:00Z"),
      weather: {
        temperature: 65,
        rain: 20,
        wind: 10,
        code: 2,
        forecastTime: Date.parse("2026-11-15T14:00Z"),
        timezone: "America/Chicago",
      },
    },
    {
      coordinate: [-102.078, 31.997],
      elapsed: 18000,
      arrival: Date.parse("2026-11-15T19:00Z"),
      weather: null,
      error: "TEST FIXTURE: forecast unavailable",
    },
  ],
  fetchedAt: Date.parse("2026-11-14T12:00Z"),
};
async function setup(page: Page) {
  await page.clock.install({ time: new Date("2026-11-14T12:00Z") });
  await page.route("https://tile.openstreetmap.org/**", (r) => r.abort());
  await page.route("**/api/places?*", (r) =>
    r.fulfill({
      json: r.request().url().includes("Vernia")
        ? [origin]
        : [destination, { ...destination, id: 3, region: "Michigan" }],
    }),
  );
  await page.goto("/");
}
async function choose(page: Page) {
  await page.getByLabel("From", { exact: true }).fill("La Vernia");
  await page.getByRole("button", { name: "Find city" }).first().click();
  await page.getByRole("button", { name: "La Vernia Texas" }).click();
  await page.getByLabel("To", { exact: true }).fill("Midland");
  await page.getByRole("button", { name: "Find city" }).last().click();
  await expect(
    page.getByRole("button", { name: "Midland Michigan" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Midland Texas" }).click();
  await page
    .getByLabel("Departure time", { exact: true })
    .fill("2026-11-15T08:00");
}
test("disambiguates cities and shows route, timeline, partial failure and retry", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/trip", (r) => r.fulfill({ json: fixture }));
  await choose(page);
  await page.getByRole("button", { name: "See my route forecast" }).click();
  await expect(
    page.getByRole("heading", { name: "La Vernia Midland" }),
  ).toBeVisible();
  await expect(page.getByText("1 of 2 forecasts unavailable.")).toBeVisible();
  await expect(page.getByText("65°F", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Map tiles could not load.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry forecasts" }).click();
  await expect(page.getByText("1 of 2 forecasts unavailable.")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `test-results/planner-${test.info().project.name}.png`,
    fullPage: true,
  });
});
test("route error is actionable and retry succeeds", async ({ page }) => {
  await setup(page);
  let calls = 0;
  await page.route("**/api/trip", (r) => {
    calls++;
    return r.fulfill(
      calls === 1
        ? { status: 502, json: { error: "No driving route was found." } }
        : { json: fixture },
    );
  });
  await choose(page);
  await page.getByRole("button", { name: "See my route forecast" }).click();
  await expect(page.getByRole("alert")).toContainText("No driving route");
  await page.getByRole("button", { name: "Retry lookup" }).click();
  await expect(
    page.getByRole("heading", { name: "La Vernia Midland" }),
  ).toBeVisible();
  expect(calls).toBe(2);
});
test("editing cancels and ignores an old result, then accepts a new submit", async ({
  page,
}) => {
  await setup(page);
  let release: () => void = () => {};
  let calls = 0;
  await page.route("**/api/trip", async (r) => {
    calls++;
    if (calls === 1)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    await r.fulfill({ json: fixture });
  });
  await choose(page);
  await page.getByRole("button", { name: "See my route forecast" }).click();
  await expect(
    page.getByRole("button", { name: "Cancel lookup" }),
  ).toBeVisible();
  await page
    .getByLabel("Departure time", { exact: true })
    .fill("2026-11-15T09:00");
  release();
  await expect(
    page.getByRole("heading", { name: "La Vernia Midland" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "See my route forecast" }).click();
  await expect(
    page.getByRole("heading", { name: "La Vernia Midland" }),
  ).toBeVisible();
  expect(calls).toBe(2);
});
test("network errors and empty search do not invent a city", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/places?*", (r) => r.abort());
  await page.getByLabel("From", { exact: true }).fill("La Vernia");
  await page.getByRole("button", { name: "Find city" }).first().click();
  await expect(page.getByRole("alert")).toContainText("Connection failed");
  await page.route("**/api/places?*", (r) => r.fulfill({ json: [] }));
  await page.getByRole("button", { name: "Find city" }).first().click();
  await expect(page.getByRole("alert")).toContainText("No cities found");
  await expect(
    page.getByRole("button", { name: "See my route forecast" }),
  ).toBeDisabled();
});
test("invalid past departure never calls route API", async ({ page }) => {
  await setup(page);
  let calls = 0;
  await page.route("**/api/trip", (r) => {
    calls++;
    return r.fulfill({ json: fixture });
  });
  await choose(page);
  await page
    .getByLabel("Departure time", { exact: true })
    .fill("2026-11-13T08:00");
  await page.getByRole("button", { name: "See my route forecast" }).click();
  await expect(page.getByRole("alert")).toContainText("future");
  expect(calls).toBe(0);
});
test("landing has no fake email signup and links to web planner", async ({
  page,
}) => {
  await page.goto("/routecast-landing.html");
  await expect(page.locator("input[type=email]")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Open the web planner" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Open the web planner" }).click();
  await expect(
    page.getByRole("heading", { name: "Make a plan" }),
  ).toBeVisible();
});

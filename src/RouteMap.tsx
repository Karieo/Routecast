import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { type Trip, weatherDescription } from "./domain";
export function RouteMap({ trip }: { trip: Trip }) {
  const container = useRef<HTMLDivElement>(null);
  const [tileError, setTileError] = useState(false);
  useEffect(() => {
    const map = L.map(container.current!, { scrollWheelZoom: false });
    const tiles = L.tileLayer(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 18,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
    ).addTo(map);
    tiles.on("tileerror", () => setTileError(true));
    const path = L.polyline(
      trip.route.coordinates.map(([lon, lat]) => [lat, lon]),
      { color: "#f67837", weight: 5 },
    ).addTo(map);
    trip.stops.forEach((stop, i) => {
      const content = document.createElement("span");
      content.textContent = `${i + 1}. ${stop.weather ? weatherDescription(stop.weather.code) : "Weather unavailable"}`;
      L.marker([stop.coordinate[1], stop.coordinate[0]], {
        icon: L.divIcon({
          className: "route-pin",
          html: String(i + 1),
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
        title: content.textContent,
      })
        .addTo(map)
        .bindPopup(content);
    });
    map.fitBounds(path.getBounds(), { padding: [32, 32] });
    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(container.current!);
    return () => {
      resize.disconnect();
      map.remove();
    };
  }, [trip]);
  return (
    <section aria-label="Driving route map">
      <div ref={container} className="map" />
      {tileError && (
        <p className="notice">
          Map tiles could not load. The route line and numbered stops are still
          shown. Reload the page to retry tiles.
        </p>
      )}
      <p className="attribution">
        Route: <a href="https://project-osrm.org/">OSRM</a> · ©{" "}
        <a href="https://www.openstreetmap.org/copyright">
          OpenStreetMap contributors
        </a>{" "}
        · <a href="https://www.openstreetmap.org/fixthemap">Fix the map</a>
      </p>
    </section>
  );
}

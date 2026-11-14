import { useEffect, useRef, useState } from "react";
import { request } from "./api";
import { label, type Place } from "./domain";

export function PlaceSearch({
  title,
  selected,
  onChange,
  onEdit,
}: {
  title: string;
  selected: Place | null;
  onChange: (p: Place) => void;
  onEdit: () => void;
}) {
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const version = useRef(0);
  useEffect(() => () => controller.current?.abort(), []);
  function cancel() {
    version.current++;
    controller.current?.abort();
    setBusy(false);
  }
  async function search() {
    cancel();
    const id = version.current;
    const c = new AbortController();
    controller.current = c;
    setBusy(true);
    setError("");
    setPlaces([]);
    try {
      const result = await request<Place[]>(
        `/api/places?q=${encodeURIComponent(query.trim())}`,
        c.signal,
      );
      if (id !== version.current) return;
      setPlaces(result);
      if (!result.length)
        setError(
          "No cities found. Try a city name, with a state or country after a comma.",
        );
    } catch (e) {
      if (id === version.current)
        setError(e instanceof Error ? e.message : "City search failed. Retry.");
    } finally {
      if (id === version.current) setBusy(false);
    }
  }
  return (
    <div className="place-search">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <label htmlFor={title}>{title}</label>
        <div className="input-row">
          <input
            id={title}
            value={query}
            required
            minLength={2}
            maxLength={100}
            placeholder={
              title === "From" ? "La Vernia, Texas" : "Midland, Texas"
            }
            autoComplete="off"
            onChange={(e) => {
              cancel();
              setQuery(e.target.value);
              setPlaces([]);
              setError("");
              onEdit();
            }}
          />
          <button
            className="secondary"
            type="submit"
            disabled={busy || query.trim().length < 2}
          >
            {busy ? "Searching…" : "Find city"}
          </button>
        </div>
      </form>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {places.length > 0 && !selected && (
        <div className="choices" aria-label={`${title} city matches`}>
          <p>Select the city you mean:</p>
          {places.map((p) => (
            <button
              key={p.id}
              className="choice"
              onClick={() => {
                cancel();
                onChange(p);
                setQuery(label(p));
                setPlaces([]);
              }}
            >
              <strong>{p.name}</strong>
              <span>
                {[p.region, p.country].filter(Boolean).join(", ")} ·{" "}
                {p.timezone}
              </span>
            </button>
          ))}
        </div>
      )}
      {selected && <p className="selected">✓ {label(selected)}</p>}
    </div>
  );
}

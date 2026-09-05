"use client";

import { useEffect, useState } from "react";
import { X, Plus } from "lucide-react";
import { getLocationOptions, type GeoCountry, type PreferenceLocation } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const MAX_LOCATIONS = 10;
// Base UI's Select decides controlled-vs-uncontrolled from whether `value`
// is `undefined` on its FIRST render, and errors if that ever flips later.
// countryCode/stateCode/cityName start out `null` (nothing picked yet), and
// `null ?? undefined` evaluates to `undefined`: so on first render every
// Select here was uncontrolled, then became controlled the moment a real
// code was picked, tripping exactly that check. Passing `countryCode`
// itself (typed string | null, never actually undefined) keeps each Select
// controlled from the very first render onward: `null` is a real,
// distinct value Base UI's Select understands as "nothing selected" (its
// own hasSelectedValue check is `value == null`), which is what makes the
// placeholder text show correctly; a non-null sentinel string here instead
// (tried first) made Select think something WAS selected and render that
// sentinel's own raw text since no item matches it.

function locationLabel(loc: PreferenceLocation): string {
  return [loc.cityName, loc.stateName, loc.countryName].filter(Boolean).join(", ");
}

function sameLocation(a: PreferenceLocation, b: PreferenceLocation): boolean {
  return a.countryCode === b.countryCode && a.stateCode === b.stateCode && a.cityName === b.cityName;
}

// Country -> state -> city, in that order, each disabled until its parent is
// chosen and reset whenever that parent changes: picking a new country
// with a state already selected would otherwise leave a state that belongs
// to the PREVIOUS country silently attached. Selections are added to a chip
// list rather than replacing a single value: multiple locations are allowed
// and matched as OR (see the server's matching/predicate.ts), never AND.
export default function LocationPicker({
  value,
  onChange,
}: {
  value: PreferenceLocation[];
  onChange: (locations: PreferenceLocation[]) => void;
}) {
  const [countries, setCountries] = useState<GeoCountry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [countryCode, setCountryCode] = useState<string | null>(null);
  const [stateCode, setStateCode] = useState<string | null>(null);
  const [cityName, setCityName] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getLocationOptions()
      .then((res) => {
        if (active) setCountries(res.countries);
      })
      .catch(() => {
        if (active) setError("Couldn't load the list of countries. Please try again.");
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return <p className="text-[0.83rem] text-danger">{error}</p>;
  }

  if (!countries) {
    return (
      <div className="grid grid-cols-3 gap-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  const country = countries.find((c) => c.code === countryCode) ?? null;
  const state = country?.states.find((s) => s.code === stateCode) ?? null;
  const atLimit = value.length >= MAX_LOCATIONS;

  function addLocation() {
    if (!country) return;
    const next: PreferenceLocation = {
      countryCode: country.code,
      countryName: country.name,
      stateCode: state?.code ?? null,
      stateName: state?.name ?? null,
      cityName: cityName,
    };
    if (value.some((loc) => sameLocation(loc, next))) return; // already added: adding again would be a silent duplicate chip
    onChange([...value, next]);
    setCountryCode(null);
    setStateCode(null);
    setCityName(null);
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Select
          value={countryCode}
          onValueChange={(v) => {
            setCountryCode(v);
            setStateCode(null);
            setCityName(null);
          }}
        >
          <SelectTrigger className="w-full bg-surface" aria-label="Country">
            <SelectValue placeholder="Select country" />
          </SelectTrigger>
          <SelectContent>
            {countries.map((c) => (
              <SelectItem key={c.code} value={c.code}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={stateCode}
          disabled={!country}
          onValueChange={(v) => {
            setStateCode(v);
            setCityName(null);
          }}
        >
          <SelectTrigger className="w-full bg-surface" aria-label="State or region">
            <SelectValue placeholder={country ? "Select state" : "Select country first"} />
          </SelectTrigger>
          <SelectContent>
            {country?.states.map((s) => (
              <SelectItem key={s.code} value={s.code}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={cityName} disabled={!state} onValueChange={setCityName}>
          <SelectTrigger className="w-full bg-surface" aria-label="City">
            <SelectValue placeholder={state ? "Select city" : "Select state first"} />
          </SelectTrigger>
          <SelectContent>
            {state?.cities.map((city) => (
              <SelectItem key={city} value={city}>
                {city}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button type="button" variant="outline" size="sm" onClick={addLocation} disabled={!country || atLimit} className="gap-1.5">
        <Plus className="size-3.5" />
        Add location
      </Button>
      {atLimit && <p className="text-[0.78rem] text-ink-faint">Up to {MAX_LOCATIONS} locations.</p>}

      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((loc, i) => (
            <li
              key={`${loc.countryCode}-${loc.stateCode}-${loc.cityName}-${i}`}
              className="flex items-center gap-1.5 rounded-full border border-line bg-surface py-1 pl-3 pr-1.5 text-[0.82rem] text-ink-secondary"
            >
              {locationLabel(loc)}
              <button
                type="button"
                onClick={() => onChange(value.filter((_, idx) => idx !== i))}
                aria-label={`Remove ${locationLabel(loc)}`}
                className="grid size-4.5 shrink-0 place-items-center rounded-full text-ink-faint transition-colors hover:bg-tint-strong hover:text-ink"
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

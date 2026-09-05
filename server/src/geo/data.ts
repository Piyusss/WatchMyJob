// A curated (not exhaustive) country -> state/region -> city hierarchy,
// covering the countries and hubs that actually appear in this product's
// real job data today (see the companies' real postings) plus the other
// major tech-hiring markets. Deliberately not a full worldwide gazetteer:
// a comprehensive dataset was considered and explicitly declined in favor
// of this, kept small enough to hand-maintain and to render as a snappy
// cascading picker with a single upfront fetch, no round-trip per level.
//
// City-scale countries (Singapore) get one pseudo-region matching the
// country name rather than a special two-level case: keeping every
// country exactly three levels deep means the picker UI never needs to
// special-case "this country has no states."
export interface GeoState {
  code: string;
  name: string;
  cities: string[];
}

export interface GeoCountry {
  code: string;
  name: string;
  states: GeoState[];
}

export const GEO_DATA: GeoCountry[] = [
  {
    code: "US",
    name: "United States",
    states: [
      {
        code: "CA",
        name: "California",
        cities: ["San Francisco", "Mountain View", "Palo Alto", "San Jose", "Los Angeles"],
      },
      { code: "NY", name: "New York", cities: ["New York City", "Brooklyn"] },
      { code: "WA", name: "Washington", cities: ["Seattle", "Bellevue"] },
      { code: "TX", name: "Texas", cities: ["Austin", "Dallas", "Houston"] },
      { code: "IL", name: "Illinois", cities: ["Chicago"] },
      { code: "MA", name: "Massachusetts", cities: ["Boston", "Cambridge"] },
      { code: "DC", name: "District of Columbia", cities: ["Washington"] },
    ],
  },
  {
    code: "IN",
    name: "India",
    states: [
      { code: "KA", name: "Karnataka", cities: ["Bangalore", "Mysore"] },
      { code: "MH", name: "Maharashtra", cities: ["Pune", "Mumbai"] },
      { code: "TG", name: "Telangana", cities: ["Hyderabad"] },
      { code: "TN", name: "Tamil Nadu", cities: ["Chennai", "Coimbatore"] },
      { code: "DL", name: "Delhi", cities: ["New Delhi"] },
      { code: "PB", name: "Punjab", cities: ["Mohali", "Chandigarh"] },
    ],
  },
  {
    code: "GB",
    name: "United Kingdom",
    states: [
      { code: "ENG", name: "England", cities: ["London", "Manchester", "Cambridge"] },
      { code: "SCT", name: "Scotland", cities: ["Edinburgh", "Glasgow"] },
    ],
  },
  {
    code: "CA",
    name: "Canada",
    states: [
      { code: "ON", name: "Ontario", cities: ["Toronto", "Ottawa"] },
      { code: "BC", name: "British Columbia", cities: ["Vancouver"] },
      { code: "QC", name: "Quebec", cities: ["Montreal"] },
    ],
  },
  {
    code: "DE",
    name: "Germany",
    states: [
      { code: "BY", name: "Bavaria", cities: ["Munich"] },
      { code: "BE", name: "Berlin", cities: ["Berlin"] },
      { code: "HE", name: "Hesse", cities: ["Frankfurt"] },
    ],
  },
  {
    code: "NL",
    name: "Netherlands",
    states: [
      { code: "NH", name: "North Holland", cities: ["Amsterdam"] },
      { code: "ZH", name: "South Holland", cities: ["Rotterdam", "The Hague"] },
    ],
  },
  {
    code: "AU",
    name: "Australia",
    states: [
      { code: "NSW", name: "New South Wales", cities: ["Sydney"] },
      { code: "VIC", name: "Victoria", cities: ["Melbourne"] },
    ],
  },
  {
    code: "FR",
    name: "France",
    states: [{ code: "IDF", name: "Île-de-France", cities: ["Paris"] }],
  },
  {
    code: "JP",
    name: "Japan",
    states: [{ code: "13", name: "Tokyo", cities: ["Tokyo"] }],
  },
  {
    code: "SG",
    name: "Singapore",
    states: [{ code: "SG", name: "Singapore", cities: ["Singapore"] }],
  },
  {
    code: "IE",
    name: "Ireland",
    states: [{ code: "L", name: "Leinster", cities: ["Dublin"] }],
  },
  {
    code: "KR",
    name: "South Korea",
    states: [{ code: "11", name: "Seoul", cities: ["Seoul"] }],
  },
  {
    code: "SE",
    name: "Sweden",
    states: [{ code: "AB", name: "Stockholm County", cities: ["Stockholm"] }],
  },
  {
    code: "IL",
    name: "Israel",
    states: [{ code: "TA", name: "Tel Aviv District", cities: ["Tel Aviv"] }],
  },
];

export function findCountry(code: string): GeoCountry | undefined {
  return GEO_DATA.find((c) => c.code === code);
}

export function findState(countryCode: string, stateCode: string): GeoState | undefined {
  return findCountry(countryCode)?.states.find((s) => s.code === stateCode);
}

export function isValidCity(countryCode: string, stateCode: string, cityName: string): boolean {
  return findState(countryCode, stateCode)?.cities.includes(cityName) ?? false;
}

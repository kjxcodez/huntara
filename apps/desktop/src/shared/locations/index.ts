/**
 * HUNTARA Canonical Geographic Engine
 * Provides version-pinned, local, offline-capable ISO-3166 location lookups,
 * natural-language searching, and bidirectional normalization.
 */

import countriesData from './data/countries.json';
import regionsData from './data/regions.json';
import citiesData from './data/cities.json';
import type { LocationCountry, LocationRegion, LocationCity, LocationSearchResult } from './types';

export * from './types';

// Pre-index data into memory for O(1) lookups
const COUNTRIES_LIST: LocationCountry[] = countriesData as LocationCountry[];
const REGIONS_DICT: Record<string, LocationRegion[]> = regionsData as Record<string, LocationRegion[]>;
const CITIES_DICT: Record<string, string[]> = citiesData as Record<string, string[]>;

const countryByCodeMap = new Map<string, LocationCountry>();
const countryByNameMap = new Map<string, LocationCountry>();
const countryByIso3Map = new Map<string, LocationCountry>();

COUNTRIES_LIST.forEach((c) => {
  countryByCodeMap.set(c.code.toUpperCase(), c);
  countryByNameMap.set(c.name.toLowerCase(), c);
  if (c.iso3) {
    countryByIso3Map.set(c.iso3.toUpperCase(), c);
  }
});

// Common alias mappings for countries (e.g. USA, UK, UAE, South Korea)
const COUNTRY_ALIASES: Record<string, string> = {
  usa: 'US',
  us: 'US',
  america: 'US',
  uk: 'GB',
  gb: 'GB',
  britain: 'GB',
  uae: 'AE',
  emirates: 'AE',
  russia: 'RU',
  korea: 'KR',
  'south korea': 'KR',
  holland: 'NL',
  vietnam: 'VN'
};

/**
 * Returns all 248+ ISO-3166-1 countries.
 */
export function getAllCountries(): LocationCountry[] {
  return COUNTRIES_LIST;
}

/**
 * Find country by ISO alpha-2 code (case-insensitive).
 */
export function getCountryByCode(code: string): LocationCountry | undefined {
  if (!code) return undefined;
  return countryByCodeMap.get(code.trim().toUpperCase());
}

/**
 * Find country by name, alias, or ISO-3 code.
 */
export function getCountryByNameOrAlias(nameOrAlias: string): LocationCountry | undefined {
  if (!nameOrAlias) return undefined;
  const trimmed = nameOrAlias.trim();
  const lower = trimmed.toLowerCase();
  const upper = trimmed.toUpperCase();

  // 1. Direct name match
  if (countryByNameMap.has(lower)) {
    return countryByNameMap.get(lower);
  }

  // 2. Direct code match (alpha-2 or alpha-3)
  if (countryByCodeMap.has(upper)) {
    return countryByCodeMap.get(upper);
  }
  if (countryByIso3Map.has(upper)) {
    return countryByIso3Map.get(upper);
  }

  // 3. Known aliases
  if (COUNTRY_ALIASES[lower] && countryByCodeMap.has(COUNTRY_ALIASES[lower])) {
    return countryByCodeMap.get(COUNTRY_ALIASES[lower]);
  }

  // 4. Starts with / partial prefix match
  for (const [cName, country] of countryByNameMap.entries()) {
    if (cName.startsWith(lower) || lower.startsWith(cName)) {
      return country;
    }
  }

  return undefined;
}

/**
 * Returns all first-level administrative subdivisions for a country.
 */
export function getRegionsByCountry(countryCodeOrName: string): LocationRegion[] {
  if (!countryCodeOrName) return [];
  const country = getCountryByNameOrAlias(countryCodeOrName);
  if (!country) return [];
  return REGIONS_DICT[country.code] || [];
}

/**
 * Find a specific region within a country by code or name.
 */
export function getRegion(countryCodeOrName: string, regionCodeOrName: string): LocationRegion | undefined {
  if (!countryCodeOrName || !regionCodeOrName) return undefined;
  const regions = getRegionsByCountry(countryCodeOrName);
  if (!regions.length) return undefined;

  const target = regionCodeOrName.trim();
  const targetLower = target.toLowerCase();
  const targetUpper = target.toUpperCase();

  // 1. Exact subdivision code match
  const byCode = regions.find((r) => r.code.toUpperCase() === targetUpper);
  if (byCode) return byCode;

  // 2. Exact subdivision name match
  const byName = regions.find((r) => r.name.toLowerCase() === targetLower);
  if (byName) return byName;

  // 3. Partial subdivision name match (e.g. "Quebec" matching "Quebec" or "Bavaria" matching "Bavaria (Bayern)")
  return regions.find(
    (r) => r.name.toLowerCase().includes(targetLower) || targetLower.includes(r.name.toLowerCase())
  );
}

/**
 * Returns populated cities for a country and state/region.
 */
export function getCitiesByRegion(countryCodeOrName: string, regionCodeOrName: string): string[] {
  if (!countryCodeOrName || !regionCodeOrName) return [];
  const country = getCountryByNameOrAlias(countryCodeOrName);
  if (!country) return [];

  const region = getRegion(country.code, regionCodeOrName);
  if (!region) return [];

  const key = `${country.code}-${region.code}`;
  return CITIES_DICT[key] || [];
}

/**
 * Normalizes any country representation to its canonical English name.
 * e.g. "US" -> "United States", "USA" -> "United States", "uk" -> "United Kingdom"
 */
export function normalizeCountryName(countryInput: string): string {
  if (!countryInput) return '';
  const match = getCountryByNameOrAlias(countryInput);
  return match ? match.name : countryInput.trim();
}

/**
 * Normalizes any state/region representation to its canonical name.
 * e.g. "FL" -> "Florida", "CA" -> "California", "ON" -> "Ontario"
 */
export function normalizeStateName(stateInput: string, countryInput?: string): string {
  if (!stateInput) return '';
  const trimmed = stateInput.trim();

  // If country context is provided, search within that country's subdivisions first
  if (countryInput) {
    const region = getRegion(countryInput, trimmed);
    if (region) return region.name;
  }

  // Otherwise search across all regions globally
  const trimmedUpper = trimmed.toUpperCase();
  const trimmedLower = trimmed.toLowerCase();

  // Prefer exact code match across top countries (US, CA, GB, AU, IN, DE, FR)
  const priorityCountries = ['US', 'CA', 'GB', 'AU', 'IN', 'DE', 'FR'];
  for (const cCode of priorityCountries) {
    const regions = REGIONS_DICT[cCode] || [];
    const found = regions.find((r) => r.code.toUpperCase() === trimmedUpper);
    if (found) return found.name;
  }

  // Check all remaining countries
  for (const regions of Object.values(REGIONS_DICT)) {
    const found = regions.find(
      (r) => r.code.toUpperCase() === trimmedUpper || r.name.toLowerCase() === trimmedLower
    );
    if (found) return found.name;
  }

  return trimmed;
}

/**
 * Fast search across countries, regions, and cities for autocompletion.
 */
export function searchLocations(query: string, limit = 15): LocationSearchResult[] {
  if (!query || query.trim().length === 0) return [];
  const q = query.trim().toLowerCase();
  const results: LocationSearchResult[] = [];

  // 1. Check countries
  for (const c of COUNTRIES_LIST) {
    if (c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q) {
      results.push({
        type: 'country',
        countryCode: c.code,
        countryName: c.name,
        displayName: c.name
      });
      if (results.length >= limit) return results;
    }
  }

  // 2. Check regions
  for (const [cCode, regions] of Object.entries(REGIONS_DICT)) {
    const country = countryByCodeMap.get(cCode);
    const countryName = country?.name || cCode;
    for (const r of regions) {
      if (r.name.toLowerCase().includes(q) || r.code.toLowerCase() === q) {
        results.push({
          type: 'region',
          countryCode: cCode,
          countryName,
          regionCode: r.code,
          regionName: r.name,
          displayName: `${r.name}, ${countryName}`
        });
        if (results.length >= limit) return results;
      }
    }
  }

  // 3. Check cities
  for (const [key, cities] of Object.entries(CITIES_DICT)) {
    const [cCode = '', rCode = ''] = key.split('-');
    const country = countryByCodeMap.get(cCode);
    const countryName = country?.name || cCode;
    const region = (REGIONS_DICT[cCode] || []).find((r) => r.code === rCode);
    const regionName = region?.name || rCode;

    for (const cityName of cities) {
      if (cityName.toLowerCase().includes(q)) {
        results.push({
          type: 'city',
          countryCode: cCode,
          countryName,
          regionCode: rCode,
          regionName,
          cityName,
          displayName: `${cityName}, ${regionName}, ${countryName}`
        });
        if (results.length >= limit) return results;
      }
    }
  }

  return results;
}

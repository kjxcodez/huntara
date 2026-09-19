/**
 * Location Adapter for HUNTARA
 * Backwards-compatible adapter delegating to the comprehensive, version-pinned
 * local geographic engine in `../locations`.
 */

import {
  getAllCountries,
  getCountryByCode as engineGetCountryByCode,
  getCountryByNameOrAlias,
  getRegionsByCountry,
  getRegion,
  getCitiesByRegion,
  normalizeCountryName as engineNormalizeCountryName,
  normalizeStateName as engineNormalizeStateName,
  searchLocations as engineSearchLocations,
  type LocationCountry,
  type LocationRegion
} from '../locations';

import regionsData from '../locations/data/regions.json';
import citiesData from '../locations/data/cities.json';

export interface CountryOption {
  code: string;
  name: string;
}

export interface StateOption {
  code: string;
  name: string;
  countryCode: string;
}

// 1. Authoritative 248+ ISO-3166-1 Countries List
export const COUNTRIES: CountryOption[] = getAllCountries().map((c) => ({
  code: c.code,
  name: c.name
}));

// 2. Comprehensive ISO-3166-2 Subdivisions by Country Code
export const STATES_BY_COUNTRY: Record<string, StateOption[]> = regionsData as Record<string, StateOption[]>;

// 3. Populated Cities Keyed by `${countryCode}-${regionCode}`
export const TOP_CITIES_BY_STATE: Record<string, string[]> = citiesData as Record<string, string[]>;

/**
 * Returns all available countries.
 */
export function getCountries(): CountryOption[] {
  return COUNTRIES;
}

/**
 * Returns all administrative states/regions for a given country code or name.
 */
export function getStatesForCountry(countryCodeOrName: string): StateOption[] {
  if (!countryCodeOrName) return [];
  const regions: LocationRegion[] = getRegionsByCountry(countryCodeOrName);
  return regions.map((r) => ({
    code: r.code,
    name: r.name,
    countryCode: r.countryCode
  }));
}

/**
 * Returns populated cities for a given country and state/region.
 */
export function getCitiesForState(countryCodeOrName: string, stateCodeOrName: string): string[] {
  if (!countryCodeOrName || !stateCodeOrName) return [];
  return getCitiesByRegion(countryCodeOrName, stateCodeOrName);
}

/**
 * Maps 2-letter state abbreviations or partial strings to canonical state name.
 * e.g. "FL" -> "Florida", "CA" -> "California", "ON" -> "Ontario", "NSW" -> "New South Wales"
 */
export function normalizeStateName(stateCodeOrName: string, countryCodeOrName?: string): string {
  return engineNormalizeStateName(stateCodeOrName, countryCodeOrName);
}

/**
 * Normalizes country code or common alias to standard canonical country name.
 * e.g. "US" -> "United States", "USA" -> "United States", "UK" -> "United Kingdom"
 */
export function normalizeCountryName(countryCodeOrName: string): string {
  return engineNormalizeCountryName(countryCodeOrName);
}

/**
 * Helper to get country by ISO code.
 */
export function getCountryByCode(code: string): LocationCountry | undefined {
  return engineGetCountryByCode(code);
}

/**
 * Helper to get country by name or alias.
 */
export function getCountryByName(name: string): LocationCountry | undefined {
  return getCountryByNameOrAlias(name);
}

/**
 * Helper to search locations across countries, regions, and cities.
 */
export function searchLocations(query: string, limit = 15) {
  return engineSearchLocations(query, limit);
}

/**
 * Canonical ISO Geographic Data Types for HUNTARA
 */

export interface LocationCountry {
  code: string;       // ISO 3166-1 alpha-2 (e.g. 'US', 'CA', 'GB', 'IN', 'DE')
  name: string;       // Canonical English name (e.g. 'United States')
  iso3?: string;      // ISO 3166-1 alpha-3 (e.g. 'USA')
  phoneCode?: string; // Dialing code (e.g. '+1')
}

export interface LocationRegion {
  code: string;       // ISO 3166-2 subdivision code (e.g. 'FL', 'ON', 'NSW', 'BY')
  name: string;       // Canonical subdivision name (e.g. 'Florida', 'Ontario')
  countryCode: string;// Parent country ISO code (e.g. 'US')
}

export interface LocationCity {
  name: string;       // City name (e.g. 'Miami', 'Toronto')
  regionCode: string; // Parent region code (e.g. 'FL')
  countryCode: string;// Parent country code (e.g. 'US')
}

export interface LocationSearchResult {
  type: 'country' | 'region' | 'city';
  countryCode: string;
  countryName: string;
  regionCode?: string;
  regionName?: string;
  cityName?: string;
  displayName: string;
}

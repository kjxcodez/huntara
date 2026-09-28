/**
 * Centralized query parameter serialization utility for HUNTARA SDK.
 *
 * Invariant (Phase 2C / F-06):
 * 1. undefined and null values are completely omitted (never emitted as literal "undefined" or "null").
 * 2. Arrays are appended per item.
 * 3. Empty objects / plain objects are skipped to prevent "[object Object]" corruption.
 * 4. Strings, numbers, and booleans are standard URL encoded.
 */
export function toQueryString(params?: Record<string, any>): string {
  if (!params || typeof params !== 'object') return '';
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) {
          searchParams.append(key, String(item));
        }
      }
    } else if (typeof value === 'object') {
      continue;
    } else {
      searchParams.append(key, String(value));
    }
  }

  const qs = searchParams.toString();
  return qs ? `?${qs}` : '';
}

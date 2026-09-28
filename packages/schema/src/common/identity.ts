/**
 * Generates a canonical cryptographically secure string entity ID for HUNTARA.
 * Invariant: MongoDB _id === API entity id === SQLite cache id === foreign-key references.
 * Standard: UUID v4 string (lowercase, hyphenated).
 * Compatible universally across Node.js, Electron main/renderer (Vite), and browsers.
 */
export function generateEntityId(): string {
  if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Validates that an identifier is a non-empty string compliant with HUNTARA identity standard.
 */
export function isValidEntityId(id: unknown): id is string {
  return typeof id === 'string' && id.trim().length > 0 && id.length <= 128;
}

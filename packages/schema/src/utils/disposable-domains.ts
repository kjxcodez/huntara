/**
 * HUNTARA — Disposable & Temporary Email Provider Intelligence
 *
 * High-confidence curated dictionary of temporary, burner, and disposable mail domains.
 * Emails hosted on these domains must never be claimed deliverable or contacted in outreach.
 */

export const DISPOSABLE_EMAIL_DOMAINS = new Set<string>([
  'mailinator.com',
  'guerrillamail.com',
  'guerrillamail.biz',
  'guerrillamail.de',
  'guerrillamail.net',
  'guerrillamail.org',
  'sharklasers.com',
  'grr.la',
  'pokemail.net',
  'tempmail.com',
  'temp-mail.org',
  'temp-mail.io',
  '10minutemail.com',
  '10minutemail.net',
  'throwawaymail.com',
  'trashmail.com',
  'trashmail.net',
  'trashmail.org',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
  'cool.fr.nf',
  'jetable.fr.nf',
  'nospam.ze.tc',
  'nomail.xl.cx',
  'mega.zik.dj',
  'speed.1s.fr',
  'courriel.fr.nf',
  'moncourrier.fr.nf',
  'monemail.fr.nf',
  'monmail.fr.nf',
  'dispostable.com',
  'getairmail.com',
  'mohmal.com',
  'burnermail.io',
  'crazymailing.com',
  'fakemailgenerator.com',
  'inboxkitten.com',
  'emailondeck.com',
  'generator.email',
  'mytemp.email',
  'guerrillamailblock.com',
  'dropmail.me',
  'getnada.com',
  'nada.ltd',
  'nada.email',
  'inboxbear.com',
  'internxt.com/temporary-email'
]);

/**
 * Checks whether a domain (or its parent domain) belongs to a known disposable email provider.
 */
export function isDisposableEmailDomain(domain: string | null | undefined): boolean {
  if (!domain) return false;
  const clean = domain.toLowerCase().trim();
  if (DISPOSABLE_EMAIL_DOMAINS.has(clean)) return true;

  // Check parent domain (e.g., sub.mailinator.com -> mailinator.com)
  const parts = clean.split('.');
  if (parts.length > 2) {
    const parent = parts.slice(parts.length - 2).join('.');
    if (DISPOSABLE_EMAIL_DOMAINS.has(parent)) return true;
  }

  return false;
}

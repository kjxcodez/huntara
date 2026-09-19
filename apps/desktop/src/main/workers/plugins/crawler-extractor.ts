/**
 * LeadForge OS — Crawler Email Candidate Extractor
 *
 * Implements staged, evidence-preserving email candidate extraction:
 * 1. Explicit mailto: URIs
 * 2. Structured JSON-LD metadata (Organization, LocalBusiness, ContactPoint, @graph)
 * 3. Explicit HTML metadata (itemprop="email", og:email)
 * 4. Recursive depth-first DOM text traversal with semantic element boundaries
 *
 * Integrates directly with the Phase 2 correctness engine (tldts / EmailCandidate)
 * to enforce company-domain affiliation, third-party isolation, and conservative naming.
 */

import * as cheerio from 'cheerio';
import { parse as parseDomain } from 'tldts';
import {
  evaluateEmailCandidate,
  ROLE_LOCAL_PARTS,
  ContactEmailStatus,
  type EmailCandidate,
  type EmailSourceType,
  type ContactEmailMeta
} from '@huntara/schema';

export interface DiscoveredContactCandidate {
  email: string;
  emailStatus: ContactEmailStatus;
  emailMeta: ContactEmailMeta;
  firstName: string | null;
  lastName: string | null;
  candidate: EmailCandidate;
}

export interface ExtractionResult {
  candidates: DiscoveredContactCandidate[];
  thirdPartyCandidates: DiscoveredContactCandidate[];
  isParkedPage: boolean;
  title: string;
}

// Rank source types by evidentiary weight
const SOURCE_RANK: Record<EmailSourceType, number> = {
  mailto: 4,
  json_ld: 3,
  metadata: 2,
  dom_text: 1,
  manual: 1,
  unknown: 0
};

// Known parking / generic registrar landing patterns
const PARKED_PAGE_SIGNALS = [
  /buy this domain/i,
  /this domain is parked/i,
  /domain is for sale/i,
  /inquire about this domain/i,
  /dan\.com/i,
  /sedo domain parking/i,
  /hugedomains\.com/i,
  /under construction/i,
  /default web site page/i,
  /godaddy.*parked/i
];

/**
 * Checks if page title or text matches known domain parking templates.
 */
function isParkedLandingPage(title: string, textSnippet: string): boolean {
  for (const pattern of PARKED_PAGE_SIGNALS) {
    if (pattern.test(title) || pattern.test(textSnippet)) {
      return true;
    }
  }
  return false;
}

/**
 * Conservatively infers person names from personal email local-parts.
 * For role accounts (info, sales, support, etc.), returns null for both names.
 */
export function extractConservativeName(
  candidate: EmailCandidate
): { firstName: string | null; lastName: string | null } {
  if (candidate.isRoleAccount || !candidate.localPart) {
    return { firstName: null, lastName: null };
  }

  const local = candidate.localPart.toLowerCase().trim();

  // If local-part is purely alphanumeric or contains standard name separators (dot, underscore, hyphen)
  const parts = local.split(/[._-]/).filter((p) => p.length >= 2 && /^[a-zA-Z]+$/.test(p));

  if (parts.length === 2) {
    const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    return {
      firstName: capitalize(parts[0]!),
      lastName: capitalize(parts[1]!)
    };
  }

  if (parts.length === 1 && parts[0]!.length >= 3 && /^[a-zA-Z]+$/.test(parts[0]!)) {
    const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    return {
      firstName: capitalize(parts[0]!),
      lastName: null
    };
  }

  return { firstName: null, lastName: null };
}

/**
 * Recursively extracts visible text chunks from a Cheerio DOM element,
 * inserting spacing tokens between block, section, and inline boundaries
 * to prevent adjacent node concatenation.
 */
function extractTextChunksRecursively($: cheerio.CheerioAPI, element: any, chunks: string[]) {
  // Disallowed tags
  const tagName = (element as any).tagName?.toLowerCase();
  if (
    tagName === 'script' ||
    tagName === 'style' ||
    tagName === 'noscript' ||
    tagName === 'svg' ||
    tagName === 'head' ||
    tagName === 'iframe' ||
    tagName === 'object' ||
    tagName === 'audio' ||
    tagName === 'video'
  ) {
    return;
  }

  // Check for hidden attributes
  const attribs = (element as any).attribs || {};
  if (attribs['aria-hidden'] === 'true' || attribs.hidden !== undefined) {
    return;
  }
  const style = (attribs.style || '').toLowerCase();
  if (style.includes('display:none') || style.includes('visibility:hidden')) {
    return;
  }

  const children = (element as any).children || [];
  for (const child of children) {
    if (child.type === 'text') {
      const text = child.data?.replace(/[\r\n\t]+/g, ' ').trim();
      if (text) {
        chunks.push(` ${text} `);
      }
    } else if (child.type === 'tag') {
      chunks.push(' ');
      extractTextChunksRecursively($, child, chunks);
      chunks.push(' ');
    }
  }
}

/**
 * Extracts raw email candidate strings from visible DOM text using recursive boundary traversal.
 */
function extractVisibleDomTextCandidates($: cheerio.CheerioAPI): string[] {
  const body = $('body')[0];
  if (!body) return [];

  const chunks: string[] = [];
  extractTextChunksRecursively($, body, chunks);
  const fullText = chunks.join('');

  // Regex detector
  const matches = fullText.match(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g);
  return matches ? Array.from(new Set(matches)) : [];
}

/**
 * Extracts emails declared in explicit mailto: links.
 */
function extractMailtoCandidates($: cheerio.CheerioAPI): string[] {
  const results: string[] = [];
  $('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const cleanHref = href.replace(/^mailto:/i, '').trim();
    // Strip query string (subject, cc, etc.)
    const emailTarget = cleanHref.split('?')[0]?.trim();
    if (emailTarget) {
      results.push(emailTarget);
    }
  });
  return results;
}

/**
 * Extracts email strings from JSON-LD Schema.org blocks.
 */
function extractJsonLdCandidates($: cheerio.CheerioAPI): string[] {
  const results: string[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const content = $(el).html() || '';
      if (!content.trim()) return;

      const data = JSON.parse(content);
      traverseJsonLd(data, results);
    } catch {
      // Malformed JSON-LD must not crash extraction
    }
  });

  return results;
}

function traverseJsonLd(node: any, results: string[]) {
  if (!node) return;

  if (Array.isArray(node)) {
    for (const item of node) {
      traverseJsonLd(item, results);
    }
    return;
  }

  if (typeof node === 'object') {
    // Check if node has @graph
    if (node['@graph'] && Array.isArray(node['@graph'])) {
      traverseJsonLd(node['@graph'], results);
    }

    // Check relevant Schema.org email fields
    if (typeof node.email === 'string' && node.email.includes('@')) {
      results.push(node.email.replace(/^mailto:/i, '').trim());
    }

    // Check contactPoint(s)
    if (node.contactPoint) {
      traverseJsonLd(node.contactPoint, results);
    }
    if (node.contactPoints) {
      traverseJsonLd(node.contactPoints, results);
    }

    // Check author/creator/department
    if (node.department) {
      traverseJsonLd(node.department, results);
    }
  }
}

/**
 * Extracts explicit metadata tags (itemprop="email", og:email).
 */
function extractMetadataCandidates($: cheerio.CheerioAPI): string[] {
  const results: string[] = [];

  // itemprop="email"
  $('[itemprop="email"]').each((_, el) => {
    const content = $(el).attr('content') || $(el).text() || '';
    const clean = content.replace(/^mailto:/i, '').trim();
    if (clean.includes('@')) results.push(clean);
  });

  // meta og:email / meta name="email"
  $('meta[property="og:email"], meta[name="email"]').each((_, el) => {
    const content = $(el).attr('content') || '';
    const clean = content.replace(/^mailto:/i, '').trim();
    if (clean.includes('@')) results.push(clean);
  });

  return results;
}

/**
 * Main Candidate Extraction Engine.
 * Parses HTML, evaluates candidates through Phase 2 correctness engine,
 * deduplicates by evidentiary rank, and returns categorized candidates.
 */
export function extractCandidatesFromHtml(
  html: string,
  pageUrl: string,
  companyDomain?: string
): ExtractionResult {
  if (!html || typeof html !== 'string') {
    return { candidates: [], thirdPartyCandidates: [], isParkedPage: false, title: '' };
  }

  const $ = cheerio.load(html);
  const title = $('title').text()?.trim() || '';
  const initialSnippet = html.slice(0, 3000);
  const isParked = isParkedLandingPage(title, initialSnippet);

  // Raw candidate collections with their respective source types
  interface RawEntry {
    raw: string;
    sourceType: EmailSourceType;
  }
  const rawCandidates: RawEntry[] = [];

  // 1. mailto: (highest priority)
  for (const m of extractMailtoCandidates($)) {
    rawCandidates.push({ raw: m, sourceType: 'mailto' });
  }

  // 2. json_ld
  for (const j of extractJsonLdCandidates($)) {
    rawCandidates.push({ raw: j, sourceType: 'json_ld' });
  }

  // 3. metadata
  for (const md of extractMetadataCandidates($)) {
    rawCandidates.push({ raw: md, sourceType: 'metadata' });
  }

  // 4. visible DOM text (recursive depth-first traversal)
  for (const dt of extractVisibleDomTextCandidates($)) {
    rawCandidates.push({ raw: dt, sourceType: 'dom_text' });
  }

  // Deduplicate and process candidates through Phase 2 candidate correctness engine
  const evaluatedByEmail = new Map<string, { candidate: EmailCandidate; sourceType: EmailSourceType }>();

  for (const entry of rawCandidates) {
    const evaluated = evaluateEmailCandidate(entry.raw, {
      sourceType: entry.sourceType,
      sourceUrl: pageUrl,
      companyDomain
    });

    if (!evaluated.normalized || evaluated.classification === 'invalid') {
      continue;
    }

    const email = evaluated.normalized;
    const existing = evaluatedByEmail.get(email);

    if (!existing) {
      evaluatedByEmail.set(email, { candidate: evaluated, sourceType: entry.sourceType });
    } else {
      // Deduplication: outrank weaker sources with stronger sources (mailto > json_ld > metadata > dom_text)
      const currentRank = SOURCE_RANK[existing.sourceType] || 0;
      const newRank = SOURCE_RANK[entry.sourceType] || 0;
      if (newRank > currentRank) {
        evaluatedByEmail.set(email, { candidate: evaluated, sourceType: entry.sourceType });
      }
    }
  }

  const candidates: DiscoveredContactCandidate[] = [];
  const thirdPartyCandidates: DiscoveredContactCandidate[] = [];

  for (const [email, { candidate }] of evaluatedByEmail) {
    // If site was detected as parked lander, force quarantine
    let classification = candidate.classification;
    if (isParked && classification !== 'quarantined') {
      classification = 'quarantined';
    }

    // Phase 10 Invariant: Never automatically promote newly discovered candidates to VALID.
    // Address remains UNVERIFIED until verified through email quality or verification layers.
    let emailStatus: ContactEmailStatus;
    if (classification === 'quarantined' || classification === 'ambiguous') {
      emailStatus = ContactEmailStatus.QUARANTINED;
    } else {
      emailStatus = ContactEmailStatus.UNVERIFIED;
    }

    const { firstName, lastName } = extractConservativeName(candidate);

    const emailMeta: ContactEmailMeta = {
      raw: candidate.raw,
      sourceUrl: pageUrl,
      sourceType: candidate.sourceType,
      confidenceTier: classification,
      domainMatched: candidate.domainMatched,
      repaired: candidate.repaired,
      repairRule: candidate.repairRule || undefined,
      isRoleAccount: candidate.isRoleAccount
    };

    const discovered: DiscoveredContactCandidate = {
      email,
      emailStatus,
      emailMeta,
      firstName,
      lastName,
      candidate
    };

    // Separate company-affiliated contacts from external third-party credits
    if (classification === 'third_party' || candidate.domainMatched === false) {
      thirdPartyCandidates.push(discovered);
    } else {
      candidates.push(discovered);
    }
  }

  return {
    candidates,
    thirdPartyCandidates,
    isParkedPage: isParked,
    title
  };
}

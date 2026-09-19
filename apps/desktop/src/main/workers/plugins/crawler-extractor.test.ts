/**
 * LeadForge OS — Crawler Email Extractor Integration Tests
 *
 * Validates the 12 deterministic HTML fixtures and crawler invariants
 * defined in Phase 3: Production Crawler & Email Discovery Integration.
 */

import { describe, it, expect } from 'vitest';
import { extractCandidatesFromHtml } from './crawler-extractor.js';
import { ContactEmailStatus } from '@huntara/schema';

describe('Crawler Email Extractor Integration Tests', () => {
  it('Fixture 1: Simple mailto extraction', () => {
    const html = `<html><body><p>Contact us: <a href="mailto:john@company.com">Email John</a></p></body></html>`;
    const res = extractCandidatesFromHtml(html, 'https://company.com/contact', 'company.com');
    expect(res.candidates.length).toBe(1);
    expect(res.candidates[0]?.email).toBe('john@company.com');
    expect(res.candidates[0]?.emailMeta.sourceType).toBe('mailto');
    expect(res.candidates[0]?.emailMeta.domainMatched).toBe(true);
  });

  it('Fixture 2: Adjacent text corruption across semantic elements', () => {
    const html = `
      <html>
        <body>
          <nav>Information</nav>
          <a href="mailto:info@company.com">info@company.com</a>
          <section>Warranty</section>
        </body>
      </html>
    `;
    const res = extractCandidatesFromHtml(html, 'https://company.com', 'company.com');
    expect(res.candidates.length).toBe(1);
    expect(res.candidates[0]?.email).toBe('info@company.com');
    expect(res.candidates.some((c) => c.email.includes('information'))).toBe(false);
    expect(res.candidates.some((c) => c.email.includes('warranty'))).toBe(false);
  });

  it('Fixture 3: Navigation + header + footer + label + button combinations', () => {
    const html = `
      <html>
        <header><div class="logo">Acme Corp</div></header>
        <nav><a href="/">Home</a><a href="/about">About</a></nav>
        <main>
          <label>Email Address:</label>
          <span>contact@company.com</span>
          <button type="button">Copy</button>
          <address>123 Main St, City, ST</address>
        </main>
        <footer><span>Privacy Policy</span></footer>
      </html>
    `;
    const res = extractCandidatesFromHtml(html, 'https://company.com', 'company.com');
    expect(res.candidates.length).toBe(1);
    expect(res.candidates[0]?.email).toBe('contact@company.com');
  });

  it('Fixture 4: Multiple adjacent emails without concatenation', () => {
    const html = `
      <div>
        <a href="mailto:a@company.com">A</a>
        <a href="mailto:b@company.com">B</a>
      </div>
    `;
    const res = extractCandidatesFromHtml(html, 'https://company.com', 'company.com');
    expect(res.candidates.length).toBe(2);
    const emails = res.candidates.map((c) => c.email).sort();
    expect(emails).toEqual(['a@company.com', 'b@company.com']);
  });

  it('Fixture 5: JSON-LD Organization email extraction', () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Organization",
              "name": "Acme Inc",
              "email": "org@company.com"
            }
          </script>
        </head>
        <body><h1>Welcome</h1></body>
      </html>
    `;
    const res = extractCandidatesFromHtml(html, 'https://company.com', 'company.com');
    expect(res.candidates.length).toBe(1);
    expect(res.candidates[0]?.email).toBe('org@company.com');
    expect(res.candidates[0]?.emailMeta.sourceType).toBe('json_ld');
  });

  it('Fixture 6: JSON-LD ContactPoint & @graph extraction', () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@graph": [
                {
                  "@type": "LocalBusiness",
                  "name": "Acme Store",
                  "contactPoint": {
                    "@type": "ContactPoint",
                    "email": "sales@company.com",
                    "contactType": "customer service"
                  }
                }
              ]
            }
          </script>
        </head>
      </html>
    `;
    const res = extractCandidatesFromHtml(html, 'https://company.com', 'company.com');
    expect(res.candidates.length).toBe(1);
    expect(res.candidates[0]?.email).toBe('sales@company.com');
    expect(res.candidates[0]?.emailMeta.sourceType).toBe('json_ld');
  });

  it('Fixture 7: Malformed JSON-LD does not crash extraction', () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">
            { broken json: not real syntax ...
          </script>
        </head>
        <body>
          <a href="mailto:fallback@company.com">Contact</a>
        </body>
      </html>
    `;
    let res: any = null;
    expect(() => {
      res = extractCandidatesFromHtml(html, 'https://company.com', 'company.com');
    }).not.toThrow();
    expect(res.candidates.length).toBe(1);
    expect(res.candidates[0]?.email).toBe('fallback@company.com');
  });

  it('Fixture 8: Third-party email attribution separation', () => {
    const html = `
      <html>
        <body>
          <p>Contact the plumbers at <a href="mailto:info@acmeplumbing.com">info@acmeplumbing.com</a></p>
          <footer>Website created by <a href="mailto:support@pixelagency.com">Pixel Agency</a></footer>
        </body>
      </html>
    `;
    const res = extractCandidatesFromHtml(html, 'https://acmeplumbing.com', 'acmeplumbing.com');
    expect(res.candidates.length).toBe(1);
    expect(res.candidates[0]?.email).toBe('info@acmeplumbing.com');
    expect(res.thirdPartyCandidates.length).toBe(1);
    expect(res.thirdPartyCandidates[0]?.email).toBe('support@pixelagency.com');
    expect(res.thirdPartyCandidates[0]?.emailMeta.domainMatched).toBe(false);
  });

  it('Fixture 9: Role email naming behavior', () => {
    const html = `<p>Contact us: <a href="mailto:info@company.com">info@company.com</a></p>`;
    const res = extractCandidatesFromHtml(html, 'https://company.com', 'company.com');
    expect(res.candidates[0]?.email).toBe('info@company.com');
    expect(res.candidates[0]?.firstName).toBeNull();
    expect(res.candidates[0]?.lastName).toBeNull();
    expect(res.candidates[0]?.emailMeta.isRoleAccount).toBe(true);
  });

  it('Fixture 10: Personal email name inference', () => {
    const html = `<p>Lead Engineer: <a href="mailto:john.smith@company.com">Email John</a></p>`;
    const res = extractCandidatesFromHtml(html, 'https://company.com', 'company.com');
    expect(res.candidates[0]?.email).toBe('john.smith@company.com');
    expect(res.candidates[0]?.firstName).toBe('John');
    expect(res.candidates[0]?.lastName).toBe('Smith');
  });

  it('Fixture 11: Valid repeated mailbox preserved ("tomtom")', () => {
    const html = `<p>Navigation Systems: <a href="mailto:tomtom@company.com">tomtom@company.com</a></p>`;
    const res = extractCandidatesFromHtml(html, 'https://company.com', 'company.com');
    expect(res.candidates[0]?.email).toBe('tomtom@company.com');
  });

  it('Fixture 12: Parked / Landing template website signals', () => {
    const html = `
      <html>
        <head><title>This Domain is Parked | GoDaddy</title></head>
        <body>
          <h1>Buy this domain</h1>
          <p>Inquire about this domain: sales@acmeplumbing.com</p>
        </body>
      </html>
    `;
    const res = extractCandidatesFromHtml(html, 'https://acmeplumbing.com', 'acmeplumbing.com');
    expect(res.isParkedPage).toBe(true);
    expect(res.candidates[0]?.emailStatus).toBe(ContactEmailStatus.QUARANTINED);
  });

  it('Invariant D: Explicit sources outrank weaker sources', () => {
    const html = `
      <html>
        <body>
          <p>Visible text: info@company.com</p>
          <a href="mailto:info@company.com">Email Us</a>
        </body>
      </html>
    `;
    const res = extractCandidatesFromHtml(html, 'https://company.com', 'company.com');
    expect(res.candidates.length).toBe(1);
    expect(res.candidates[0]?.emailMeta.sourceType).toBe('mailto');
  });

  it('Invariant E: Idempotency across duplicate extractions', () => {
    const html = `<div><a href="mailto:ceo@company.com">CEO</a></div>`;
    const res1 = extractCandidatesFromHtml(html, 'https://company.com', 'company.com');
    const res2 = extractCandidatesFromHtml(html, 'https://company.com', 'company.com');
    expect(res1.candidates.length).toBe(res2.candidates.length);
    expect(res1.candidates[0]?.email).toBe(res2.candidates[0]?.email);
  });

  it('Invariant H: Source URL integrity preserved', () => {
    const targetUrl = 'https://company.com/team/leadership';
    const html = `<p><a href="mailto:sarah@company.com">Sarah</a></p>`;
    const res = extractCandidatesFromHtml(html, targetUrl, 'company.com');
    expect(res.candidates[0]?.emailMeta.sourceUrl).toBe(targetUrl);
  });
});

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { JobContext } from '../../../shared/types/job';
import { normalizeStateName, normalizeCountryName } from '../../../shared/utils/locations';
import { SdkClient } from '@leadforge/sdk';
import { generateEntityId, CompanyStatus, ContactStatus } from '@leadforge/schema';
import { resolveWorkerApiUrl } from '../worker-env';

/**
 * Resolves link shorteners and redirectors (e.g. t.co, bit.ly) to find the destination URL.
 */
async function resolveRedirect(urlStr: string): Promise<string> {
  const redirectors = ['t.co', 'bit.ly', 'tinyurl.com', 'linktr.ee', 'goo.gl', 'ow.ly'];
  try {
    const urlObj = new URL(urlStr);
    const hostname = urlObj.hostname.toLowerCase().replace(/^www\./, '');
    if (redirectors.includes(hostname)) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(urlStr, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      clearTimeout(timeout);
      return res.url;
    }
  } catch (err) {
    // Return original URL if redirect resolution fails
  }
  return urlStr;
}

/**
 * Extracts base domain (e.g. example.com) from a website URL.
 */
function extractDomain(urlStr: string): string | null {
  try {
    if (!urlStr) return null;
    const urlObj = new URL(urlStr);
    let hostname = urlObj.hostname.toLowerCase();
    if (hostname.startsWith('www.')) {
      hostname = hostname.substring(4);
    }
    return hostname;
  } catch {
    return null;
  }
}

/**
 * Extracts rating from the business details page.
 */
async function extractRating(page: Page): Promise<number | null> {
  try {
    const text = await page
      .locator('div.F7nice span[aria-hidden="true"]')
      .first()
      .innerText({ timeout: 2000 })
      .catch(() => null);
    if (text) {
      const val = parseFloat(text.replace(',', '.'));
      if (!isNaN(val)) return val;
    }
    const aria = await page
      .locator('[aria-label*="stars"]')
      .first()
      .getAttribute('aria-label', { timeout: 2000 })
      .catch(() => null);
    if (aria) {
      const match = aria.match(/([0-9.,]+)\s*stars/i);
      if (match && match[1]) {
        const val = parseFloat(match[1].replace(',', '.'));
        if (!isNaN(val)) return val;
      }
    }
  } catch {
    // Ignore rating errors
  }
  return null;
}

/**
 * Normalizes a raw Google Maps address string.
 */
function normalizeLocation(raw: string | null): string | null {
  if (!raw) return null;
  const parts = raw.split('\u00B7');
  let address = (parts[0] || raw).trim();
  address = address.replace(/\b(Closed|Open|Opens|Closes|24\s*hours?)\b.*$/i, '').trim();
  address = address.replace(/[^\p{L}\p{N}\s,\.\-\/()#&']/gu, '').trim();
  address = address.replace(/\s{2,}/g, ' ').trim();
  return address.length > 0 ? address : null;
}

/**
 * Normalizes telephone numbers by stripping visual separators.
 */
function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  let clean = raw.replace(/[\s\-\(\)\.]/g, '');
  if (/^\d{10}$/.test(clean)) {
    clean = `+1${clean}`;
  } else if (/^\d{11}$/.test(clean) && clean.startsWith('1')) {
    clean = `+${clean}`;
  } else if (/^[^\+]\d+$/.test(clean)) {
    clean = `+${clean}`;
  }
  return clean.length > 0 ? clean : null;
}

export type DiscoveryOutcome =
  | 'SUCCESS_WITH_RESULTS'
  | 'SUCCESS_ZERO_RESULTS'
  | 'BLOCKED'
  | 'CAPTCHA'
  | 'RATE_LIMITED'
  | 'PROVIDER_FAILURE'
  | 'EXTRACTION_FAILURE'
  | 'WORKER_FAILURE';

/**
 * Google Maps Scraper Job Plugin (Phase 7 - API/MongoDB-First).
 * Queries Google Maps listings using Playwright and persists directly via SdkClient.
 */
export async function scrapeMaps(ctx: JobContext): Promise<any> {
  const rawQuery = ctx.payload.query || '';
  const country = ctx.payload.country;
  const state = ctx.payload.state;
  const city = ctx.payload.city;
  const discoveryRunId = ctx.payload.discoveryRunId;

  const locParts = [city, state, country].filter(Boolean);
  let effectiveQuery = rawQuery;
  if (locParts.length > 0 && !rawQuery.toLowerCase().includes(locParts[0].toLowerCase())) {
    effectiveQuery = `${rawQuery} in ${locParts.join(', ')}`;
  }

  const maxResults =
    ctx.payload.maxResults !== undefined
      ? Number(ctx.payload.maxResults)
      : ctx.payload.limit !== undefined
        ? Number(ctx.payload.limit)
        : 100;

  ctx.emitLog(
    `Initializing Google Maps Playwright scraper. Query: "${effectiveQuery}" | Limit: ${maxResults}`,
    'info'
  );

  // Initialize SdkClient for authoritative API/MongoDB persistence
  const apiUrl = resolveWorkerApiUrl(ctx);
  const authToken = ctx.payload._secrets?.sessionToken || process.env.LEADFORGE_API_TOKEN || '';
  const sdk = new SdkClient({
    baseUrl: apiUrl,
    token: authToken,
    headers: {
      'x-workspace-id': ctx.workspaceId
    }
  });

  let collectedCount = 0;
  let storedCount = 0;
  let skippedCount = 0;
  let duplicatesCount = 0;
  let outcome: DiscoveryOutcome = 'WORKER_FAILURE';

  let browser: Browser | null = null;
  let browserCtx: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    ctx.updateProgress(5, { description: 'Launching browser engine...' });
    try {
      browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
      });
    } catch (launchErr: any) {
      if (launchErr?.message?.includes("Executable doesn't exist")) {
        throw new Error(
          `Playwright Chromium browser engine is not installed on this system (Path: ${process.env.PLAYWRIGHT_BROWSERS_PATH || 'default'}). Please check internet connectivity and restart HUNTARA to download required browser components.`
        );
      }
      throw launchErr;
    }

    browserCtx = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'en-US'
    });

    page = await browserCtx.newPage();

    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(effectiveQuery)}`;
    ctx.emitLog(`Navigating to Google Maps search: ${searchUrl}`, 'info');
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Check for bot detection, captcha, or IP block
    const pageUrl = page.url();
    const pageTitle = await page.title().catch(() => '');
    if (
      pageUrl.includes('/sorry/') ||
      pageTitle.toLowerCase().includes('unusual traffic') ||
      pageTitle.toLowerCase().includes('captcha')
    ) {
      outcome = 'CAPTCHA';
      ctx.emitLog(
        `Google Maps returned bot detection / CAPTCHA challenge. URL: ${pageUrl} | Title: "${pageTitle}"`,
        'error'
      );
      throw new Error(`Google Maps search blocked by bot detection/CAPTCHA challenge.`);
    }

    // Handle cookie / consent banners if present
    try {
      const consentBtn = page.locator('button[aria-label*="Accept all"], button[aria-label*="Agree"], form[action*="consent"] button').first();
      if (await consentBtn.isVisible({ timeout: 2500 })) {
        await consentBtn.click();
        await page.waitForTimeout(1000);
      }
    } catch {}

    // Multi-selector feed resolution with explicit SPA rendering readiness wait
    const feedSelectors = [
      'div[role="feed"]',
      'div.m6QErb[aria-label*="Results"]',
      'div[aria-label*="Results for"]',
      'div.m6QErb.DJAybe'
    ];

    const singleListingSelectors = [
      'h1.DUwDvf',
      'div.TIHn2 h1',
      'h1.fontHeadlineLarge'
    ];

    const zeroResultsSelectors = [
      'div:has-text("can\'t find")',
      'div:has-text("No results found")',
      'div:has-text("Google Maps can\'t find")'
    ];

    const combinedReadinessSelector = [
      ...feedSelectors,
      ...singleListingSelectors,
      ...zeroResultsSelectors
    ].join(', ');

    ctx.emitLog('Awaiting Google Maps SPA render readiness...', 'info');

    try {
      await page.locator(combinedReadinessSelector).first().waitFor({ state: 'visible', timeout: 15000 });
    } catch (waitErr: any) {
      const title = await page.title().catch(() => 'unknown');
      const currentUrl = page.url();
      ctx.emitLog(
        `Readiness timeout awaiting search results. Page Title: "${title}" | URL: ${currentUrl}`,
        'warn'
      );
    }

    let activeFeedSelector: string | null = null;
    for (const sel of feedSelectors) {
      const visible = await page.locator(sel).first().isVisible({ timeout: 2000 }).catch(() => false);
      if (visible) {
        activeFeedSelector = sel;
        break;
      }
    }

    if (!activeFeedSelector) {
      // Check if this navigated directly to a single business listing
      let hasSingleListingHeader = false;
      for (const sel of singleListingSelectors) {
        const visible = await page.locator(sel).first().isVisible({ timeout: 2000 }).catch(() => false);
        if (visible) {
          hasSingleListingHeader = true;
          break;
        }
      }

      if (hasSingleListingHeader) {
        ctx.emitLog('Direct single listing detected. Extracting business details.', 'info');
        await scrapeDetailsAndStore(page.url(), page, sdk, ctx);
        outcome = storedCount > 0 ? 'SUCCESS_WITH_RESULTS' : 'SUCCESS_ZERO_RESULTS';
      } else {
        // Check for explicit zero results indicators
        let zeroResultsFound = false;
        for (const sel of zeroResultsSelectors) {
          const visible = await page.locator(sel).first().isVisible({ timeout: 2000 }).catch(() => false);
          if (visible) {
            zeroResultsFound = true;
            break;
          }
        }

        if (zeroResultsFound) {
          outcome = 'SUCCESS_ZERO_RESULTS';
          ctx.emitLog(`Google Maps returned 0 results for query: "${effectiveQuery}"`, 'info');
        } else {
          outcome = 'EXTRACTION_FAILURE';
          const title = await page.title().catch(() => 'unknown');
          ctx.emitLog(
            `Extraction failure: Unable to locate result feed or listing details after SPA readiness wait. Page Title: "${title}" | URL: ${page.url()}`,
            'error'
          );
          throw new Error(`Google Maps feed extraction failure for query "${effectiveQuery}".`);
        }
      }
    } else {
      // Feed found: scroll and collect place URLs
      const feedLocator = page.locator(activeFeedSelector).first();
      const seenUrls = new Set<string>();
      let scrollAttempts = 0;
      const MAX_SCROLL_ATTEMPTS = 50;

      while (seenUrls.size < maxResults && scrollAttempts < MAX_SCROLL_ATTEMPTS) {
        if (ctx.isCancelled()) {
          ctx.emitLog('Scraper received cancellation signal. Terminating.', 'warn');
          break;
        }

        const anchors = await page.locator('a[href*="/maps/place/"]').all();
        for (const anchor of anchors) {
          if (seenUrls.size >= maxResults) break;
          const href = await anchor.getAttribute('href').catch(() => null);
          if (href && !seenUrls.has(href)) {
            seenUrls.add(href);
          }
        }

        collectedCount = seenUrls.size;
        ctx.updateProgress(Math.min(10 + Math.round((collectedCount / maxResults) * 40), 50), {
          description: `Collecting URLs: ${collectedCount} found`,
          current: collectedCount,
          total: maxResults
        });

        // Scroll feed down
        await feedLocator.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        }).catch(() => {});

        await page.waitForTimeout(1000);
        scrollAttempts++;
      }

      ctx.emitLog(`Found ${seenUrls.size} listings to scrape. Beginning detail extraction.`, 'info');

      if (seenUrls.size === 0) {
        outcome = 'SUCCESS_ZERO_RESULTS';
      } else {
        // Scrape detail pages
        const urlList = Array.from(seenUrls);
        for (let i = 0; i < urlList.length; i++) {
          if (ctx.isCancelled()) {
            ctx.emitLog('Scraper received cancellation signal during detail extraction.', 'warn');
            break;
          }

          const placeUrl = urlList[i];
          if (!placeUrl) continue;
          try {
            await scrapeDetailsAndStore(placeUrl, page, sdk, ctx);
          } catch (err: any) {
            ctx.emitLog(`Failed to extract listing details (${placeUrl}): ${err?.message || err}`, 'warn');
            skippedCount++;
          }

          const progressPercent = 50 + Math.round(((i + 1) / urlList.length) * 45);
          ctx.updateProgress(progressPercent, {
            description: `Extracting details (${i + 1}/${urlList.length})`,
            current: i + 1,
            total: urlList.length
          });

          ctx.saveCheckpoint({
            lastProcessedIndex: i,
            storedCount,
            duplicatesCount
          });
        }

        outcome = storedCount > 0 ? 'SUCCESS_WITH_RESULTS' : 'SUCCESS_ZERO_RESULTS';
      }
    }

    if (discoveryRunId) {
      try {
        await sdk.discovery.updateRun(discoveryRunId, {
          status: 'completed',
          resultCount: storedCount,
          finishedAt: new Date().toISOString()
        });
      } catch (updErr) {
        ctx.emitLog(`Failed to update discovery run status: ${updErr}`, 'warn');
      }
    }

    ctx.updateProgress(100, { description: `Scrape completed: ${storedCount} stored` });
    ctx.emitLog(
      `Google Maps scraper finished (${outcome}). Stored: ${storedCount} | Duplicates: ${duplicatesCount} | Skipped: ${skippedCount}`,
      'info'
    );
  } catch (err: any) {
    if (discoveryRunId) {
      try {
        await sdk.discovery.updateRun(discoveryRunId, {
          status: 'failed',
          error: err?.message || String(err),
          finishedAt: new Date().toISOString()
        });
      } catch {}
    }
    ctx.emitLog(`Google Maps scraper encountered fatal error (${outcome}): ${err?.message || err}`, 'error');
    throw err;
  } finally {
    if (page) await page.close().catch(() => {});
    if (browserCtx) await browserCtx.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }

  // Helper function to extract and persist company & contact directly via API/MongoDB
  async function scrapeDetailsAndStore(
    url: string,
    page: Page,
    sdk: SdkClient,
    ctx: JobContext
  ) {
    ctx.emitLog(`Opening listing details: ${url}`, 'info');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const name = (
      await page
        .locator('h1')
        .first()
        .innerText({ timeout: 5000 })
        .catch(() => '')
    ).trim();

    if (!name) {
      ctx.emitLog('Skipped listing: Failed to retrieve business name.', 'warn');
      return;
    }

    let website = await page
      .locator('a[data-item-id="authority"]')
      .first()
      .getAttribute('href', { timeout: 2000 })
      .catch(() => null);

    const rawPhone = await page
      .locator('[data-item-id^="phone:tel:"]')
      .first()
      .getAttribute('data-item-id', { timeout: 2000 })
      .then((id) => (id ? id.replace('phone:tel:', '').trim() : null))
      .catch(() => null);

    const phone = normalizePhone(rawPhone);
    const rawLocation = await page
      .locator('[data-item-id="address"]')
      .first()
      .innerText({ timeout: 2000 })
      .catch(() => null);

    const location = normalizeLocation(rawLocation);
    const rating = await extractRating(page);

    if (website) {
      website = await resolveRedirect(website);
    }

    const domain = website ? extractDomain(website) : null;

    let companyCity: string | null = null;
    let companyState: string | null = null;
    let companyCountry: string | null = null;

    if (location) {
      const tokens = location.split(',').map((t) => t.trim());
      if (tokens.length >= 2) {
        const lastToken = tokens[tokens.length - 1] || '';
        const secondLastToken = tokens[tokens.length - 2] || '';

        const detectedCountry = normalizeCountryName(lastToken);
        if (detectedCountry) {
          companyCountry = detectedCountry;
        }

        const stateZipMatch = secondLastToken.match(/^([A-Z]{2})\s*(\d{5})?/i);
        if (stateZipMatch && stateZipMatch[1]) {
          companyState = stateZipMatch[1].toUpperCase();
          if (tokens.length >= 3) {
            companyCity = tokens[tokens.length - 3] || null;
          }
        } else {
          const possibleRegion = normalizeStateName(secondLastToken, companyCountry || undefined);
          if (possibleRegion && possibleRegion !== secondLastToken) {
            companyState = possibleRegion;
            if (tokens.length >= 3) {
              companyCity = tokens[tokens.length - 3] || null;
            }
          } else {
            companyCity = secondLastToken;
          }
        }
      }
    }

    // Fall back to search parameters only if address did not supply them
    if (!companyCountry && country) companyCountry = normalizeCountryName(country);
    if (!companyState && state) companyState = normalizeStateName(state, companyCountry || undefined);
    if (!companyCity && city) companyCity = city;

    if (companyCountry) {
      companyCountry = normalizeCountryName(companyCountry);
    }
    if (companyState) {
      companyState = normalizeStateName(companyState, companyCountry || undefined);
    }

    // Persist company authoritatively via SdkClient -> API -> MongoDB
    const companyId = generateEntityId();
    const loc = [companyCity, companyState, companyCountry].filter(Boolean).join(', ') || location || undefined;
    const createdCompany = await sdk.companies.create({
      id: companyId,
      name,
      domain: domain || undefined,
      location: loc,
      city: companyCity || undefined,
      state: companyState || undefined,
      country: companyCountry || undefined,
      status: CompanyStatus.LEAD
    });

    storedCount++;
    ctx.emitLog(
      `Persisted company via API: "${name}" (${createdCompany.id}) | Domain: ${domain || 'N/A'} | Phone: ${phone || 'N/A'}`,
      'info'
    );

    // Auto-create primary contact if phone is available
    if (phone) {
      try {
        const contactId = generateEntityId();
        await sdk.contacts.create({
          id: contactId,
          companyId: createdCompany.id,
          firstName: name,
          phone,
          source: 'google_maps',
          status: ContactStatus.NEW
        });
      } catch (contactErr) {
        ctx.emitLog(`Failed to create contact for company ${createdCompany.id}: ${contactErr}`, 'warn');
      }
    }

    // Link discovery run if requested
    if (discoveryRunId) {
      try {
        await sdk.companyDiscoveryRuns.create({
          id: generateEntityId(),
          workspaceId: ctx.workspaceId,
          companyId: createdCompany.id,
          discoveryRunId
        });
      } catch {}
    }

    // Auto-chain website crawler job if website or domain is present
    if (website || domain) {
      try {
        const crawlUrl = website || `https://${domain}`;
        const crawlerJobId = generateEntityId();
        await sdk.jobs.create({
          id: crawlerJobId,
          type: 'crawler:website',
          priority: 2,
          payload: {
            companyId: createdCompany.id,
            website: crawlUrl,
            discoveryRunId: discoveryRunId || undefined,
            maxDepth: 2,
            maxPages: 10
          },
          maxRetries: 2
        });
        ctx.emitLog(`Auto-chained website crawler for "${name}" -> ${crawlUrl}`, 'info');
      } catch (crawlErr) {
        ctx.emitLog(`Failed to enqueue crawler job for ${createdCompany.id}: ${crawlErr}`, 'warn');
      }
    }
  }

  return { storedCount, skippedCount, duplicatesCount };
}

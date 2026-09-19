import * as cheerio from 'cheerio';
import robotsParser from 'robots-parser';
import pLimit from 'p-limit';
import type { JobContext } from '../../../shared/types/job';
import { SdkClient } from '@leadforge/sdk';
import { generateEntityId, ContactStatus, ContactEmailStatus, sanitizeAndValidateEmail } from '@leadforge/schema';
import { resolveWorkerApiUrl } from '../worker-env';
import { extractCandidatesFromHtml } from './crawler-extractor.js';

interface QueueItem {
  url: string;
  depth: number;
  priority: number;
}

/**
 * Normalizes raw extracted phone strings into canonical E.164 format.
 */
function normalizePhone(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return undefined;
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  if (trimmed.startsWith('+') && digits.length >= 7 && digits.length <= 15) {
    return `+${digits}`;
  }
  if (digits.length >= 7 && digits.length <= 15) {
    return `+${digits}`;
  }
  return undefined;
}

/**
 * Basic RFC 5322-compliant syntax validator with strict length boundaries.
 */
function validateEmailFormat(email: string): boolean {
  if (!email || email.length > 254) return false;
  const parts = email.split('@');
  if (parts.length !== 2) return false;
  const local = parts[0];
  const domain = parts[1];
  if (!local || !domain || local.length > 64 || domain.length > 255) return false;
  const emailRegex =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  return emailRegex.test(email);
}

/**
 * Filters out common non-human and bot noise emails.
 */
function isNoiseEmail(email: string): boolean {
  const lower = email.toLowerCase();
  const noisePatterns = [
    'noreply@',
    'no-reply@',
    'donotreply@',
    'support@',
    'help@',
    'privacy@',
    'abuse@',
    'postmaster@',
    'mailer-daemon@',
    'billing@',
    'feedback@',
    'unsubscribe@',
    'optout@',
    'notifications@',
    'alerts@',
    'newsletter@',
    'example.com',
    'domain.com',
    'yourdomain.',
    'sentry.io',
    'wixpress.com',
    'wordpress.com',
    'gravatar.com'
  ];

  if (noisePatterns.some((pattern) => lower.includes(pattern))) return true;

  const imageExtensions = /\.(png|jpg|jpeg|gif|webp|svg|css|js|woff|woff2)$/i;
  if (imageExtensions.test(lower)) return true;

  return false;
}

/**
 * Classifies an email as 'personal', 'generic', or 'role_based' and calculates confidence score.
 */
function classifyEmail(email: string): {
  type: 'personal' | 'generic' | 'role_based';
  confidence: number;
} {
  const lower = email.toLowerCase();
  const localPart = lower.split('@')[0] || '';

  const rolePrefixes = [
    'info',
    'sales',
    'marketing',
    'admin',
    'office',
    'team',
    'hello',
    'contact',
    'press',
    'media',
    'careers',
    'jobs',
    'hr',
    'legal'
  ];

  if (rolePrefixes.includes(localPart)) {
    return { type: 'role_based', confidence: 0.65 };
  }

  if (localPart.length <= 2 || /^\d+$/.test(localPart)) {
    return { type: 'generic', confidence: 0.4 };
  }

  if (/^[a-z]+[._-][a-z]+$/i.test(localPart)) {
    return { type: 'personal', confidence: 0.95 };
  }

  return { type: 'personal', confidence: 0.8 };
}

/**
 * Extracts candidate firstName and lastName from personal email addresses.
 */
function extractNameFromEmail(
  email: string,
  type: 'personal' | 'generic' | 'role_based'
): {
  firstName: string | null;
  lastName: string | null;
} {
  if (type !== 'personal') return { firstName: null, lastName: null };
  const localPart = email.split('@')[0] || '';
  const parts = localPart.split(/[._-]/).filter(Boolean);

  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

  if (parts.length >= 2 && parts[0] && parts[parts.length - 1]) {
    return {
      firstName: capitalize(parts[0]),
      lastName: capitalize(parts[parts.length - 1]!)
    };
  }

  if (parts.length === 1 && parts[0] && parts[0].length >= 3) {
    return {
      firstName: capitalize(parts[0]),
      lastName: null
    };
  }

  return { firstName: null, lastName: null };
}

/**
 * Scores link relevance for priority BFS crawling.
 */
function scoreUrlPriority(urlStr: string): number {
  const lower = urlStr.toLowerCase();
  if (
    lower.includes('/team') ||
    lower.includes('/leadership') ||
    lower.includes('/staff') ||
    lower.includes('/people')
  ) {
    return 10;
  }
  if (
    lower.includes('/about') ||
    lower.includes('/contact') ||
    lower.includes('/reach-us') ||
    lower.includes('/our-story')
  ) {
    return 8;
  }
  if (
    lower.includes('/management') ||
    lower.includes('/executives') ||
    lower.includes('/directors')
  ) {
    return 7;
  }
  if (lower.includes('/locations') || lower.includes('/offices')) {
    return 5;
  }
  return 1;
}

/**
 * Extracts and cleans internal HTTP/HTTPS links matching the website root origin.
 */
function extractInternalLinks(html: string, currentUrl: string, origin: string): string[] {
  const $ = cheerio.load(html);
  const links = new Set<string>();

  $('a[href]').each((_, el) => {
    const rawHref = $(el).attr('href');
    if (!rawHref) return;

    try {
      const resolved = new URL(rawHref, currentUrl);
      if (resolved.origin === origin && ['http:', 'https:'].includes(resolved.protocol)) {
        resolved.hash = '';
        resolved.search = '';
        const cleanUrl = resolved.toString().replace(/\/$/, '');
        links.add(cleanUrl);
      }
    } catch {
      // Ignore malformed links
    }
  });

  return Array.from(links);
}

/**
 * Website Crawler Plugin (Phase 7 - API/MongoDB-First).
 * Crawls domains using bounded concurrency and persists discovered contacts and metadata directly via SdkClient.
 */
export async function crawlWebsite(ctx: JobContext): Promise<any> {
  const companyId = ctx.payload.companyId as string;
  const website = String(ctx.payload.website || '');
  const maxDepth = ctx.payload.maxDepth !== undefined ? Number(ctx.payload.maxDepth) : 3;
  const maxPages = ctx.payload.maxPages !== undefined ? Number(ctx.payload.maxPages) : 50;

  ctx.emitLog(
    `Initializing Website Crawler plugin. Company: "${companyId}" | Target: ${website}`,
    'info'
  );

  if (!companyId || !website) {
    throw new Error('companyId and website payload parameters are required.');
  }

  let companyDomain: string | undefined;
  try {
    const parsed = new URL(website.includes('://') ? website : `https://${website}`);
    companyDomain = parsed.hostname.replace(/^www\./i, '');
  } catch {}

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

  const checkpoint = ctx.getCheckpoint();
  const visitedUrls = new Set<string>();
  let queue: QueueItem[] = [];
  let currentDepth = 0;
  let pagesCrawled = 0;
  const contactsFound = new Set<string>();
  let contactsExtracted = 0;
  let contactsPersisted = 0;
  let contactsRejected = 0;

  if (checkpoint) {
    checkpoint.visitedUrls?.forEach((u: string) => visitedUrls.add(u));
    queue = checkpoint.queue || [];
    currentDepth = checkpoint.currentDepth || 0;
    pagesCrawled = visitedUrls.size;
    ctx.emitLog(
      `Resuming crawler from checkpoint. Visited URLs: ${visitedUrls.size} | Queue depth: ${queue.length}`,
      'info'
    );
  } else {
    queue.push({ url: website, depth: 0, priority: 5 });
  }

  const origin = new URL(website).origin;
  const userAgent = 'HuntaraBot/1.0 (+https://huntara.com/bot)';
  let robots: any = null;

  try {
    // 1. Fetch robots.txt
    ctx.emitLog(`Checking robots.txt availability for: ${origin}`, 'info');
    try {
      const robotsUrl = `${origin}/robots.txt`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(robotsUrl, {
        headers: { 'User-Agent': userAgent },
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (res.ok) {
        const text = await res.text();
        robots = robotsParser(robotsUrl, text);
        ctx.emitLog('Successfully loaded and parsed robots.txt.', 'info');
      }
    } catch {
      ctx.emitLog('robots.txt unavailable or unreachable. Continuing with standard crawl.', 'warn');
    }

    // 2. Main Crawl Loop
    const limit = pLimit(3);

    while (queue.length > 0 && pagesCrawled < maxPages) {
      if (ctx.isCancelled()) {
        ctx.emitLog('Crawler received cancellation signal. Terminating.', 'warn');
        break;
      }

      if (ctx.isPaused()) {
        ctx.emitLog('Crawler received pause signal. Saving checkpoint.', 'warn');
        ctx.saveCheckpoint({
          visitedUrls: Array.from(visitedUrls),
          queue,
          currentDepth
        });
        throw new Error('Job paused.');
      }

      const batch: QueueItem[] = [];
      while (queue.length > 0 && batch.length < 3 && pagesCrawled + batch.length < maxPages) {
        const item = queue.shift()!;
        if (!visitedUrls.has(item.url)) {
          visitedUrls.add(item.url);
          batch.push(item);
        }
      }

      if (batch.length === 0) break;

      const tasks = batch.map((item) =>
        limit(async () => {
          if (robots && !robots.isAllowed(item.url, userAgent)) {
            ctx.emitLog(`Skipping disallowed URL per robots.txt: ${item.url}`, 'info');
            return;
          }

          try {
            ctx.emitLog(`Crawling [depth ${item.depth}]: ${item.url}`, 'info');
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);

            const res = await fetch(item.url, {
              headers: {
                'User-Agent': userAgent,
                Accept: 'text/html,application/xhtml+xml'
              },
              signal: controller.signal
            });
            clearTimeout(timeout);

            const contentType = res.headers.get('content-type') || '';
            if (!contentType.includes('text/html')) {
              return;
            }

            const html = await res.text();
            pagesCrawled++;

            // Save page crawl metadata via SdkClient/API
            try {
              await sdk.intelligence.createPageCrawl({
                id: generateEntityId(),
                companyId,
                url: item.url,
                contentHash: `${html.length}`
              });
            } catch {}

            // Extract contacts using evidence-preserving extractor
            const extraction = extractCandidatesFromHtml(html, item.url, companyDomain);
            if (extraction.isParkedPage) {
              ctx.emitLog(`Detected parked domain or landing template at "${item.url}": "${extraction.title}"`, 'warn');
            }

            // Extract phone numbers
            const $ = cheerio.load(html);
            const pagePhones = new Set<string>();
            $('a[href^="tel:"]').each((_, el) => {
              if (el) {
                const href = $(el).attr('href');
                if (href) {
                  const parts = href.replace(/^tel:/i, '').split('?');
                  const phonePart = parts[0];
                  if (phonePart) {
                    const phone = phonePart.trim();
                    if (phone) pagePhones.add(phone);
                  }
                }
              }
            });

            const bodyPhones = $('body').text().match(
              /(?:\+?(\d{1,3}))?[-. (]*(\d{3})[-. )]*(\d{3})[-. ]*(\d{4})\b/g
            );
            if (bodyPhones) {
              bodyPhones.forEach((p) => pagePhones.add(p.trim()));
            }

            const rawExtractedPhone = pagePhones.size > 0 ? Array.from(pagePhones)[0] : null;
            const normalizedPhone = normalizePhone(rawExtractedPhone);

            // Persist discovered company-affiliated contacts authoritatively via API/MongoDB
            for (const cand of extraction.candidates) {
              if (isNoiseEmail(cand.email)) continue;
              if (contactsFound.has(cand.email)) continue;
              contactsFound.add(cand.email);
              contactsExtracted++;

              try {
                const contactId = generateEntityId();
                await sdk.contacts.create({
                  id: contactId,
                  companyId,
                  firstName: cand.firstName || undefined,
                  lastName: cand.lastName || undefined,
                  email: cand.email,
                  emailStatus: cand.emailStatus,
                  emailMeta: cand.emailMeta,
                  phone: normalizedPhone,
                  status: ContactStatus.NEW,
                  source: 'web_crawler'
                });
                contactsPersisted++;
                ctx.emitLog(
                  `Persisted contact via API: ${cand.email} (${contactId}) [${cand.emailStatus}] source=${cand.emailMeta.sourceType} tier=${cand.emailMeta.confidenceTier}`,
                  'info'
                );
              } catch (contactErr) {
                contactsRejected++;
                ctx.emitLog(`Failed to persist contact ${cand.email}: ${contactErr}`, 'warn');
              }
            }

            // Log observed third-party external emails without assigning as company employees
            for (const tp of extraction.thirdPartyCandidates) {
              ctx.emitLog(
                `Observed external third-party email on ${item.url}: ${tp.email} (${tp.candidate.domain}) - excluded from company personnel`,
                'info'
              );
            }

            // Enqueue nested internal links if depth limit is not reached
            if (item.depth < maxDepth) {
              const rawLinks = extractInternalLinks(html, item.url, origin);
              for (const link of rawLinks) {
                if (!visitedUrls.has(link)) {
                  const prio = scoreUrlPriority(link);
                  queue.push({ url: link, depth: item.depth + 1, priority: prio });
                }
              }
              queue.sort((a, b) => b.priority - a.priority || a.depth - b.depth);
            }

            const progress = Math.round((pagesCrawled / maxPages) * 100);
            ctx.updateProgress(progress, {
              current: pagesCrawled,
              total: maxPages,
              entity: item.url,
              description: `Extracted ${contactsFound.size} contacts`
            });

            if (pagesCrawled % 5 === 0) {
              ctx.saveCheckpoint({
                visitedUrls: Array.from(visitedUrls),
                queue,
                currentDepth: item.depth
              });
              ctx.emitLog(`Autosaved checkpoint at count ${pagesCrawled}.`, 'info');
            }
          } catch (pageErr: any) {
            ctx.emitLog(
              `Failed to process crawl page ${item.url}: ${pageErr.message || pageErr}`,
              'error'
            );
          }
        })
      );

      await Promise.all(tasks);
    }

    let outcome = 'SUCCESS';
    if (contactsPersisted === 0 && contactsExtracted > 0) {
      outcome = 'FAILED';
    } else if (contactsRejected > 0) {
      outcome = 'PARTIAL_SUCCESS';
    }

    ctx.emitLog(
      `Crawl completed with outcome "${outcome}". Processed pages: ${pagesCrawled} | Contacts extracted: ${contactsExtracted} | Persisted: ${contactsPersisted} | Rejected: ${contactsRejected}`,
      outcome === 'FAILED' ? 'warn' : 'info'
    );

    return {
      status: 'completed',
      outcome,
      pagesCrawled,
      contactsExtracted,
      contactsPersisted,
      contactsRejected
    };
  } catch (err: any) {
    if (err.message !== 'Job paused.' && err.message !== 'Job cancelled.') {
      throw err;
    }
    throw err;
  }

  return { pagesCrawled, contactsFound: contactsFound.size };
}

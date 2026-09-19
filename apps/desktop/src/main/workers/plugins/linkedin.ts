import type { JobContext } from '../../../shared/types/job';
import { SdkClient } from '@huntara/sdk';
import { generateEntityId, ContactStatus } from '@huntara/schema';
import { resolveWorkerApiUrl } from '../worker-env';

interface LinkedInProfile {
  firstName: string;
  lastName: string;
  headline?: string;
  publicIdentifier: string;
  urn?: string;
}

/**
 * Validates the LinkedIn li_at cookie by performing a lightweight query.
 */
export async function validateLinkedInSession(
  cookie: string
): Promise<{ valid: boolean; csrfToken?: string; message?: string }> {
  try {
    const res = await fetch('https://www.linkedin.com/voyager/api/me', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Cookie: `li_at=${cookie}`
      }
    });

    if (res.status === 401 || res.status === 403) {
      return { valid: false, message: 'LinkedIn cookie has expired or is invalid.' };
    }

    const jsession = res.headers.get('set-cookie')?.match(/JSESSIONID="([^"]+)"/)?.[1];
    return {
      valid: res.ok,
      ...(jsession ? { csrfToken: `ajax:${jsession}` } : {})
    };
  } catch (err: any) {
    return { valid: false, message: err.message || 'Failed to connect to LinkedIn API.' };
  }
}

export const validateLinkedInCookie = validateLinkedInSession;

/**
 * Enriches executive profiles for a company using LinkedIn Voyager API.
 * (Phase 7 - API/MongoDB-First).
 */
export async function enrichLinkedIn(ctx: JobContext): Promise<any> {
  const companyId = ctx.payload.companyId;
  const companyName = ctx.payload.companyName || '';

  if (!companyId || !companyName) {
    throw new Error('companyId and companyName are required for LinkedIn enrichment.');
  }

  ctx.emitLog(
    `Initializing Executive LinkedIn Plugin for company "${companyName}" (${companyId})`,
    'info'
  );

  // Initialize SdkClient for authoritative API/MongoDB persistence
  const apiUrl = resolveWorkerApiUrl(ctx);
  const authToken = ctx.payload._secrets?.sessionToken || process.env.HUNTARA_API_TOKEN || process.env.LEADFORGE_API_TOKEN || '';
  const sdk = new SdkClient({
    baseUrl: apiUrl,
    token: authToken,
    headers: {
      'x-workspace-id': ctx.workspaceId
    }
  });

  // 1. Get stored LinkedIn cookie from payload secrets
  const cookie = ctx.payload._secrets?.['linkedin_li_at'] || process.env.LINKEDIN_LI_AT || '';

  if (!cookie) {
    ctx.emitLog(
      'No LinkedIn cookie (li_at) configured in Settings or secrets payload.',
      'error'
    );
    throw new Error(
      'LinkedIn cookie not configured. Please add your li_at cookie in Settings > Integrations.'
    );
  }

  const cleanCookie = cookie.trim().replace(/^li_at=/i, '');

  // 2. Validate session and extract CSRF token
  ctx.emitLog('Validating LinkedIn session credentials...', 'info');
  const authCheck = await validateLinkedInSession(cleanCookie);
  if (!authCheck.valid) {
    ctx.emitLog(`LinkedIn session invalid: ${authCheck.message}`, 'error');
    throw new Error(`LinkedIn session invalid: ${authCheck.message}`);
  }

  const csrfToken = authCheck.csrfToken || 'ajax:0000000000000000000';

  ctx.updateProgress(20, {
    step: 1,
    current: 1,
    total: 3,
    description: `Searching LinkedIn profiles for ${companyName}`
  });

  // 3. Search executive profiles
  const targetKeywords = ['CEO', 'Founder', 'Owner', 'President', 'Director', 'Managing Director'];
  const query = `(${targetKeywords.join(' OR ')}) AND "${companyName}"`;
  const searchUrl = `https://www.linkedin.com/voyager/api/graphql?variables=(start:0,origin:GLOBAL_SEARCH_HEADER,query:(keywords:${encodeURIComponent(
    query
  )},flagshipSearchIntent:SEARCH_SRP))&&queryId=voyagerSearchDashClusters.b092f6c1bb0ff36b95570dc2a8062089`;

  let profilesFound: LinkedInProfile[] = [];

  try {
    const searchRes = await fetch(searchUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Cookie: `li_at=${cleanCookie}; JSESSIONID="${csrfToken.replace('ajax:', '')}"`,
        'csrf-token': csrfToken,
        'x-restli-protocol-version': '2.0.0'
      }
    });

    if (searchRes.ok) {
      const data = await searchRes.json();
      const elements = data?.data?.searchDashClustersByAll?.elements || [];
      for (const el of elements) {
        const items = el?.items || [];
        for (const it of items) {
          const entity = it?.item?.entityResult;
          if (entity && entity.title?.text) {
            const fullName = entity.title.text;
            const nameParts = fullName.split(' ');
            const headline = entity.primarySubtitle?.text || '';
            const publicIdentifier =
              entity.navigationUrl?.split('/in/')?.[1]?.replace(/\/.*$/, '') ||
              entity.trackingUrn?.split(':')?.[3] ||
              '';

            if (publicIdentifier) {
              profilesFound.push({
                firstName: nameParts[0] || 'Executive',
                lastName: nameParts.slice(1).join(' ') || '',
                headline,
                publicIdentifier
              });
            }
          }
        }
      }
    }
  } catch (err: any) {
    ctx.emitLog(`Failed to query LinkedIn Voyager Search API: ${err.message || err}`, 'warn');
  }

  ctx.emitLog(`Found ${profilesFound.length} candidate executive profile(s).`, 'info');

  ctx.updateProgress(60, {
    step: 2,
    current: 2,
    total: 3,
    description: `Storing ${profilesFound.length} executive profiles`
  });

  // 4. Save discovered contacts via API
  let storedCount = 0;
  for (const prof of profilesFound) {
    if (ctx.isCancelled()) break;

    const linkedinUrl = prof.publicIdentifier.startsWith('http')
      ? prof.publicIdentifier
      : `https://www.linkedin.com/in/${prof.publicIdentifier}/`;

    try {
      const contactId = generateEntityId();
      await sdk.contacts.create({
        id: contactId,
        companyId,
        firstName: prof.firstName || 'Executive',
        lastName: prof.lastName || undefined,
        title: prof.headline || 'Decision Maker',
        linkedin: linkedinUrl,
        status: ContactStatus.NEW,
        source: 'linkedin',
        notes: prof.headline || undefined
      });

      storedCount++;
      ctx.emitLog(
        `Saved executive contact via API: ${prof.firstName} ${prof.lastName} (${contactId})`,
        'info'
      );
    } catch (err: any) {
      ctx.emitLog(`Failed to save contact via API: ${err.message || err}`, 'warn');
    }
  }

  ctx.updateProgress(100, {
    step: 3,
    current: 3,
    total: 3,
    description: `Enriched ${storedCount} executive contacts`
  });

  ctx.emitLog(
    `LinkedIn Executive Enrichment completed for "${companyName}". Found and saved: ${storedCount} decision makers.`,
    'info'
  );

  return { status: 'success', companyId, companyName, enrichedCount: storedCount };
}

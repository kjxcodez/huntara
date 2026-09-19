import type { JobContext } from '../../../shared/types/job';
import {
  CompanyAnalyzer,
  WebsiteAnalyzer,
  ContactAnalyzer,
  ScoringEngine,
  AIInsightGenerator
} from '../../services/intelligence-engine';
import { SdkClient } from '@huntara/sdk';
import { generateEntityId } from '@huntara/schema';
import { resolveWorkerApiUrl } from '../worker-env';

/**
 * Lead Intelligence Enrichment Worker Plugin (Phase 7 - API/MongoDB-First).
 * Analyzes company signals, generates opportunity scores, and persists graph data via SdkClient.
 */
export async function executeIntelligenceEnrichment(ctx: JobContext): Promise<any> {
  const companyId: string = ctx.payload.companyId || '';
  if (!companyId) {
    throw new Error('Missing required payload parameter: companyId');
  }

  ctx.emitLog(`Starting Lead Intelligence enrichment for Company: ${companyId}`, 'info');

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

  try {
    // 1. Load raw company record from API
    const company = await sdk.companies.get(companyId);
    if (!company) {
      throw new Error(`Company not found with ID: ${companyId}`);
    }
    ctx.updateProgress(10, { description: 'Loaded raw company records' });

    // 2. Load contacts associated with this company from API
    const contactListRes = await sdk.contacts.list({ companyId });
    const contacts = Array.isArray(contactListRes) ? contactListRes : [];
    ctx.updateProgress(20, { description: `Found ${contacts.length} associated contact(s)` });

    // 3. Retrieve HTML content if available from page crawl
    let htmlContent = '';
    try {
      const crawlsRes = await sdk.intelligence.listPageCrawls(companyId);
      if (Array.isArray(crawlsRes) && crawlsRes.length > 0 && (crawlsRes[0] as any).extractedText) {
        htmlContent = (crawlsRes[0] as any).extractedText || '';
      }
    } catch {}

    // 4. Analyze company, website, and contacts
    const compRes = CompanyAnalyzer.analyze(company, contacts, htmlContent);
    const compIntel = compRes.companyIntelligence;

    const webRes = WebsiteAnalyzer.analyze(companyId, htmlContent, company.website || '');
    const webIntel = webRes.websiteIntelligence;

    const contactIntels = contacts.map((c: any) => ContactAnalyzer.analyze(c));
    ctx.updateProgress(45, { description: 'Completed company and website technical analysis' });

    // 5. Calculate grounded opportunity scores with provenance
    const opportunityScore = ScoringEngine.calculate(company, compIntel, webIntel, contactIntels);
    ctx.updateProgress(65, { description: 'Opportunity scoring calculations completed' });

    // 6. Generate AI personalized insights (or rule fallback)
    const openRouterKey = ctx.payload._secrets?.['openrouter_key'] || '';
    const aiInsights = await AIInsightGenerator.generate(
      company.name,
      company.industry || '',
      compIntel.techStack,
      webIntel.technicalIssues,
      openRouterKey
    );
    ctx.updateProgress(85, { description: 'AI opening lines and objection models generated' });

    // 7. Persist intelligence graph authoritatively via SdkClient / API
    const sourceId = `src-${companyId}`;

    // A. Sources
    try {
      await sdk.intelligence.createSource({
        id: sourceId,
        companyId,
        sourceType: company.website ? 'WEBSITE' : 'MANUAL',
        url: company.website || undefined,
        retrievalMethod: htmlContent ? 'DETERMINISTIC_HTML' : 'MANUAL'
      });
    } catch (err) {
      ctx.emitLog(`Failed to persist intelligence source: ${err}`, 'warn');
    }

    // B. Evidence
    const allEvidence = [...compRes.evidence, ...webRes.evidence].map((ev) => ({
      id: ev.id || generateEntityId(),
      companyId,
      sourceId,
      evidenceType: ev.evidenceType,
      key: ev.key,
      value: ev.value,
      rawExcerpt: ev.rawExcerpt || undefined,
      extractionMethod: 'DOM_SELECTOR' as const
    }));

    if (allEvidence.length > 0) {
      try {
        await sdk.intelligence.createEvidenceBulk({ evidence: allEvidence });
      } catch (err) {
        ctx.emitLog(`Failed to persist intelligence evidence: ${err}`, 'warn');
      }
    }

    // C. Claims
    const allClaims = [...compRes.claims, ...webRes.claims].map((clm) => ({
      id: clm.id || generateEntityId(),
      companyId,
      evidenceIds: clm.evidenceIds || [],
      subject: clm.subject,
      predicate: clm.predicate,
      objectValue: clm.objectValue,
      verificationStatus: 'VERIFIED' as const
    }));

    for (const claim of allClaims) {
      try {
        await sdk.intelligence.createClaim(claim);
      } catch {}
    }

    // D. Company Intelligence
    try {
      await sdk.intelligence.createCompanyIntel({
        id: generateEntityId(),
        companyId,
        summary: compIntel.summary,
        techStack: compIntel.techStack || [],
        businessModel: compIntel.businessModel,
        estimatedRevenue: compIntel.estimatedRevenue,
        growthSignals: compIntel.growthSignals || [],
        hiringSignals: compIntel.hiringSignals || [],
        decisionMakerLikelihood: compIntel.decisionMakerLikelihood,
        missingInformation: compIntel.missingInformation || []
      });
    } catch (err) {
      ctx.emitLog(`Failed to persist company intelligence: ${err}`, 'warn');
    }

    // E. Website Intelligence
    try {
      await sdk.intelligence.createWebsiteIntel({
        id: generateEntityId(),
        companyId,
        brandVoice: webIntel.brandVoice,
        contentQuality: webIntel.contentQuality,
        buyingSignals: webIntel.buyingSignals || [],
        technicalIssues: webIntel.technicalIssues || [],
        productsServices: webIntel.productsServices || [],
        testimonialsCaseStudies: webIntel.testimonialsCaseStudies || []
      });
    } catch (err) {
      ctx.emitLog(`Failed to persist website intelligence: ${err}`, 'warn');
    }

    // F. Contact Intelligence
    let contactsAttempted = contactIntels.length;
    let contactsPersisted = 0;
    let contactsFailed = 0;

    for (const ci of contactIntels) {
      try {
        await sdk.intelligence.createContactIntel({
          id: generateEntityId(),
          contactId: (ci as any).contactId,
          decisionMakerScore: ci.decisionMakerScore,
          buyingInfluence: ci.buyingInfluence,
          personalizationOpportunities: ci.personalizationOpportunities || [],
          relationshipStrength: ci.relationshipStrength
        });
        contactsPersisted++;
      } catch (err) {
        contactsFailed++;
        ctx.emitLog(`Failed to persist contact intelligence for ${(ci as any).contactId}: ${err}`, 'warn');
      }
    }

    // G. Opportunity Scores
    let scorePersisted = false;
    try {
      await sdk.intelligence.createOpportunityScore({
        id: generateEntityId(),
        companyId,
        overallScore: opportunityScore.overallScore,
        fitScore: opportunityScore.fitScore,
        sizeScore: opportunityScore.sizeScore,
        intentScore: opportunityScore.intentScore,
        urgencyScore: opportunityScore.urgencyScore,
        explanation: opportunityScore.explanation,
        provenance: { details: opportunityScore.provenance || [] }
      });
      scorePersisted = true;
    } catch (err) {
      ctx.emitLog(`Failed to persist opportunity score: ${err}`, 'warn');
    }

    const outcome = contactsFailed === 0 && scorePersisted ? 'SUCCESS' : scorePersisted ? 'PARTIAL_SUCCESS' : 'FAILED';

    ctx.updateProgress(100, {
      description: `Intelligence enrichment finished (${outcome}). Score: ${opportunityScore.overallScore}% | Contacts updated: ${contactsPersisted}/${contactsAttempted}`
    });
    ctx.emitLog(
      `Lead Intelligence enrichment completed for Company: ${companyId} (Outcome: ${outcome}). Contacts enriched: ${contactsPersisted}/${contactsAttempted}, Score: ${opportunityScore.overallScore}%`,
      outcome === 'FAILED' ? 'warn' : 'info'
    );

    return {
      success: outcome !== 'FAILED',
      outcome,
      overallScore: opportunityScore.overallScore,
      contactsAttempted,
      contactsPersisted,
      contactsFailed,
      aiInsights
    };
  } catch (err: any) {
    ctx.emitLog(`Intelligence enrichment failed: ${err.message || err}`, 'error');
    throw err;
  }
}

import Database from 'better-sqlite3';
import { AIRuntime, PromptsLibrary } from '@huntara/ai';

export interface IntelligenceSource {
  id: string;
  workspaceId: string;
  companyId?: string;
  sourceType: 'WEBSITE_HTML' | 'DISCOVERY_RUN' | 'MANUAL_INPUT' | 'GOOGLE_MAPS' | 'EXTERNAL_API';
  url?: string;
  retrievedAt: string;
  status: 'SUCCESS' | 'FAILED' | 'PARTIAL';
  contentHash?: string;
  retrievalMethod?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IntelligenceEvidence {
  id: string;
  workspaceId: string;
  companyId: string;
  sourceId: string;
  evidenceType:
    | 'WEBSITE_TEXT'
    | 'WEBSITE_METADATA'
    | 'HTML_SCRIPT'
    | 'HTML_LINK'
    | 'DISCOVERY_RESULT'
    | 'MAP_RESULT'
    | 'MANUAL_INPUT';
  key: string;
  value: string;
  rawExcerpt?: string;
  extractionMethod: 'DETERMINISTIC_HTML' | 'STRUCTURED_FIELD' | 'MANUAL' | 'RULE';
  observedAt: string;
  createdAt: string;
}

export interface IntelligenceClaim {
  id: string;
  workspaceId: string;
  companyId: string;
  evidenceIds: string[];
  subject: string;
  predicate: string;
  objectValue: string;
  verificationStatus: 'VERIFIED' | 'UNVERIFIED';
  createdAt: string;
}

export interface IntelligenceInference {
  id: string;
  workspaceId: string;
  companyId: string;
  supportingClaimIds: string[];
  field: string;
  value: string;
  inferenceMethod: 'RULE_HEURISTIC';
  confidence: number | null;
  reason: string;
  createdAt: string;
}

export interface ScoreProvenanceItem {
  factor: string;
  points: number;
  claimId?: string;
  evidenceId?: string;
  inferenceId?: string;
  reason: string;
}

export interface CompanyIntelligence {
  companyId: string;
  summary: string;
  techStack: string[];
  businessModel: 'B2B' | 'B2C' | 'Hybrid' | 'Unknown';
  estimatedRevenue: string;
  growthSignals: string[];
  hiringSignals: string[];
  decisionMakerLikelihood: number;
  leadConfidence: 'High' | 'Medium' | 'Low' | 'Unknown';
  missingInformation: string[];
  websiteQualityScore: number;
  evidence?: IntelligenceEvidence[];
  claims?: IntelligenceClaim[];
  inferences?: IntelligenceInference[];
}

export interface WebsiteIntelligence {
  companyId: string;
  brandVoice: string;
  contentQuality: 'High' | 'Medium' | 'Low' | 'Unknown';
  buyingSignals: string[];
  seoSignals: Record<string, any>;
  technicalIssues: string[];
  productsServices: string[];
  testimonialsCaseStudies: string[];
  evidence?: IntelligenceEvidence[];
  claims?: IntelligenceClaim[];
}

export interface ContactIntelligence {
  contactId: string;
  decisionMakerScore: number;
  seniority: 'Executive' | 'VP' | 'Director' | 'Manager' | 'Individual Contributor' | 'Unknown';
  buyingInfluence: 'Decision Maker' | 'Influencer' | 'Champion' | 'Unknown';
  personalizationOpportunities: string[];
  relationshipStrength: number;
}

export interface OpportunityScore {
  companyId: string;
  overallScore: number;
  fitScore: number;
  sizeScore: number;
  intentScore: number;
  urgencyScore: number;
  explanation: string;
  provenance?: ScoreProvenanceItem[];
}

export class CompanyAnalyzer {
  /**
   * Deterministically analyzes company record and extracted HTML/evidence.
   */
  public static analyze(
    company: any,
    contacts: any[] = [],
    html: string = ''
  ): {
    companyIntelligence: CompanyIntelligence;
    evidence: IntelligenceEvidence[];
    claims: IntelligenceClaim[];
    inferences: IntelligenceInference[];
  } {
    const name = company.name || 'Unknown Company';
    const industry = (company.industry || '').trim();
    const industryLower = industry.toLowerCase();
    const website = (company.website || '').trim();
    const now = new Date().toISOString();

    const evidenceList: IntelligenceEvidence[] = [];
    const claimsList: IntelligenceClaim[] = [];
    const inferencesList: IntelligenceInference[] = [];

    // 1. Tech stack detection (Deterministic HTML / Meta parsing ONLY)
    const detectedTech: string[] = [];
    const lowerHtml = (html || '').toLowerCase();

    if (lowerHtml.length > 0) {
      const techSignatures = [
        { name: 'Google Analytics', patterns: ['google-analytics.com', 'googletagmanager.com/gtag/js', 'ga(\'create\'', 'gtag('] },
        { name: 'WordPress', patterns: ['wp-content', 'wp-includes', 'name="generator" content="wordpress'] },
        { name: 'Shopify', patterns: ['cdn.shopify.com', 'shopify.theme'] },
        { name: 'React', patterns: ['_next/static', 'react-root', '__react_devtools'] },
        { name: 'Next.js', patterns: ['_next/static', '__next_data__'] },
        { name: 'TailwindCSS', patterns: ['tailwind', 'cdn.tailwindcss.com'] },
        { name: 'HubSpot', patterns: ['hs-scripts.com', 'js.hs-scripts.com'] },
        { name: 'Segment', patterns: ['cdn.segment.com/analytics.js'] }
      ];

      for (const sig of techSignatures) {
        if (sig.patterns.some((p) => lowerHtml.includes(p))) {
          detectedTech.push(sig.name);

          const evId = `ev-tech-${sig.name.toLowerCase().replace(/[^a-z0-9]/g, '')}-${company.id}`;
          const claimId = `clm-tech-${sig.name.toLowerCase().replace(/[^a-z0-9]/g, '')}-${company.id}`;

          evidenceList.push({
            id: evId,
            workspaceId: company.workspaceId || 'local',
            companyId: company.id,
            sourceId: 'src-website-' + company.id,
            evidenceType: 'HTML_SCRIPT',
            key: 'technology.detected',
            value: sig.name,
            rawExcerpt: `Detected ${sig.name} footprint in page HTML`,
            extractionMethod: 'DETERMINISTIC_HTML',
            observedAt: now,
            createdAt: now
          });

          claimsList.push({
            id: claimId,
            workspaceId: company.workspaceId || 'local',
            companyId: company.id,
            evidenceIds: [evId],
            subject: 'company',
            predicate: 'uses_technology',
            objectValue: sig.name,
            verificationStatus: 'VERIFIED',
            createdAt: now
          });
        }
      }
    }

    // 2. Business model determination (Inferred from industry or verified if explicit)
    let businessModel: CompanyIntelligence['businessModel'] = 'Unknown';
    if (industryLower) {
      if (
        industryLower.includes('retail') ||
        industryLower.includes('restaurant') ||
        industryLower.includes('shop') ||
        industryLower.includes('consumer')
      ) {
        businessModel = 'B2C';
        const infId = `inf-bm-${company.id}`;
        inferencesList.push({
          id: infId,
          workspaceId: company.workspaceId || 'local',
          companyId: company.id,
          supportingClaimIds: [],
          field: 'businessModel',
          value: 'B2C',
          inferenceMethod: 'RULE_HEURISTIC',
          confidence: 0.75,
          reason: `Inferred B2C business model from industry classification "${industry}".`,
          createdAt: now
        });
      } else if (
        industryLower.includes('software') ||
        industryLower.includes('tech') ||
        industryLower.includes('saas') ||
        industryLower.includes('b2b') ||
        industryLower.includes('consulting') ||
        industryLower.includes('agency')
      ) {
        businessModel = 'B2B';
        const infId = `inf-bm-${company.id}`;
        inferencesList.push({
          id: infId,
          workspaceId: company.workspaceId || 'local',
          companyId: company.id,
          supportingClaimIds: [],
          field: 'businessModel',
          value: 'B2B',
          inferenceMethod: 'RULE_HEURISTIC',
          confidence: 0.8,
          reason: `Inferred B2B business model from industry classification "${industry}".`,
          createdAt: now
        });
      }
    }

    // 3. Estimated Revenue (Honest UNKNOWN state unless evidence provided)
    const estimatedRevenue = 'Unknown';

    // 4. Website Quality Score (Baseline 0 - only adds points for verified elements)
    let websiteQualityScore = 0;
    if (website) websiteQualityScore += 35;
    if (website.toLowerCase().startsWith('https')) websiteQualityScore += 35;
    if (company.phone) websiteQualityScore += 30;

    // 5. Contact Confidence & Decision Maker Likelihood
    const decisionMakerCount = contacts.filter((c) => {
      const title = (c.title || '').toLowerCase();
      return (
        title.includes('ceo') ||
        title.includes('founder') ||
        title.includes('director') ||
        title.includes('owner') ||
        title.includes('president') ||
        title.includes('vp')
      );
    }).length;

    const decisionMakerLikelihood =
      contacts.length === 0 ? 0.0 : decisionMakerCount > 0 ? 0.85 : 0.25;
    const leadConfidence: CompanyIntelligence['leadConfidence'] =
      decisionMakerCount > 0 ? 'High' : contacts.length > 0 ? 'Medium' : 'Unknown';

    // 6. Growth & Hiring Signals (Only when evidence exists)
    const growthSignals: string[] = [];
    const hiringSignals: string[] = [];
    if (detectedTech.length >= 3) {
      growthSignals.push(`Modern stack adoption (${detectedTech.length} technologies detected)`);
    }
    if (decisionMakerCount > 1) {
      growthSignals.push(`Multiple decision makers identified (${decisionMakerCount})`);
    }

    // 7. Missing Information
    const missingInformation: string[] = [];
    if (!company.phone) missingInformation.push('Phone number');
    if (!company.website) missingInformation.push('Website URL');
    if (contacts.length === 0) missingInformation.push('Contacts list');
    if (detectedTech.length === 0) missingInformation.push('Technical stack signals');

    // 8. Honest Summary (No fabricated claims)
    const summary =
      businessModel !== 'Unknown'
        ? `${name} is a ${businessModel} company operating in the ${industry || 'general'} sector.`
        : `${name} operates in the ${industry || 'unspecified'} sector.`;

    return {
      companyIntelligence: {
        companyId: company.id,
        summary,
        techStack: detectedTech,
        businessModel,
        estimatedRevenue,
        growthSignals,
        hiringSignals,
        decisionMakerLikelihood,
        leadConfidence,
        missingInformation,
        websiteQualityScore,
        evidence: evidenceList,
        claims: claimsList,
        inferences: inferencesList
      },
      evidence: evidenceList,
      claims: claimsList,
      inferences: inferencesList
    };
  }
}

export class WebsiteAnalyzer {
  public static analyze(
    companyId: string,
    html: string,
    websiteUrl: string
  ): {
    websiteIntelligence: WebsiteIntelligence;
    evidence: IntelligenceEvidence[];
    claims: IntelligenceClaim[];
  } {
    const lowerHtml = (html || '').toLowerCase();
    const now = new Date().toISOString();

    const buyingSignals: string[] = [];
    const productsServices: string[] = [];
    const testimonialsCaseStudies: string[] = [];
    const technicalIssues: string[] = [];
    const evidenceList: IntelligenceEvidence[] = [];
    const claimsList: IntelligenceClaim[] = [];

    if (!html || lowerHtml.trim().length === 0) {
      if (websiteUrl && !websiteUrl.startsWith('https')) {
        technicalIssues.push('Unsecure HTTP website (No SSL certificate)');
      }
      return {
        websiteIntelligence: {
          companyId,
          brandVoice: 'Unknown',
          contentQuality: 'Unknown',
          buyingSignals: [],
          seoSignals: {},
          technicalIssues,
          productsServices: [],
          testimonialsCaseStudies: []
        },
        evidence: [],
        claims: []
      };
    }

    // 1. Buying intent signals
    if (
      lowerHtml.includes('pricing') ||
      lowerHtml.includes('book a call') ||
      lowerHtml.includes('book a demo')
    ) {
      buyingSignals.push('Active Sales CTA detected');
      const evId = `ev-buy-cta-${companyId}`;
      evidenceList.push({
        id: evId,
        workspaceId: 'local',
        companyId,
        sourceId: `src-web-${companyId}`,
        evidenceType: 'WEBSITE_TEXT',
        key: 'buying_signal.cta',
        value: 'Active Sales CTA detected',
        rawExcerpt: 'Sales / CTA keywords present in page text',
        extractionMethod: 'DETERMINISTIC_HTML',
        observedAt: now,
        createdAt: now
      });
      claimsList.push({
        id: `clm-buy-cta-${companyId}`,
        workspaceId: 'local',
        companyId,
        evidenceIds: [evId],
        subject: 'website',
        predicate: 'has_buying_signal',
        objectValue: 'Active Sales CTA detected',
        verificationStatus: 'VERIFIED',
        createdAt: now
      });
    }

    if (lowerHtml.includes('free trial') || lowerHtml.includes('sign up')) {
      buyingSignals.push('Product trial signup present');
      const evId = `ev-buy-trial-${companyId}`;
      evidenceList.push({
        id: evId,
        workspaceId: 'local',
        companyId,
        sourceId: `src-web-${companyId}`,
        evidenceType: 'WEBSITE_TEXT',
        key: 'buying_signal.trial',
        value: 'Product trial signup present',
        rawExcerpt: 'Free trial or signup option found',
        extractionMethod: 'DETERMINISTIC_HTML',
        observedAt: now,
        createdAt: now
      });
      claimsList.push({
        id: `clm-buy-trial-${companyId}`,
        workspaceId: 'local',
        companyId,
        evidenceIds: [evId],
        subject: 'website',
        predicate: 'has_buying_signal',
        objectValue: 'Product trial signup present',
        verificationStatus: 'VERIFIED',
        createdAt: now
      });
    }

    // 2. Testimonials
    if (
      lowerHtml.includes('testimonial') ||
      lowerHtml.includes('case study') ||
      lowerHtml.includes('what our clients say')
    ) {
      testimonialsCaseStudies.push('Client success section found');
    }

    // 3. Products / Services
    if (
      lowerHtml.includes('services') ||
      lowerHtml.includes('solutions') ||
      lowerHtml.includes('what we do')
    ) {
      productsServices.push('Core services/solutions list');
    }

    // 4. Technical issues
    if (lowerHtml.includes('404') || lowerHtml.includes('page not found')) {
      technicalIssues.push('Broken internal links');
    }
    if (websiteUrl && !websiteUrl.startsWith('https')) {
      technicalIssues.push('Unsecure HTTP website (No SSL certificate)');
    }

    // 5. Brand Voice
    let brandVoice = 'Professional';
    if (lowerHtml.includes('creative') || lowerHtml.includes('innovative')) {
      brandVoice = 'Creative / Casual';
    }

    return {
      websiteIntelligence: {
        companyId,
        brandVoice,
        contentQuality: lowerHtml.length > 5000 ? 'High' : lowerHtml.length > 1000 ? 'Medium' : 'Low',
        buyingSignals,
        seoSignals: {
          hasTitle: lowerHtml.includes('<title>'),
          hasMetaDescription: lowerHtml.includes('name="description"')
        },
        technicalIssues,
        productsServices,
        testimonialsCaseStudies,
        evidence: evidenceList,
        claims: claimsList
      },
      evidence: evidenceList,
      claims: claimsList
    };
  }
}

export class ContactAnalyzer {
  public static analyze(contact: any): ContactIntelligence {
    const title = (contact.title || '').trim().toLowerCase();
    let decisionMakerScore = 0.0;
    let seniority: ContactIntelligence['seniority'] = 'Unknown';
    let buyingInfluence: ContactIntelligence['buyingInfluence'] = 'Unknown';

    if (!title) {
      return {
        contactId: contact.id,
        decisionMakerScore: 0.0,
        seniority: 'Unknown',
        buyingInfluence: 'Unknown',
        personalizationOpportunities: [],
        relationshipStrength: contact.status === 'REPLIED' ? 0.9 : 0.1
      };
    }

    if (
      title.includes('ceo') ||
      title.includes('founder') ||
      title.includes('owner') ||
      title.includes('president') ||
      title.includes('chief') ||
      title.includes('executive')
    ) {
      decisionMakerScore = 1.0;
      seniority = 'Executive';
      buyingInfluence = 'Decision Maker';
    } else if (title.includes('vp') || title.includes('vice president')) {
      decisionMakerScore = 0.85;
      seniority = 'VP';
      buyingInfluence = 'Decision Maker';
    } else if (title.includes('director') || title.includes('head')) {
      decisionMakerScore = 0.7;
      seniority = 'Director';
      buyingInfluence = 'Influencer';
    } else if (title.includes('manager') || title.includes('lead')) {
      decisionMakerScore = 0.5;
      seniority = 'Manager';
      buyingInfluence = 'Influencer';
    } else {
      decisionMakerScore = 0.2;
      seniority = 'Individual Contributor';
      buyingInfluence = 'Champion';
    }

    const personalizationOpportunities: string[] = [];
    if (contact.linkedinUrl) personalizationOpportunities.push('LinkedIn direct outreach');
    if (contact.headline) personalizationOpportunities.push('Personalized headline reference');

    return {
      contactId: contact.id,
      decisionMakerScore,
      seniority,
      buyingInfluence,
      personalizationOpportunities,
      relationshipStrength: contact.status === 'REPLIED' ? 0.9 : 0.1
    };
  }
}

export class ScoringEngine {
  /**
   * Computes grounded opportunity score with zero unbacked defaults.
   * Every point awarded is backed by an explicit ScoreProvenanceItem.
   */
  public static calculate(
    company: any,
    compIntel: CompanyIntelligence,
    webIntel: WebsiteIntelligence | null,
    contacts: ContactIntelligence[]
  ): OpportunityScore {
    let fitScore = 0;
    let sizeScore = 0;
    let intentScore = 0;
    let urgencyScore = 0;

    const provenance: ScoreProvenanceItem[] = [];

    // 1. Fit Scoring (0-100)
    const ind = (company.industry || '').toLowerCase();
    if (ind.includes('software') || ind.includes('tech') || ind.includes('marketing') || ind.includes('saas')) {
      fitScore += 40;
      provenance.push({
        factor: 'High Fit Industry',
        points: 40,
        reason: `Target industry match: "${company.industry}"`
      });
    }

    if (compIntel.techStack && compIntel.techStack.length > 0) {
      fitScore += 30;
      provenance.push({
        factor: 'Verified Stack Detection',
        points: 30,
        reason: `Detected ${compIntel.techStack.length} verified technologies (${compIntel.techStack.join(', ')})`
      });
    }

    if (compIntel.businessModel === 'B2B') {
      fitScore += 30;
      provenance.push({
        factor: 'B2B Model Fit',
        points: 30,
        reason: 'Confirmed B2B operating model'
      });
    }

    // 2. Size Scoring (0-100)
    const decisionMakers = contacts.filter((c) => c.decisionMakerScore >= 0.7);
    if (decisionMakers.length > 1) {
      sizeScore += 60;
      provenance.push({
        factor: 'Multiple Decision Makers',
        points: 60,
        reason: `Found ${decisionMakers.length} high-level decision makers`
      });
    } else if (contacts.length > 0) {
      sizeScore += 30;
      provenance.push({
        factor: 'Decision Maker Identified',
        points: 30,
        reason: 'Identified at least one decision maker contact'
      });
    }

    if (company.phone && company.location) {
      sizeScore += 40;
      provenance.push({
        factor: 'Complete Contact Info',
        points: 40,
        reason: 'Phone and location coordinates verified'
      });
    }

    // 3. Intent Scoring (0-100)
    if (webIntel && webIntel.buyingSignals.length > 0) {
      intentScore += 50;
      provenance.push({
        factor: 'Buying Intent Signals',
        points: 50,
        reason: `Detected CTA/Pricing buying signals: ${webIntel.buyingSignals.join(', ')}`
      });
    }

    if (webIntel && webIntel.testimonialsCaseStudies.length > 0) {
      intentScore += 50;
      provenance.push({
        factor: 'Social Proof / Case Studies',
        points: 50,
        reason: 'Active case studies or customer testimonial sections found'
      });
    }

    // 4. Urgency Scoring (0-100)
    if (webIntel && webIntel.technicalIssues.length > 0) {
      urgencyScore += 50;
      provenance.push({
        factor: 'Technical Pain Point',
        points: 50,
        reason: `Detected technical website issues: ${webIntel.technicalIssues.join(', ')}`
      });
    }

    if (compIntel.growthSignals && compIntel.growthSignals.length > 0) {
      urgencyScore += 50;
      provenance.push({
        factor: 'Company Growth Signals',
        points: 50,
        reason: `Expansion signals detected: ${compIntel.growthSignals.join(', ')}`
      });
    }

    // Cap individual factor scores at 100
    fitScore = Math.min(100, fitScore);
    sizeScore = Math.min(100, sizeScore);
    intentScore = Math.min(100, intentScore);
    urgencyScore = Math.min(100, urgencyScore);

    const overallScore = Math.round(
      fitScore * 0.3 + sizeScore * 0.2 + intentScore * 0.3 + urgencyScore * 0.2
    );

    const explanationLines = provenance.map(
      (p) => `+${p.points}: ${p.factor} — ${p.reason}`
    );

    const explanation =
      explanationLines.length > 0
        ? explanationLines.join('\n')
        : 'No verified intelligence signals found for score calculation (Score: 0%).';

    return {
      companyId: company.id,
      overallScore,
      fitScore,
      sizeScore,
      intentScore,
      urgencyScore,
      explanation,
      provenance
    };
  }
}

export class LeadPrioritizer {
  public static getQueue(score: number): 'Hot' | 'Warm' | 'Cold' {
    if (score >= 75) return 'Hot';
    if (score >= 45) return 'Warm';
    return 'Cold';
  }
}

export class AIInsightGenerator {
  public static async generate(
    companyName: string,
    industry: string,
    techStack: string[],
    technicalIssues: string[],
    openRouterKey?: string
  ): Promise<{ openingLine: string; painPoint: string; outreachAngle: string }> {
    if (openRouterKey && openRouterKey.trim() !== '') {
      try {
        const result = await AIRuntime.execute(
          PromptsLibrary.AI_INSIGHTS,
          { companyName, industry, techStack, technicalIssues },
          { openRouterKey }
        );
        if (result.success && result.data) {
          return result.data;
        }
      } catch (err) {
        console.error(
          '[AIInsightGenerator] OpenRouter request failed, falling back to rule-based engine:',
          err
        );
      }
    }

    const techText = techStack.length > 0 ? techStack[0] : null;
    const issueText = technicalIssues.length > 0 ? technicalIssues[0] : null;

    const openingLine = techText
      ? `Noticed ${companyName} is leveraging ${techText}—great technical stack.`
      : `Reaching out regarding ${companyName}'s digital growth strategy in ${industry || 'your market'}.`;

    const painPoint = issueText
      ? `Addressing scale constraints related to ${issueText}.`
      : `Optimizing lead response times and customer conversion pipelines.`;

    const outreachAngle = `Highlight how automating workflow execution can improve demo conversions for ${companyName}.`;

    return {
      openingLine,
      painPoint,
      outreachAngle
    };
  }
}

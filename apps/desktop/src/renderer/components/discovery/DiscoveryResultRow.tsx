import React, { memo, useMemo } from 'react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Mail, UserCheck, Phone, Sparkles, Linkedin } from 'lucide-react';

export interface DiscoveryResultRowProps {
  company: any;
  companyContacts: any[];
  onCrawl: (companyId: string, website: string) => void;
  onExecs: (companyId: string, companyName: string, domain?: string | undefined) => void;
  isCrawlPending?: boolean | undefined;
  isExecsPending?: boolean | undefined;
}

export const DiscoveryResultRow = memo(function DiscoveryResultRow({
  company,
  companyContacts,
  onCrawl,
  onExecs,
  isCrawlPending,
  isExecsPending
}: DiscoveryResultRowProps) {
  const { emailContacts, execContacts, primaryEmail } = useMemo(() => {
    const emails = companyContacts.filter((ct: any) => ct.email);
    const execs = companyContacts.filter(
      (ct: any) => ct.type === 'executive' || ct.source === 'linkedin' || !!ct.linkedinUrl
    );
    return {
      emailContacts: emails,
      execContacts: execs,
      primaryEmail: emails[0]?.email
    };
  }, [companyContacts]);

  return (
    <tr className="hover:bg-surface-3/45 transition-colors">
      <td className="px-4 py-3">
        <div className="font-semibold text-foreground leading-snug">{company.name}</div>
        {company.rating != null && (
          <span className="text-[9px] text-warning font-mono">★ {company.rating}</span>
        )}
      </td>
      <td className="px-4 py-3 max-w-[160px]">
        {company.website ? (
          <a
            href={company.website}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-primary hover:underline truncate block text-[10px]"
          >
            {company.domain || company.website}
          </a>
        ) : (
          <span className="opacity-40">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-muted-foreground font-mono whitespace-nowrap">
        {company.phone || <span className="opacity-40">—</span>}
      </td>
      <td className="px-4 py-3 text-muted-foreground max-w-[180px]">
        <span className="truncate block">{company.location || <span className="opacity-40">—</span>}</span>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1 items-start">
          {emailContacts.length > 0 && (
            <Badge
              variant="outline"
              className="bg-info-muted text-info border border-info/20 font-bold text-[9px] rounded-none"
            >
              <Mail className="w-2.5 h-2.5 mr-1" />
              {emailContacts.length} email{emailContacts.length > 1 ? 's' : ''} · {primaryEmail}
            </Badge>
          )}
          {execContacts.length > 0 && (
            <Badge
              variant="outline"
              className="bg-primary/10 text-primary border border-primary/20 font-bold text-[9px] rounded-none"
            >
              <UserCheck className="w-2.5 h-2.5 mr-1" />
              {execContacts.length} Exec{execContacts.length > 1 ? 's' : ''} (
              {execContacts[0].firstName} {execContacts[0].lastName || ''})
            </Badge>
          )}
          {emailContacts.length === 0 && execContacts.length === 0 && companyContacts.length > 0 && (
            <Badge
              variant="outline"
              className="bg-success-muted text-success border border-success/20 font-bold text-[9px] rounded-none"
            >
              <Phone className="w-2.5 h-2.5 mr-1" />
              Phone saved
            </Badge>
          )}
          {companyContacts.length === 0 && (
            <span className="opacity-40 text-[10px]">No contacts found</span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex justify-end gap-1.5">
          {company.website && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onCrawl(company.id, company.website)}
              disabled={isCrawlPending}
              title="Crawl website for email addresses"
              className="h-6 text-[10px] gap-1 font-semibold border-primary/20 text-primary hover:bg-primary/10 rounded-none"
            >
              <Sparkles className="w-3 h-3" />
              Crawl
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onExecs(company.id, company.name, company.domain)}
            disabled={isExecsPending}
            title="Scrape executive decision makers"
            className="h-6 text-[10px] gap-1 font-semibold border-info/20 text-info hover:bg-info/10 rounded-none"
          >
            <Linkedin className="w-3 h-3" />
            Execs
          </Button>
        </div>
      </td>
    </tr>
  );
});

import React from 'react';
import { Badge } from '../ui/badge';
import { ShieldCheck, ShieldAlert, ShieldX, AlertTriangle, Mail, Ban, CheckCircle2 } from 'lucide-react';
import { EmailQualityStatus } from '@huntara/schema';

export interface EmailQualityBadgeProps {
  status?: string | null | undefined;
  riskLevel?: 'low' | 'moderate' | 'high' | 'prohibited' | null | undefined;
  size?: 'sm' | 'md';
  className?: string;
}

export const EmailQualityBadge: React.FC<EmailQualityBadgeProps> = ({
  status,
  riskLevel,
  size = 'md',
  className = ''
}) => {
  const normStatus = String(status || 'UNVERIFIED').toUpperCase();

  const sizeClasses = size === 'sm' ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-0.5';

  switch (normStatus) {
    case EmailQualityStatus.VERIFIED:
    case 'VERIFIED':
      return (
        <Badge
          variant="outline"
          className={`bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 font-mono font-medium rounded-none inline-flex items-center gap-1 ${sizeClasses} ${className}`}
        >
          <CheckCircle2 className="w-2.5 h-2.5" />
          <span>Verified Mailbox</span>
        </Badge>
      );

    case EmailQualityStatus.MX_VALID:
    case 'MX_VALID':
      return (
        <Badge
          variant="outline"
          className={`bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 font-mono font-medium rounded-none inline-flex items-center gap-1 ${sizeClasses} ${className}`}
        >
          <ShieldCheck className="w-2.5 h-2.5" />
          <span>MX Valid</span>
        </Badge>
      );

    case EmailQualityStatus.ROLE_ACCOUNT:
    case 'ROLE_ACCOUNT':
      return (
        <Badge
          variant="outline"
          className={`bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 font-mono font-medium rounded-none inline-flex items-center gap-1 ${sizeClasses} ${className}`}
        >
          <Mail className="w-2.5 h-2.5" />
          <span>Role Account</span>
        </Badge>
      );

    case EmailQualityStatus.DISPOSABLE:
    case 'DISPOSABLE':
      return (
        <Badge
          variant="outline"
          className={`bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20 font-mono font-bold rounded-none inline-flex items-center gap-1 ${sizeClasses} ${className}`}
        >
          <ShieldX className="w-2.5 h-2.5" />
          <span>Disposable Domain</span>
        </Badge>
      );

    case EmailQualityStatus.SUPPRESSED:
    case 'SUPPRESSED':
      return (
        <Badge
          variant="outline"
          className={`bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20 font-mono font-bold rounded-none inline-flex items-center gap-1 ${sizeClasses} ${className}`}
        >
          <Ban className="w-2.5 h-2.5" />
          <span>Suppressed</span>
        </Badge>
      );

    case EmailQualityStatus.RISKY:
    case 'RISKY':
      return (
        <Badge
          variant="outline"
          className={`bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20 font-mono font-medium rounded-none inline-flex items-center gap-1 ${sizeClasses} ${className}`}
        >
          <AlertTriangle className="w-2.5 h-2.5" />
          <span>Risky</span>
        </Badge>
      );

    case EmailQualityStatus.INVALID:
    case 'INVALID':
      return (
        <Badge
          variant="outline"
          className={`bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20 font-mono font-bold rounded-none inline-flex items-center gap-1 ${sizeClasses} ${className}`}
        >
          <ShieldAlert className="w-2.5 h-2.5" />
          <span>Invalid Email</span>
        </Badge>
      );

    case EmailQualityStatus.SYNTAX_VALID:
    case 'SYNTAX_VALID':
      return (
        <Badge
          variant="outline"
          className={`bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20 font-mono font-medium rounded-none inline-flex items-center gap-1 ${sizeClasses} ${className}`}
        >
          <ShieldCheck className="w-2.5 h-2.5 opacity-70" />
          <span>Syntax Valid</span>
        </Badge>
      );

    default:
      return (
        <Badge
          variant="outline"
          className={`bg-muted/40 text-muted-foreground border-border-subtle font-mono text-[9px] rounded-none inline-flex items-center gap-1 ${sizeClasses} ${className}`}
        >
          <span>Unverified</span>
        </Badge>
      );
  }
};

import React, { memo } from 'react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { EmailQualityBadge } from '../email/EmailQualityBadge';

export interface ContactTableRowProps {
  contact: any;
  rowSelected: boolean;
  isPanelSelected: boolean;
  companyName?: string | undefined;
  onToggleSelect: (id: string) => void;
  onSelectRow: (contact: any) => void;
  onEdit: (contact: any) => void;
  onDelete: (id: string) => void;
}

export const ContactTableRow = memo(function ContactTableRow({
  contact,
  rowSelected,
  isPanelSelected,
  companyName,
  onToggleSelect,
  onSelectRow,
  onEdit,
  onDelete
}: ContactTableRowProps) {
  const statusBadgeClass =
    contact.status === 'REPLIED'
      ? 'bg-success-muted text-success border-success/20'
      : contact.status === 'CONTACTED'
      ? 'bg-info-muted text-info border-info/20'
      : contact.status === 'BOUNCED'
      ? 'bg-danger-muted text-danger border-danger/20'
      : 'bg-muted-muted text-muted-foreground border-border-subtle';

  const emailQualityStatus =
    contact.emailQuality?.status || (contact.status === 'BOUNCED' ? 'INVALID' : contact.emailStatus);

  const fullName = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || '—';

  return (
    <tr
      onClick={() => onSelectRow(contact)}
      className={`h-[52px] max-h-[52px] border-b border-border-subtle/50 hover:bg-surface-3/45 cursor-pointer transition-colors ${
        isPanelSelected ? 'bg-primary/12' : ''
      }`}
    >
      <td className="px-4 py-2.5 w-10 text-center" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={rowSelected}
          onChange={() => onToggleSelect(contact.id)}
          className="rounded-none border-border-subtle text-primary focus:ring-ring"
        />
      </td>
      <td className="px-4 py-2.5 font-semibold text-foreground truncate max-w-0" title={fullName}>
        <span className="truncate block">{fullName}</span>
      </td>
      <td className="px-4 py-2.5 text-muted-foreground truncate max-w-0" title={companyName || undefined}>
        <span className="truncate block">{companyName || <span className="opacity-40">—</span>}</span>
      </td>
      <td className="px-4 py-2.5 font-mono text-primary truncate max-w-0" title={contact.email || undefined}>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="truncate">{contact.email || '—'}</span>
          {contact.email && <EmailQualityBadge status={emailQualityStatus} size="sm" className="shrink-0" />}
        </div>
      </td>
      <td className="px-4 py-2.5 text-muted-foreground font-mono truncate max-w-0" title={contact.phone || undefined}>
        <span className="truncate block">{contact.phone || '—'}</span>
      </td>
      <td className="px-4 py-2.5 text-muted-foreground truncate max-w-0" title={contact.title || undefined}>
        <span className="truncate block">{contact.title || '—'}</span>
      </td>
      <td className="px-4 py-2.5 whitespace-nowrap">
        <Badge variant="outline" className={`text-[9px] font-bold rounded-none shrink-0 ${statusBadgeClass}`}>
          {contact.status}
        </Badge>
      </td>
      <td className="px-4 py-2.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEdit(contact)}
            className="h-7 text-[10px] rounded-none hover:bg-surface-3 px-2"
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(contact.id)}
            className="h-7 text-[10px] text-danger hover:bg-danger-muted hover:text-danger rounded-none px-2"
          >
            Delete
          </Button>
        </div>
      </td>
    </tr>
  );
});

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

  return (
    <tr
      onClick={() => onSelectRow(contact)}
      className={`hover:bg-surface-3/45 cursor-pointer transition-colors ${
        isPanelSelected ? 'bg-primary/12' : ''
      }`}
    >
      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={rowSelected}
          onChange={() => onToggleSelect(contact.id)}
          className="rounded-none border-border-subtle text-primary focus:ring-ring"
        />
      </td>
      <td className="px-4 py-3 font-semibold text-foreground">
        {contact.firstName} {contact.lastName || ''}
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {companyName || <span className="opacity-40">—</span>}
      </td>
      <td className="px-4 py-3 font-mono text-primary">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span>{contact.email || '—'}</span>
          {contact.email && <EmailQualityBadge status={emailQualityStatus} size="sm" />}
        </div>
      </td>
      <td className="px-4 py-3 text-muted-foreground font-mono">{contact.phone || '—'}</td>
      <td className="px-4 py-3 text-muted-foreground">{contact.title || '—'}</td>
      <td className="px-4 py-3">
        <Badge variant="outline" className={`text-[9px] font-bold rounded-none ${statusBadgeClass}`}>
          {contact.status}
        </Badge>
      </td>
      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onEdit(contact)}
          className="h-7 text-[10px] rounded-none hover:bg-surface-3"
        >
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDelete(contact.id)}
          className="h-7 text-[10px] text-danger hover:bg-danger-muted hover:text-danger rounded-none"
        >
          Delete
        </Button>
      </td>
    </tr>
  );
});

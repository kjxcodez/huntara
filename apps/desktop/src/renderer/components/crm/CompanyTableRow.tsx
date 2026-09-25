import React, { memo } from 'react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';

export interface CompanyTableRowProps {
  company: any;
  isSelected: boolean;
  isPanelSelected: boolean;
  onToggleSelect: (id: string) => void;
  onSelectCompany: (company: any) => void;
  onEdit: (company: any) => void;
  onDelete: (id: string) => void;
}

export const CompanyTableRow = memo(function CompanyTableRow({
  company,
  isSelected,
  isPanelSelected,
  onToggleSelect,
  onSelectCompany,
  onEdit,
  onDelete
}: CompanyTableRowProps) {
  const statusBadgeClass =
    company.status === 'CUSTOMER'
      ? 'bg-success-muted text-success border-success/20'
      : company.status === 'QUALIFIED'
      ? 'bg-info-muted text-info border-info/20'
      : 'bg-muted-muted text-muted-foreground border-border-subtle';

  return (
    <tr
      onClick={() => onSelectCompany(company)}
      className={`h-[52px] max-h-[52px] border-b border-border-subtle/50 hover:bg-surface-3/45 cursor-pointer transition-colors ${
        isPanelSelected ? 'bg-primary/12' : ''
      }`}
    >
      <td className="px-4 py-2.5 w-10 text-center" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(company.id)}
          className="rounded-none border-border-subtle text-primary focus:ring-ring"
        />
      </td>
      <td className="px-4 py-2.5 font-semibold text-foreground truncate max-w-0" title={company.name}>
        <span className="truncate block">{company.name}</span>
      </td>
      <td className="px-4 py-2.5 font-mono text-primary truncate max-w-0" title={company.domain || undefined}>
        <span className="truncate block">{company.domain || 'N/A'}</span>
      </td>
      <td className="px-4 py-2.5 text-muted-foreground truncate max-w-0" title={company.industry || undefined}>
        <span className="truncate block">{company.industry || 'N/A'}</span>
      </td>
      <td className="px-4 py-2.5 text-muted-foreground truncate max-w-0" title={company.size || undefined}>
        <span className="truncate block">{company.size || 'N/A'}</span>
      </td>
      <td className="px-4 py-2.5 whitespace-nowrap">
        <Badge variant="outline" className={`text-[9px] font-bold rounded-none shrink-0 ${statusBadgeClass}`}>
          {company.status}
        </Badge>
      </td>
      <td className="px-4 py-2.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEdit(company)}
            className="h-7 text-[10px] rounded-none hover:bg-surface-3 px-2"
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(company.id)}
            className="h-7 text-[10px] text-danger hover:bg-danger-muted hover:text-danger rounded-none px-2"
          >
            Delete
          </Button>
        </div>
      </td>
    </tr>
  );
});

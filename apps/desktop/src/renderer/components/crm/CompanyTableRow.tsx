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
      className={`hover:bg-surface-3/45 cursor-pointer transition-colors ${
        isPanelSelected ? 'bg-primary/12' : ''
      }`}
    >
      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(company.id)}
          className="rounded-none border-border-subtle text-primary focus:ring-ring"
        />
      </td>
      <td className="px-4 py-3 font-semibold text-foreground">{company.name}</td>
      <td className="px-4 py-3 font-mono text-primary">{company.domain || 'N/A'}</td>
      <td className="px-4 py-3 text-muted-foreground">{company.industry || 'N/A'}</td>
      <td className="px-4 py-3 text-muted-foreground">{company.size || 'N/A'}</td>
      <td className="px-4 py-3">
        <Badge variant="outline" className={`text-[9px] font-bold rounded-none ${statusBadgeClass}`}>
          {company.status}
        </Badge>
      </td>
      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onEdit(company)}
          className="h-7 text-[10px] rounded-none hover:bg-surface-3"
        >
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDelete(company.id)}
          className="h-7 text-[10px] text-danger hover:bg-danger-muted hover:text-danger rounded-none"
        >
          Delete
        </Button>
      </td>
    </tr>
  );
});

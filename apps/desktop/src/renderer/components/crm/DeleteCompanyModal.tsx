import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { AlertTriangle, Building2, Shield, History, Radio } from 'lucide-react';
import type { DeleteCompanyMode } from '@leadforge/schema';

interface DeleteCompanyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company?: {
    id: string;
    name: string;
    domain?: string | null;
  } | null;
  bulkCount?: number;
  onConfirm: (mode: DeleteCompanyMode) => Promise<void>;
  isLoading?: boolean;
}

export function DeleteCompanyModal({
  open,
  onOpenChange,
  company,
  bulkCount = 1,
  onConfirm,
  isLoading = false
}: DeleteCompanyModalProps) {
  const [mode, setMode] = useState<DeleteCompanyMode>('company-only');
  const isBulk = bulkCount > 1;

  const handleConfirm = async () => {
    await onConfirm(mode);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] border-border-subtle bg-surface-1 p-6">
        <DialogHeader className="space-y-2">
          <div className="flex items-center gap-2 text-destructive font-mono text-xs uppercase tracking-wider">
            <AlertTriangle className="w-4 h-4" />
            <span>Forensic Deletion Protocol</span>
          </div>
          <DialogTitle className="text-base font-semibold text-foreground">
            {isBulk
              ? `Delete ${bulkCount} Companies`
              : `Delete Company: ${company?.name || 'Company'}`}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {isBulk ? (
              <span>
                You are preparing to delete <strong className="text-foreground">{bulkCount} companies</strong>. Choose whether to remove only the companies or also purge eligible uncontacted contacts.
              </span>
            ) : (
              <span>
                Target Organization:{' '}
                <strong className="text-foreground">{company?.name}</strong>
                {company?.domain ? ` (${company.domain})` : ''}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Deletion Mode Selector */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-foreground">
              Choose Deletion Scope:
            </Label>
            <div className="space-y-2">
              <label
                onClick={() => setMode('company-only')}
                className={`flex items-start gap-3 p-3 border rounded-none cursor-pointer transition-colors ${
                  mode === 'company-only'
                    ? 'border-primary/60 bg-surface-3'
                    : 'border-border-subtle bg-surface-2 hover:bg-surface-3/50'
                }`}
              >
                <input
                  type="radio"
                  name="deletion-mode"
                  checked={mode === 'company-only'}
                  onChange={() => setMode('company-only')}
                  className="mt-0.5 text-primary focus:ring-primary h-3.5 w-3.5"
                />
                <div className="space-y-1">
                  <div className="text-xs font-medium text-foreground flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-primary" />
                    <span>Remove company only</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Tombstones the company while preserving 100% of its associated contacts, campaigns, and outreach sequences.
                  </p>
                </div>
              </label>

              <label
                onClick={() => setMode('company-and-eligible-contacts')}
                className={`flex items-start gap-3 p-3 border rounded-none cursor-pointer transition-colors ${
                  mode === 'company-and-eligible-contacts'
                    ? 'border-primary/60 bg-surface-3'
                    : 'border-border-subtle bg-surface-2 hover:bg-surface-3/50'
                }`}
              >
                <input
                  type="radio"
                  name="deletion-mode"
                  checked={mode === 'company-and-eligible-contacts'}
                  onChange={() => setMode('company-and-eligible-contacts')}
                  className="mt-0.5 text-primary focus:ring-primary h-3.5 w-3.5"
                />
                <div className="space-y-1">
                  <div className="text-xs font-medium text-foreground flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 text-warning-text" />
                    <span>Remove company + eligible contacts</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Removes the company and purges <strong>fresh, uncontacted contacts</strong> only. Contacts with active outreach or email deliveries will be preserved.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Forensic Invariant Guarantees */}
          <div className="p-3 bg-surface-3/60 border border-border-subtle rounded-none space-y-2 text-[11px]">
            <span className="font-semibold text-foreground block font-mono text-[10px] uppercase tracking-wider">
              Guaranteed Invariants:
            </span>
            <ul className="space-y-1.5 text-muted-foreground">
              <li className="flex items-start gap-2">
                <History className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                <span>
                  <strong>Historical lineage survives:</strong> Past email deliveries and sequence executions are never deleted.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Shield className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
                <span>
                  <strong>Active outreach is protected:</strong> Active campaign sequences prevent deletion of affected contacts.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Shield className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                <span>
                  <strong>Safety rules remain intact:</strong> Company DNC, domain, and email suppression records survive.
                </span>
              </li>
            </ul>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t border-border-subtle">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
            className="text-xs h-8"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={handleConfirm}
            disabled={isLoading}
            className="text-xs h-8"
          >
            {isLoading
              ? 'Deleting...'
              : isBulk
              ? `Delete ${bulkCount} Companies`
              : 'Delete Company'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

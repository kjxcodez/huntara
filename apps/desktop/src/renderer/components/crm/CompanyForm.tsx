import React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { createCompanyDtoSchema, CompanyStatus } from '@huntara/schema';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

const formSchema = createCompanyDtoSchema;
type FormData = z.infer<typeof formSchema>;

interface CompanyFormProps {
  initialValues?: Partial<FormData>;
  onSubmit: (data: FormData) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

/**
 * CompanyForm wraps inputs with react-hook-form validation for Company creation/updates.
 */
export function CompanyForm({
  initialValues,
  onSubmit,
  onCancel,
  isLoading = false
}: CompanyFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: initialValues?.name || '',
      domain: initialValues?.domain || '',
      industry: initialValues?.industry || '',
      size: initialValues?.size || '11-50',
      location: initialValues?.location || '',
      status: initialValues?.status || CompanyStatus.LEAD
    }
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="name" className="text-xs font-semibold">
          Company Name *
        </Label>
        <Input id="name" placeholder="Acme Corp" {...register('name')} className="text-xs h-8" />
        {errors.name && <span className="text-[10px] text-danger-text">{errors.name.message}</span>}
      </div>

      <div className="space-y-1">
        <Label htmlFor="domain" className="text-xs font-semibold">
          Domain / Website URL
        </Label>
        <Input id="domain" placeholder="acme.com" {...register('domain')} className="text-xs h-8" />
        {errors.domain && (
          <span className="text-[10px] text-danger-text">{errors.domain.message}</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="industry" className="text-xs font-semibold">
            Industry
          </Label>
          <Input
            id="industry"
            placeholder="SaaS / Software"
            {...register('industry')}
            className="text-xs h-8"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="size" className="text-xs font-semibold">
            Company Size
          </Label>
          <select
            id="size"
            {...register('size')}
            className="w-full bg-card border border-border-subtle rounded px-2.5 py-1 text-xs outline-none text-foreground focus:ring-1 focus:ring-accent/20 h-8"
          >
            <option value="1-10">1-10 Employees</option>
            <option value="11-50">11-50 Employees</option>
            <option value="51-200">51-200 Employees</option>
            <option value="201-500">201-500 Employees</option>
            <option value="500+">500+ Employees</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="location" className="text-xs font-semibold">
            Location / Address
          </Label>
          <Input
            id="location"
            placeholder="San Francisco, CA"
            {...register('location')}
            className="text-xs h-8"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="status" className="text-xs font-semibold">
            Status *
          </Label>
          <select
            id="status"
            {...register('status')}
            className="w-full bg-card border border-border-subtle rounded px-2.5 py-1 text-xs outline-none text-foreground focus:ring-1 focus:ring-accent/20 h-8"
          >
            <option value={CompanyStatus.LEAD}>Lead</option>
            <option value={CompanyStatus.QUALIFIED}>Qualified</option>
            <option value={CompanyStatus.CUSTOMER}>Customer</option>
            <option value={CompanyStatus.ARCHIVED}>Archived</option>
          </select>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t border-border-subtle">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          size="sm"
          className="h-8 text-xs font-semibold"
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isLoading} size="sm" className="h-8 text-xs font-semibold">
          {initialValues ? 'Save Changes' : 'Create Company'}
        </Button>
      </div>
    </form>
  );
}

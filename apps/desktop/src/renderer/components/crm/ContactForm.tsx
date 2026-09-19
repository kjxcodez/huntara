import React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { createContactDtoSchema, ContactStatus, type Company } from '@huntara/schema';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

const formSchema = createContactDtoSchema;
type FormData = z.infer<typeof formSchema>;

interface ContactFormProps {
  initialValues?: Partial<FormData>;
  companies?: Company[];
  onSubmit: (data: FormData) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

/**
 * ContactForm wraps inputs with validation for Contact creation/updates.
 */
export function ContactForm({
  initialValues,
  companies = [],
  onSubmit,
  onCancel,
  isLoading = false
}: ContactFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      firstName: initialValues?.firstName || '',
      lastName: initialValues?.lastName || '',
      email: initialValues?.email || '',
      phone: initialValues?.phone || '',
      title: initialValues?.title || '',
      linkedin: initialValues?.linkedin || '',
      status: initialValues?.status || ContactStatus.NEW,
      companyId: initialValues?.companyId || null,
      notes: initialValues?.notes || '',
      source: initialValues?.source || 'manual'
    }
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="firstName" className="text-xs font-semibold">
            First Name *
          </Label>
          <Input
            id="firstName"
            placeholder="John"
            {...register('firstName')}
            className="text-xs h-8"
          />
          {errors.firstName && (
            <span className="text-[10px] text-danger-text">{errors.firstName.message}</span>
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor="lastName" className="text-xs font-semibold">
            Last Name
          </Label>
          <Input
            id="lastName"
            placeholder="Doe"
            {...register('lastName')}
            className="text-xs h-8"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="email" className="text-xs font-semibold">
            Email Address
          </Label>
          <Input
            id="email"
            placeholder="john@acme.com"
            {...register('email')}
            className="text-xs h-8"
          />
          {errors.email && (
            <span className="text-[10px] text-danger-text">{errors.email.message}</span>
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor="phone" className="text-xs font-semibold">
            Phone Number
          </Label>
          <Input
            id="phone"
            placeholder="+1 (555) 019-2834"
            {...register('phone')}
            className="text-xs h-8"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="title" className="text-xs font-semibold">
            Job Title
          </Label>
          <Input
            id="title"
            placeholder="VP of Sales"
            {...register('title')}
            className="text-xs h-8"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="companyId" className="text-xs font-semibold">
            Company Relationship
          </Label>
          <select
            id="companyId"
            {...register('companyId')}
            className="w-full bg-card border border-border-subtle rounded px-2.5 py-1 text-xs outline-none text-foreground focus:ring-1 focus:ring-accent/20 h-8"
          >
            <option value="">No Associated Company</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="linkedin" className="text-xs font-semibold">
            LinkedIn Profile / Handle
          </Label>
          <Input
            id="linkedin"
            placeholder="in/johndoe"
            {...register('linkedin')}
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
            <option value={ContactStatus.NEW}>New</option>
            <option value={ContactStatus.CONTACTED}>Contacted</option>
            <option value={ContactStatus.REPLIED}>Replied</option>
            <option value={ContactStatus.BOUNCED}>Bounced</option>
            <option value={ContactStatus.UNSUBSCRIBED}>Unsubscribed</option>
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
          {initialValues ? 'Save Changes' : 'Create Contact'}
        </Button>
      </div>
    </form>
  );
}

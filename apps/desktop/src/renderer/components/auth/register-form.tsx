import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { FormCard } from './form-card';
import { AuthHeader } from './auth-header';
import { Divider } from './divider';
import { AuthFooter } from './auth-footer';
import { useState } from 'react';
import { PasswordToggle } from './password-toggle';

const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters')
});

export type RegisterFormValues = z.infer<typeof registerSchema>;

interface RegisterFormProps {
  onSubmit: (data: RegisterFormValues) => void;
  onNavigateToLogin: () => void;
  isLoading?: boolean;
  error?: string | null;
}

/**
 * Standard credentials registration form.
 * Uses React Hook Form with Zod validation.
 * All interactive elements use shadcn/ui components and design-system tokens.
 */
export function RegisterForm({
  onSubmit,
  onNavigateToLogin,
  isLoading = false,
  error = null
}: RegisterFormProps) {
  const [showPassword, setShowPassword] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: '',
      email: '',
      password: ''
    }
  });

  return (
    <FormCard>
      <AuthHeader
        title="Create your account"
        subtitle="Get started with HUNTARA"
      />

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {/* Global error banner */}
        {error && (
          <div
            role="alert"
            className="rounded-none border border-danger/20 bg-danger-muted px-3 py-2 text-[12px] font-medium text-danger text-center"
          >
            {error}
          </div>
        )}

        {/* Full Name field */}
        <div className="space-y-1.5">
          <Label
            htmlFor="reg-name"
            className="text-[12px] font-medium tracking-[0.04em] uppercase text-muted-foreground"
          >
            Full name
          </Label>
          <Input
            id="reg-name"
            type="text"
            placeholder="Jane Smith"
            disabled={isLoading}
            aria-invalid={!!errors.name}
            {...register('name')}
            className="rounded-none"
          />
          {errors.name && (
            <p className="text-[11px] text-danger leading-none" role="alert">
              {errors.name.message}
            </p>
          )}
        </div>

        {/* Email field */}
        <div className="space-y-1.5">
          <Label
            htmlFor="reg-email"
            className="text-[12px] font-medium tracking-[0.04em] uppercase text-muted-foreground"
          >
            Work email
          </Label>
          <Input
            id="reg-email"
            type="email"
            placeholder="you@company.com"
            disabled={isLoading}
            aria-invalid={!!errors.email}
            {...register('email')}
            className="rounded-none"
          />
          {errors.email && (
            <p className="text-[11px] text-danger leading-none" role="alert">
              {errors.email.message}
            </p>
          )}
        </div>

        {/* Password field */}
        <div className="space-y-1.5">
          <Label
            htmlFor="reg-password"
            className="text-[12px] font-medium tracking-[0.04em] uppercase text-muted-foreground"
          >
            Password
          </Label>

          <div className="relative">
            <Input
              id="reg-password"
              type={showPassword ? 'text' : 'password'}
              placeholder="At least 8 characters"
              disabled={isLoading}
              aria-invalid={!!errors.password}
              {...register('password')}
              className="rounded-none"
            />
            <PasswordToggle
              show={showPassword}
              onToggle={() => setShowPassword(!showPassword)}
              disabled={isLoading}
            />
          </div>

          {errors.password && (
            <p className="text-[11px] text-danger leading-none" role="alert">
              {errors.password.message}
            </p>
          )}
        </div>

        {/* Primary submit button — Forge Orange */}
        <Button
          type="submit"
          disabled={isLoading}
          className="w-full rounded-none"
          size="default"
        >
          {isLoading ? 'Creating account…' : 'Create account'}
        </Button>
      </form>

      <Divider label="or" />

      <AuthFooter
        message="Already have an account?"
        linkText="Sign in"
        onLinkClick={onNavigateToLogin}
      />
    </FormCard>
  );
}

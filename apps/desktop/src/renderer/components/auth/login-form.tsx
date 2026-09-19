import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginDtoSchema } from '@leadforge/schema';
import type { LoginDto } from '@leadforge/schema';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { FormCard } from './form-card';
import { AuthHeader } from './auth-header';
import { Divider } from './divider';
import { GoogleIcon } from './google-icon';
import { AuthFooter } from './auth-footer';
import { useState } from 'react';
import { PasswordToggle } from './password-toggle';

interface LoginFormProps {
  onSubmit: (data: LoginDto) => void;
  onGoogleLogin: () => void;
  onNavigateToRegister: () => void;
  onNavigateToResetPassword: () => void;
  isLoading?: boolean;
  isGoogleLoading?: boolean;
  error?: string | null;
}

/**
 * Standard credentials login form.
 * Uses React Hook Form with shared Zod validation from @leadforge/schema.
 * All interactive elements use shadcn/ui components and design-system tokens.
 */
export function LoginForm({
  onSubmit,
  onGoogleLogin,
  onNavigateToRegister,
  onNavigateToResetPassword,
  isLoading = false,
  isGoogleLoading = false,
  error = null
}: LoginFormProps) {
  const [showPassword, setShowPassword] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<LoginDto>({
    resolver: zodResolver(loginDtoSchema as unknown as z.ZodType<any, any, any>),
    defaultValues: {
      email: '',
      password: ''
    }
  });

  const anyLoading = isLoading || isGoogleLoading;

  return (
    <FormCard>
      <AuthHeader
        title="Welcome to HUNTARA"
        subtitle="Sign in with your professional credentials"
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

        {/* Email field */}
        <div className="space-y-1.5">
          <Label
            htmlFor="email"
            className="text-[12px] font-medium tracking-[0.04em] uppercase text-muted-foreground"
          >
            Email address
          </Label>
          <Input
            id="email"
            type="email"
            placeholder="name@company.com"
            disabled={anyLoading}
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
            htmlFor="password"
            className="text-[12px] font-medium tracking-[0.04em] uppercase text-muted-foreground"
          >
            Password
          </Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              placeholder="••••••••"
              disabled={anyLoading}
              aria-invalid={!!errors.password}
              {...register('password')}
              className="rounded-none"
            />
            <PasswordToggle
              show={showPassword}
              onToggle={() => setShowPassword(!showPassword)}
              disabled={anyLoading}
            />
          </div>
          {errors.password && (
            <p className="text-[11px] text-danger leading-none" role="alert">
              {errors.password.message}
            </p>
          )}
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => onNavigateToResetPassword()}
            className="font-medium text-foreground hover:text-primary transition-colors duration-[--duration-instant] focus:outline-none focus-visible:underline cursor-pointer text-xs"
          >
            forgot password?
          </button>
        </div>

        {/* Primary submit button — Forge Orange */}
        <Button type="submit" disabled={anyLoading} className="w-full rounded-none" size="default">
          {isLoading ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <Divider label="or" />

      <Button
        type="button"
        variant="outline"
        onClick={onGoogleLogin}
        disabled={anyLoading}
        className="w-full rounded-none"
        size="default"
      >
        <GoogleIcon className="mr-2 h-4 w-4" />
        {isGoogleLoading ? 'Connecting to Google…' : 'Continue with Google'}
      </Button>

      <AuthFooter
        message="Don't have an account?"
        linkText="Sign up"
        onLinkClick={onNavigateToRegister}
      />
    </FormCard>
  );
}

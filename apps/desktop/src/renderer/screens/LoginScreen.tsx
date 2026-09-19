import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { LoginForm } from '../components/auth/login-form';
import type { LoginDto } from '@huntara/schema';

/**
 * LoginScreen handles user authentication.
 * It reads auth state from useAuth and delegates navigation to React Router.
 * No prop callbacks — the router resolves navigation declaratively.
 */
export function LoginScreen() {
  const navigate = useNavigate();
  const { login, loginWithGoogle } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (data: LoginDto) => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      await login(data.email, data.password ?? '');
      navigate('/', { replace: true });
    } catch (err: any) {
      setErrorMsg(err.message ?? 'Authentication failed. Please verify your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsGoogleLoading(true);
    setErrorMsg(null);
    try {
      await loginWithGoogle();
      navigate('/', { replace: true });
    } catch (err: any) {
      setErrorMsg(
        err.message ?? 'Google sign-in failed. Please try again or use your password.'
      );
    } finally {
      setIsGoogleLoading(false);
    }
  };

  return (
    <div className="space-y-6 w-full">
      <LoginForm
        onSubmit={handleSubmit}
        onGoogleLogin={handleGoogleLogin}
        onNavigateToRegister={() => navigate('/auth/register')}
        onNavigateToResetPassword={() => navigate('/auth/forgot-password')}
        isLoading={isLoading}
        isGoogleLoading={isGoogleLoading}
        error={errorMsg}
      />
    </div>
  );
}

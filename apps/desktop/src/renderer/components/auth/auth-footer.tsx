interface AuthFooterProps {
  message: string;
  linkText: string;
  onLinkClick: () => void;
  className?: string;
}

/**
 * Standard bottom footer for forms providing action links.
 * Uses design tokens — theme-aware for light and dark mode.
 */
export function AuthFooter({ message, linkText, onLinkClick, className = '' }: AuthFooterProps) {
  return (
    <div className={`space-y-3 text-center ${className}`}>
      <p className="text-[13px] text-muted-foreground">
        {message}{' '}
        <button
          type="button"
          onClick={onLinkClick}
          className="font-medium text-foreground hover:text-primary transition-colors duration-[--duration-instant] focus:outline-none focus-visible:underline cursor-pointer"
        >
          {linkText}
        </button>
      </p>

      <p className="text-[11px] leading-relaxed text-text-tertiary">
        By continuing, you agree to our{' '}
        <a
          href="https://huntara.com/terms"
          className="underline underline-offset-2 hover:text-muted-foreground transition-colors duration-[--duration-instant]"
        >
          Terms of Service
        </a>{' '}
        and{' '}
        <a
          href="https://huntara.com/privacy"
          className="underline underline-offset-2 hover:text-muted-foreground transition-colors duration-[--duration-instant]"
        >
          Privacy Policy
        </a>
        .
      </p>
    </div>
  );
}

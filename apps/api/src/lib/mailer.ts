import { logger } from '@leadforge/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Design System Tokens (from DESIGN.md)
// ─────────────────────────────────────────────────────────────────────────────
const DS = {
  bgBase: '#0A0A0B',
  bgSurface1: '#131316',
  bgSurface2: '#1B1B1F',
  borderSubtle: '#232327',
  borderDefault: '#2E2E33',
  accent: '#FA7125',
  accentHover: '#FB8846',
  textPrimary: '#F4F4F5',
  textSecondary: '#A3A3AB',
  textTertiary: '#6E6E76',
  textOnAccent: '#0A0A0B',
  success: '#3FB27F',
  danger: '#E24C4B',
  fontStack: "'Inter', 'Helvetica Neue', Arial, sans-serif",
  monoStack: "'JetBrains Mono', 'Menlo', 'Courier New', monospace"
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Shared HTML email shell
// Used by all templates — handles consistent outer structure, font loading,
// dark background, and max-width 600px container (email-safe table layout).
// ─────────────────────────────────────────────────────────────────────────────
function emailShell(content: string): string {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400&display=swap');

    /* Reset */
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; border-collapse: collapse; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
    a { color: ${DS.accent}; }

    /* Base */
    body {
      background-color: ${DS.bgBase};
      font-family: ${DS.fontStack};
      font-size: 15px;
      line-height: 24px;
      color: ${DS.textSecondary};
      margin: 0;
      padding: 0;
    }

    /* Dark mode overrides for clients that force light mode */
    @media (prefers-color-scheme: dark) {
      body { background-color: ${DS.bgBase} !important; }
      .email-body { background-color: ${DS.bgBase} !important; }
      .email-card { background-color: ${DS.bgSurface1} !important; }
    }
  </style>
</head>
<body style="background-color: ${DS.bgBase}; margin: 0; padding: 0;">
  <!-- Outer wrapper -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="email-body"
         style="background-color: ${DS.bgBase}; margin: 0; padding: 0;">
    <tr>
      <td align="center" style="padding: 48px 16px;">

        <!-- Card -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="max-width: 560px; width: 100%;">

          <!-- Logo bar -->
          <tr>
            <td align="center" style="padding-bottom: 32px;">
              <span style="font-family: ${DS.fontStack}; font-size: 13px; font-weight: 600;
                           letter-spacing: 0.12em; color: ${DS.textTertiary}; text-transform: uppercase;">
                HUNTARA
              </span>
            </td>
          </tr>

          <!-- Main card -->
          <tr>
            <td style="background-color: ${DS.bgSurface1}; border: 1px solid ${DS.borderDefault};
                       border-radius: 12px; padding: 40px 40px 32px 40px;" class="email-card">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top: 32px;">
              <p style="font-family: ${DS.fontStack}; font-size: 12px; line-height: 18px;
                         color: ${DS.textTertiary}; margin: 0;">
                &copy; ${new Date().getFullYear()} HUNTARA &nbsp;&middot;&nbsp;
                <span style="color: ${DS.textTertiary};">You received this because you have an account on HUNTARA.</span>
              </p>
              <p style="font-family: ${DS.fontStack}; font-size: 11px; line-height: 16px;
                         color: ${DS.textTertiary}; margin: 8px 0 0 0; opacity: 0.6;">
                This is an automated system email — do not reply.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared sub-components
// ─────────────────────────────────────────────────────────────────────────────

/** Primary CTA button — Forge Orange, 44px height, 16px h-padding */
function primaryButton(href: string, label: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
      <tr>
        <td align="center" style="border-radius: 8px; background-color: ${DS.accent};">
          <a href="${href}" target="_blank"
             style="display: inline-block; font-family: ${DS.fontStack}; font-size: 14px;
                    font-weight: 600; color: ${DS.textOnAccent}; text-decoration: none;
                    padding: 13px 28px; border-radius: 8px; letter-spacing: -0.01em;
                    mso-padding-alt: 13px 28px;">
            ${label}
          </a>
        </td>
      </tr>
    </table>`;
}

/** Ghost fallback URL for when buttons don't render */
function fallbackUrl(url: string): string {
  return `
    <p style="font-family: ${DS.monoStack}; font-size: 11px; line-height: 18px;
               color: ${DS.textTertiary}; word-break: break-all; margin: 0;
               background-color: ${DS.bgSurface2}; border: 1px solid ${DS.borderSubtle};
               border-radius: 6px; padding: 10px 12px; text-align: left;">
      ${url}
    </p>`;
}

/** Horizontal divider */
function divider(): string {
  return `<tr><td style="padding: 24px 0;">
    <div style="height: 1px; background-color: ${DS.borderSubtle};"></div>
  </td></tr>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MailerService
// ─────────────────────────────────────────────────────────────────────────────
export class MailerService {
  private static instance: MailerService;
  private fromAddress: string = 'HUNTARA <noreply@huntara.com>';

  private constructor() {
    logger.info('Mailer: Initialized transactional system mailer.');
  }

  public static getInstance(): MailerService {
    if (!MailerService.instance) MailerService.instance = new MailerService();
    return MailerService.instance;
  }

  public async sendMail(to: string, subject: string, html: string, text: string): Promise<void> {
    logger.info(`[SYSTEM MAIL] To: ${to} | Subject: ${subject}\n${text}`);
  }

  public async sendTextMail(to: string, subject: string, text: string): Promise<void> {
    logger.info(`[SYSTEM TEXT MAIL] To: ${to} | Subject: ${subject}\n${text}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Template: Verify Email (Text-only for beta)
  // ──────────────────────────────────────────────────────────────────────────
  public async sendVerificationEmail(to: string, verificationUrl: string): Promise<void> {
    const subject = 'Verify your email — HUNTARA';
    const text = `Welcome to HUNTARA.\n\nVerify your email address by opening this link:\n${verificationUrl}\n\nIf you did not create an account, ignore this email.`;

    await this.sendTextMail(to, subject, text);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Template: Reset Password (Text-only for beta)
  // ──────────────────────────────────────────────────────────────────────────
  public async sendResetPasswordEmail(to: string, resetUrl: string): Promise<void> {
    const subject = 'Reset your password — HUNTARA';
    const text = `You requested a password reset for your HUNTARA account.\n\nReset your password here:\n${resetUrl}\n\nThis link expires in 1 hour. If you did not request this, ignore this email — your password has not been changed.`;

    await this.sendTextMail(to, subject, text);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Template: Welcome (post-verification, Text-only for beta)
  // ──────────────────────────────────────────────────────────────────────────
  public async sendWelcomeEmail(to: string, name: string): Promise<void> {
    const subject = 'Welcome to HUNTARA';
    const text = `Hi ${name},\n\nYour email has been verified. Your HUNTARA account is active.\n\nOpen the desktop app and sign in to get started.`;

    await this.sendTextMail(to, subject, text);
  }
}

import { betterAuth } from 'better-auth';
import { bearer } from 'better-auth/plugins';

export interface BetterAuthConfigOptions {
  secret: string;
  baseUrl: string;
  mongodbUri?: string;
  database?: any;
  trustedOrigins?: string[];
  authorizeHook?: (credentials: Record<string, unknown>) => Promise<any>;
  emailVerification?: {
    sendVerificationEmail: (data: { user: any; url: string; token: string }) => Promise<void>;
  };
  emailAndPassword?: {
    sendResetPassword?: (data: { user: any; url: string; token: string }) => Promise<void>;
  };
  google?: {
    clientId: string;
    clientSecret: string;
  };
}

export function createBetterAuth(options: BetterAuthConfigOptions) {
  const socialProviders: Record<string, any> = {};

  if (options.google) {
    socialProviders.google = {
      clientId: options.google.clientId,
      clientSecret: options.google.clientSecret
    };
  }

  const trustedOrigins = [
    'http://127.0.0.1:*',
    'http://localhost:*',
    'huntara://*',
    'leadforge://*',
    ...(options.trustedOrigins || [])
  ];

  const loopbackTokenPlugin = () => ({
    id: 'loopback-token-plugin',
    hooks: {
      after: [
        {
          matcher(ctx: any) {
            return ctx.path.includes('/callback/');
          },
          handler: async (ctx: any) => {
            const location = ctx.responseHeaders?.get('location');
            const setCookie = ctx.responseHeaders?.get('set-cookie');
            if (typeof location === 'string' && (location.includes('127.0.0.1') || location.includes('localhost')) && setCookie) {
              const match = setCookie.match(/better-auth\.session_token=([^;]+)/);
              if (match && match[1]) {
                const rawToken = decodeURIComponent(match[1]).split('.')[0];
                if (rawToken) {
                  try {
                    const url = new URL(location);
                    if (!url.searchParams.has('token')) {
                      url.searchParams.set('token', rawToken);
                      if (ctx.responseHeaders) {
                        ctx.responseHeaders.set('location', url.toString());
                      }
                    }
                  } catch {
                    // ignore invalid URL format
                  }
                }
              }
            }
            return {
              headers: ctx.responseHeaders
            };
          }
        }
      ]
    }
  });

  const betterAuthConfig: any = {
    secret: options.secret,
    baseURL: options.baseUrl,
    trustedOrigins,
    database: options.database,
    emailAndPassword: {
      enabled: true
    },
    plugins: [bearer(), loopbackTokenPlugin()],
    providers: [
      {
        id: 'credential',
        name: 'Credentials',
        async authorize(credentials: Record<string, unknown>) {
          if (options.authorizeHook) {
            return options.authorizeHook(credentials);
          }
          return null;
        }
      }
    ],
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24 // 1 day
    }
  };

  if (Object.keys(socialProviders).length > 0) {
    betterAuthConfig.socialProviders = socialProviders;
  }

  if (options.emailAndPassword?.sendResetPassword) {
    betterAuthConfig.emailAndPassword.sendResetPassword = options.emailAndPassword.sendResetPassword;
  }

  if (options.emailVerification) {
    betterAuthConfig.emailVerification = {
      autoSignInAfterVerification: true,
      sendOnSignUp: true,
      sendVerificationEmail: options.emailVerification.sendVerificationEmail
    };
  }

  return betterAuth(betterAuthConfig);
}

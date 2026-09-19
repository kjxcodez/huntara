import { createBetterAuth } from '@huntara/auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { MongoClient } from 'mongodb';
import { env } from './env.js';
import { MailerService } from '../lib/mailer.js';

const mailer = MailerService.getInstance();
const client = new MongoClient(env.MONGODB_URI);
const db = client.db();

export const auth: any = createBetterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseUrl: env.BETTER_AUTH_URL,
  database: mongodbAdapter(db),
  authorizeHook: async (credentials) => {
    // Better Auth authorization hook placeholder
    return null;
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url, token }: { user: any; url: string; token: string }) => {
      const verificationLink = `${env.BETTER_AUTH_URL}/verify-email?token=${token}&callbackURL=${env.BETTER_AUTH_URL}/verify-success`;
      await mailer.sendVerificationEmail(user.email, verificationLink);
    }
  },
  emailAndPassword: {
    sendResetPassword: async ({ user, url, token }: { user: any; url: string; token: string }) => {
      const resetLink = `${env.BETTER_AUTH_URL}/reset-password-form?token=${token}`;
      await mailer.sendResetPasswordEmail(user.email, resetLink);
    }
  },
  ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET
        }
      }
    : {})
});

import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';

import type { Database } from '../db/client';
import * as schema from '../db/schema';

export interface AuthOptions {
  db: Database;
  /** Origin users reach the app at, e.g. http://localhost:5173. Better Auth's baseURL. */
  publicUrl: string;
  secret: string;
  discord: { clientId: string; clientSecret: string };
}

/** Where Better Auth's routes live. The web client and Discord redirect URI depend on it. */
export const AUTH_BASE_PATH = '/api/auth';

/** Placeholder for Discord accounts without an email (phone-only). Never deliverable. */
export function placeholderEmail(discordId: string): string {
  return `${discordId}@discord.invalid`;
}

const THIRTY_DAYS = 60 * 60 * 24 * 30;
const ONE_DAY = 60 * 60 * 24;

/**
 * Better Auth: Sign in with Discord only (governance D-05), database sessions in
 * HTTP-only cookies. Tables are users / sessions / accounts / verifications with UUID ids.
 */
export function createAuth(options: AuthOptions) {
  return betterAuth({
    appName: 'Stagehand',
    baseURL: options.publicUrl,
    basePath: AUTH_BASE_PATH,
    secret: options.secret,
    trustedOrigins: [options.publicUrl],

    database: drizzleAdapter(options.db, { provider: 'pg', schema, usePlural: true }),

    // Discord is the only way in (§14). Profile edits go through our own validated
    // PATCH /api/me, so Better Auth's generic user-editing endpoints are switched off.
    emailAndPassword: { enabled: false },
    disabledPaths: [
      '/update-user',
      '/change-email',
      '/delete-user',
      '/sign-in/email',
      '/sign-up/email',
    ],

    socialProviders: {
      discord: {
        clientId: options.discord.clientId,
        clientSecret: options.discord.clientSecret,
        // Default scopes are `identify email` (D-18).
        // Keep the avatar and Discord name current on every sign-in. Our own
        // `displayName` is not a mapped field, so a custom name survives.
        overrideUserInfoOnSignIn: true,
        mapProfileToUser: (profile) => ({
          // Phone-only Discord accounts have no email, but Better Auth requires one.
          email: profile.email ?? placeholderEmail(profile.id),
          emailVerified: profile.email ? profile.verified : false,
          discordId: profile.id,
          discordUsername: profile.username,
        }),
      },
    },

    user: {
      additionalFields: {
        // Discord fields come from `mapProfileToUser`, which Better Auth treats as input, so
        // they must be `input: true` or they are silently dropped. Clients still can't set
        // them: every endpoint that accepts user input from a client (/update-user,
        // /sign-up/email) is disabled above, and the auth integration tests check that.
        discordId: { type: 'string', required: true, unique: true, input: true },
        discordUsername: { type: 'string', required: true, input: true },
        // Only our validated PATCH /api/me writes this.
        displayName: { type: 'string', required: false, input: false },
      },
    },

    account: {
      // Discord access/refresh tokens are kept but never used after sign-in; encrypt them at
      // rest (XChaCha20-Poly1305, keyed from BETTER_AUTH_SECRET) so a DB dump or backup
      // doesn't hand out live Discord tokens (§14).
      encryptOAuthTokens: true,
    },

    session: {
      // Rolling 30 days, so a weekly group never has to sign in again mid-campaign.
      expiresIn: THIRTY_DAYS,
      updateAge: ONE_DAY,
    },

    rateLimit: {
      // On in production by default; memory storage is fine for one server process.
      storage: 'memory',
    },

    advanced: {
      database: { generateId: 'uuid' },
      useSecureCookies: options.publicUrl.startsWith('https://'),
      ipAddress: {
        // Cloudflare Tunnel sets this to the real client IP (F0.5). The app port is only
        // published on localhost, so it cannot be spoofed from outside.
        ipAddressHeaders: ['cf-connecting-ip'],
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

/**
 * Values shared by the login page (client) and lib/account-security.ts
 * (server). Kept separate so the client bundle doesn't pull in server code.
 */

/** Prefix of the sign-in error that tells the login page to ask for a code. */
export const MFA_REQUIRED_PREFIX = "MFA_REQUIRED:";

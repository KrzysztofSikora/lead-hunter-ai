/** Test-only credentials for the e2e server; not a secret. */
export const E2E_PASSWORD = 'e2e-test-password-DEMO';
/** `scrypt:` hash of E2E_PASSWORD, made with `pnpm auth:hash`. */
export const E2E_PASSWORD_HASH =
  'scrypt:15:8:3:Dam3HcJsb4VKnruNqmuSyw:ie09VRIaKtgyT6wgpFvWByCSnuwayZaZy8whxIGhaCc';
// The login throttle (5 attempts per 15 minutes, all clients together) is shared by every spec
// on this server: the smoke spec uses 2 attempts, so a new spec may log in at most 3 more times.

/**
 * OwnerIdentity — the single source of truth for "who is the application owner".
 *
 * Defect this fixes (Part H §2): the previous owner address was hardcoded in
 * four places in `server.ts` and three in `DeveloperAuthModal.tsx`, so it could
 * not be changed without a code edit, and the developer surface advertised an
 * address that no longer matched the account that actually holds the role.
 *
 * Rules implemented here:
 *  - The owner address comes from protected deployment configuration
 *    (`RARE_OWNER_EMAIL`), with the documented default.
 *  - Nothing in this module decides ownership from a browser-submitted string.
 *    `isOwnerAccount` only ever receives an account that was already resolved
 *    from a validated session.
 *  - The value is safe to send to the browser: it is a public contact address,
 *    not a secret.
 */

export const DEFAULT_OWNER_EMAIL = 'mypremierai@gmail.com';

/** The configured owner address, normalised to lowercase. */
export function getOwnerEmail(): string {
  const configured = (process.env.RARE_OWNER_EMAIL || '').trim().toLowerCase();
  if (configured && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(configured)) return configured;
  return DEFAULT_OWNER_EMAIL;
}

/** The configured owner account id, when the deployment pins one. */
export function getOwnerAccountId(): string | null {
  const configured = (process.env.RARE_OWNER_ACCOUNT_ID || '').trim();
  return configured || null;
}

/**
 * Is this session-resolved account the owner?
 *
 * Both inputs must come from trusted state: `account` from the validated
 * auth session, never from request text.
 */
export function isOwnerAccount(account: { id?: string | null; email?: string | null } | null | undefined): boolean {
  if (!account) return false;
  const ownerEmail = getOwnerEmail();
  const email = (account.email || '').trim().toLowerCase();
  if (email && email === ownerEmail) return true;
  const ownerId = getOwnerAccountId();
  if (ownerId && account.id && account.id === ownerId) return true;
  return false;
}

/**
 * The address a password / access request is dispatched to. Kept as a function
 * so a request always uses the address configured at request time.
 */
export function ownerContactAddress(): string {
  return getOwnerEmail();
}

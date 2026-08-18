/**
 * Support Inbox is a single-owner admin tool — it shows every shop's support
 * conversations in one place so the app developer can manage them across all
 * installed stores. It must NEVER be reachable by a regular merchant: it
 * previously had no scoping at all, so any installed shop could read, reply
 * to, and even close every other shop's private conversations.
 *
 * Gated by an env var rather than a hardcoded shop domain, and FAILS CLOSED:
 * if SUPPORT_INBOX_OWNER_SHOP isn't set, nobody gets access — not even the
 * real owner — rather than risk ever defaulting back open.
 */
export function isSupportInboxOwner(shopDomain: string): boolean {
  const owner = process.env.SUPPORT_INBOX_OWNER_SHOP;
  return !!owner && shopDomain === owner;
}

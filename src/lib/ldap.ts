import { Client } from "ldapts";

// AD_DOMAIN is the NetBIOS domain name used in the down-level logon format
// (DOMAIN\username) — confirmed working against Beesline's AD by another existing tool,
// so we're reusing the exact same bind pattern rather than inventing a new one.
const LDAP_URL = process.env.LDAP_URL!; // e.g. "ldaps://<host>:636" or "ldap://<host>:389"
const AD_DOMAIN = process.env.AD_DOMAIN ?? "BEESLINE";

const CLIENT_TIMEOUT_MS = 5000;

/**
 * Verifies a username/password pair against on-prem Active Directory via a SIMPLE bind:
 * attempt to bind directly as `DOMAIN\username` with the submitted password. No search
 * step, no service account — the bind succeeding IS the authentication check. This
 * mirrors the pattern already proven working against Beesline's AD by another tool.
 *
 * Fails closed: any bind failure, timeout, or LDAP error returns false, never throws in
 * a way that could be mistaken for success.
 */
export async function verifyAdCredentials(username: string, password: string): Promise<boolean> {
  if (!username || !password) return false;

  // Construction lives inside the try block, not before it — a malformed LDAP_URL makes
  // `new Client()` throw synchronously, which would otherwise bypass the fail-closed
  // catch below (the exact bug the ldapjs version of this function had).
  let client: Client | undefined;
  const downLevelLogon = `${AD_DOMAIN}\\${username}`;

  try {
    client = createClient();
    await client.bind(downLevelLogon, password);
    return true; // the bind succeeding IS the password check
  } catch (err) {
    // Deliberately one return path for "wrong password," "no such account," and
    // "account locked/disabled" — a caller probing usernames shouldn't be able to
    // distinguish these from the outside. Real diagnosis, if ever needed, belongs in
    // this console.error for an admin reading server logs, not in what the user sees.
    console.error("LDAP bind failed:", err instanceof Error ? err.message : err);
    return false;
  } finally {
    await client?.unbind().catch(() => {}); // unbind failures shouldn't mask the real result
  }
}

function createClient(): Client {
  return new Client({
    url: LDAP_URL,
    timeout: CLIENT_TIMEOUT_MS,
    connectTimeout: CLIENT_TIMEOUT_MS,
    // If LDAP_URL ends up being ldap:// (port 389, not LDAPS), the password travels in
    // cleartext on the wire during bind. Flag this explicitly once the real URL is known
    // — don't let "it matches what the other tool does" quietly become "so it's fine."
  });
}

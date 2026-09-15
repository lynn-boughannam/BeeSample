import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { verifyAdCredentials } from "@/lib/ldap";
import type { Role } from "@/lib/types";

// Distinct from the default CredentialsSignin ("credentials") so the login page can show
// "account deactivated" instead of the generic "invalid username or password" — SLT-9.
// Wrong password and not-provisioned stay on the default code/message on purpose, so a
// caller probing usernames can't tell those apart from each other.
export class AccountDeactivatedError extends CredentialsSignin {
  code = "account_deactivated";
}

// DEVELOPMENT ONLY. With DEV_AUTH_BYPASS=true the AD bind is skipped and any password is
// accepted, so the app can be exercised without a domain account. Everything else still
// applies: the user must exist in SLT and be active, and their role still comes from the
// database — this waives proof of identity, not authorisation.
//
// Hard-guarded on NODE_ENV: a production build ignores the flag entirely, so this cannot
// be switched on by an env var reaching the server. Remove the flag from .env to restore
// normal AD login.
const AUTH_BYPASS_ENABLED =
  process.env.DEV_AUTH_BYPASS === "true" && process.env.NODE_ENV !== "production";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        adUsername: {},
        password: {},
      },
      // Order matters: verify identity against AD first, then check local provisioning —
      // this way a stopped/misconfigured DB never accidentally grants access, and AD is
      // always the source of truth for "is this really who they say they are."
      authorize: async (credentials) => {
        const { adUsername, password } = credentials as { adUsername?: string; password?: string };
        if (!adUsername || !password) return null;

        // Step 1: does AD confirm this identity + password? If AD is down or the account
        // doesn't exist, this returns false — never throws in a way that could bypass the check.
        if (AUTH_BYPASS_ENABLED) {
          // Loud on purpose: this line in the server log is the only signal that identity
          // is not being checked.
          console.warn(
            `[DEV_AUTH_BYPASS] AD check skipped for "${adUsername}" — any password accepted. Never enable this outside local development.`
          );
        } else {
          const isValidAdLogin = await verifyAdCredentials(adUsername, password);
          if (!isValidAdLogin) return null;
        }

        // Step 2: is this AD account actually provisioned in SLT, and still active?
        // Deny-by-default: a valid AD login with no matching User row (or a deactivated one)
        // is still refused. Being a legitimate employee doesn't mean they should see
        // Standardization Unit sample data — an Admin has to have added them.
        const user = await prisma.user.findUnique({
          where: { adUsername },
          include: { role: true },
        });
        // Not provisioned stays generic — same as a wrong password, don't help enumerate
        // accounts. Deactivated gets a distinct, actionable message (SLT-9).
        if (!user) return null;
        if (!user.isActive) throw new AccountDeactivatedError();

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        return {
          id: user.id,
          name: user.name,
          role: user.role.name as Role,
        };
      },
    }),
  ],
  callbacks: {
    jwt: async ({ token, user }) => {
      if (user) {
        token.id = user.id as string;
        token.role = user.role as Role;
      }
      return token;
    },
    session: async ({ session, token }) => {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
      }
      return session;
    },
  },
});

import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

import { registerAccount } from "@/lib/account-api";
import { isAdminUser } from "@/lib/admin-access";

/**
 * GitHub and Google sign-in, open to anyone.
 *
 * A session no longer means "admin": it means "has an account", which is what
 * chat and picks need. The admin check lives in `authorized`, which middleware
 * runs on every /admin request, and is repeated by the page and its server
 * actions. Nothing may treat the mere presence of a session as authority.
 */
export const {
  handlers,
  auth,
  signIn,
  signOut,
  // Re-runs the jwt callback with trigger "update" and rewrites the cookie.
  unstable_update: refreshSession,
} = NextAuth({
  providers: [GitHub, Google],
  pages: {
    signIn: "/signin",
    error: "/signin",
  },
  callbacks: {
    async jwt({ token, account, profile, trigger }) {
      // Asked for when the API no longer knows this account id (the account was
      // deleted from another device, or the table was rebuilt). Dropping the id
      // sends the token back through registration below, which is keyed on the
      // provider identity already in the token and so can only ever return
      // this person's own account.
      if (trigger === "update") token.userId = undefined;
      // Only present on the request that completes an OAuth sign-in.
      if (account && profile) {
        token.provider = account.provider;
        token.subject = account.providerAccountId;
        token.login = account.provider === "github" ? (profile.login as string) : undefined;
        token.verifiedEmail = account.provider === "google" && profile.email_verified === true;
        token.userId = undefined;
      }
      // Retried on later requests: a sign-in while the API was down still
      // gets an account once it is back, without signing in again.
      if (
        !token.userId &&
        typeof token.provider === "string" &&
        typeof token.subject === "string"
      ) {
        token.userId = await registerAccount({
          provider: token.provider,
          subject: token.subject,
          displayName: token.name,
        });
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.provider = token.provider as string | undefined;
        session.user.login = token.login as string | undefined;
        session.user.verifiedEmail = token.verifiedEmail === true;
        session.user.userId = token.userId as string | undefined;
        // A hint for the UI, so only the owner is shown a link to /admin. It
        // grants nothing: the gate is `authorized` below, on every request.
        session.user.isAdmin = isAdminUser(session.user);
      }
      return session;
    },
    // Middleware only matches /admin, so this is the admin gate and nothing
    // else. Re-checked on every request: revoking access is a config change,
    // not a wait for a session to expire.
    authorized({ auth: session, request }) {
      if (isAdminUser(session?.user)) return true;
      const target = new URL("/admin/signin", request.nextUrl);
      // Signed in, but not as the owner: say so instead of offering the same
      // buttons again with no explanation.
      if (session?.user) target.searchParams.set("error", "AccessDenied");
      return Response.redirect(target);
    },
  },
});

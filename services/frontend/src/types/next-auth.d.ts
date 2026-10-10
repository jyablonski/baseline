import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user?: {
      /** Which OAuth provider issued this session: "github" or "google". */
      provider?: string;
      /** GitHub login, carried through so the allowlist can be re-checked. */
      login?: string;
      /** True only for a Google account whose address Google has verified. */
      verifiedEmail?: boolean;
      /** Baseline's own id for the account; absent until the API has registered it. */
      userId?: string;
      /** Whether to show a link to /admin. Display only; never an access check. */
      isAdmin?: boolean;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    provider?: string;
    /** The provider's stable account id. Stays in the token, never the session. */
    subject?: string;
    login?: string;
    verifiedEmail?: boolean;
    userId?: string;
  }
}

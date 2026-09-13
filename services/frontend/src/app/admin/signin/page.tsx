import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { signIn } from "@/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Admin sign-in" };

// NextAuth redirects here with ?error=... when the allowlist rejects an account.
const ERROR_COPY: Record<string, string> = {
  AccessDenied: "That GitHub account is not on the admin allowlist.",
  Configuration: "GitHub OAuth is not configured on this deployment.",
  Verification: "That sign-in link expired. Try again.",
};

export default async function AdminSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message = error ? (ERROR_COPY[error] ?? "Sign-in failed. Try again.") : null;

  return (
    <div className="mx-auto flex max-w-md flex-col justify-center py-16">
      <Card>
        <CardHeader>
          {/* CardTitle renders a div. This is a standalone page, so it needs a
              real h1 or the document has no heading at all. */}
          <CardTitle>
            <h1>Admin sign in</h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This area is restricted to the site owner. Sign in with the allowlisted GitHub account.
          </p>
          {message ? (
            <p className="bg-destructive/10 px-3 py-2 text-sm text-destructive">{message}</p>
          ) : null}
          <form
            action={async () => {
              "use server";
              await signIn("github", { redirectTo: "/admin" });
            }}
          >
            <Button type="submit" className="w-full">
              Continue with GitHub
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

import type { Metadata } from "next";

import { SignInButtons } from "@/components/account/sign-in-buttons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { safeReturnPath } from "@/lib/return-path";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Sign in" };

// NextAuth redirects here with ?error=... when a sign-in does not complete.
const ERROR_COPY: Record<string, string> = {
  Configuration: "Sign-in is not available right now.",
  OAuthAccountNotLinked: "That email is already tied to a different sign-in method.",
  Verification: "That sign-in link expired. Try again.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const { error, callbackUrl } = await searchParams;
  const message = error ? (ERROR_COPY[error] ?? "Sign-in failed. Try again.") : null;

  return (
    <div className="mx-auto flex max-w-md flex-col justify-center py-16">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>Sign in</h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Sign in to make picks and use chat.</p>
          {message ? (
            <p className="bg-destructive/10 px-3 py-2 text-sm text-destructive">{message}</p>
          ) : null}
          <SignInButtons redirectTo={safeReturnPath(callbackUrl)} />
        </CardContent>
      </Card>
    </div>
  );
}

import type { Metadata } from "next";

import { SignInButtons } from "@/components/account/sign-in-buttons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Admin sign-in" };

// The admin gate redirects here with ?error=AccessDenied when a signed-in
// account is not the owner's.
const ERROR_COPY: Record<string, string> = {
  AccessDenied: "That account is not on the admin allowlist.",
  Configuration: "Sign-in is not configured on this deployment.",
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
          <p className="text-sm text-muted-foreground">Restricted to the site owner.</p>
          {message ? (
            <p className="bg-destructive/10 px-3 py-2 text-sm text-destructive">{message}</p>
          ) : null}
          <SignInButtons redirectTo="/admin" />
        </CardContent>
      </Card>
    </div>
  );
}

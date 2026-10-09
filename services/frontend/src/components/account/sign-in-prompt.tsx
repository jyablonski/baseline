import Link from "next/link";

/** Shown in place of a signed-in page's content to a visitor with no session. */
export function SignInPrompt({ returnTo, children }: { returnTo: string; children: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <p className="max-w-md text-sm text-ink-2">{children}</p>
      <Link href={`/signin?callbackUrl=${encodeURIComponent(returnTo)}`} className="btn-fill">
        Sign in
      </Link>
    </div>
  );
}

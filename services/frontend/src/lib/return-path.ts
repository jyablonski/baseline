/**
 * A same-site path to return to after sign-in; anything else becomes "/".
 *
 * `callbackUrl` arrives in the query string, so it is attacker-controlled:
 * "//evil.example" and "/\evil.example" both read as paths and resolve to
 * another origin.
 */
export function safeReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }
  return value;
}

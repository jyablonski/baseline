"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

import { ProfileMenu } from "@/components/account/profile-menu";
import { BaselineWordmark } from "@/components/brand/baseline-wordmark";
import { useHydrated } from "@/hooks/use-hydrated";
import { useAccount, useFeatures } from "@/lib/account";
import { isNavActive, primaryNav } from "@/lib/nav";
import { cn } from "@/lib/utils";

export function Header() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const account = useAccount();
  const features = useFeatures();
  // The header hydrates late, inside its own Suspense boundary, by which time
  // a page may already have loaded the session and the flags. The server
  // rendered neither, so the first client render must not use them either.
  const hydrated = useHydrated();
  const accountIsLoading = !hydrated || account.isLoading;
  const tabs = primaryNav(hydrated && features.chatbot);
  const signInHref = `/signin?callbackUrl=${encodeURIComponent(pathname)}`;
  // The narrow layout has no room for a dropdown, so the same destinations
  // are listed flat. Empty until the session is known, so a signed-in visitor
  // never sees "Sign in" flash past.
  const mobileAccountLinks = accountIsLoading
    ? []
    : account.account
      ? [
          ...(features.picks ? [{ href: "/picks", label: "Your picks" }] : []),
          { href: "/account", label: "Account" },
        ]
      : [{ href: signInHref, label: "Sign in" }];

  return (
    <header className="sticky top-0 z-20 border-b border-rule-strong bg-raised">
      <div className="mx-auto flex h-[var(--ct-header-h-sm)] max-w-[1280px] items-center gap-3 px-[14px] sm:h-[var(--ct-header-h)] sm:px-6">
        <Link href="/" aria-label="Baseline" className="shrink-0">
          <BaselineWordmark className="block h-[38px] w-auto" />
        </Link>

        <nav aria-label="Primary" className="hidden h-full items-center gap-5 md:flex">
          {tabs.map((item) => {
            const active = isNavActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn("ct-tab", active && "ct-tab-active")}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <button
          type="button"
          className="ml-auto inline-flex size-8 items-center justify-center border border-rule text-foreground md:hidden"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X className="size-4" /> : <Menu className="size-4" />}
        </button>

        <nav
          aria-label="Account"
          className="ml-auto hidden h-full shrink-0 items-center gap-4 md:flex"
        >
          {accountIsLoading ? null : account.account ? (
            <ProfileMenu name={account.account.name} showPicks={features.picks} />
          ) : (
            <Link href={signInHref} className="ct-tab">
              Sign in
            </Link>
          )}
        </nav>
      </div>

      {menuOpen ? (
        <div className="border-t border-rule px-[14px] py-3 md:hidden">
          <nav aria-label="Primary mobile" className="flex flex-col gap-2">
            {tabs.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className={cn(
                  "type-nav py-1",
                  isNavActive(pathname, item.href) ? "font-semibold text-foreground" : "text-ink-2"
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          {mobileAccountLinks.length > 0 ? (
            <nav
              aria-label="Account mobile"
              className="mt-2 flex flex-col gap-2 border-t border-rule pt-2"
            >
              {mobileAccountLinks.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className="type-nav py-1 text-ink-2"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}

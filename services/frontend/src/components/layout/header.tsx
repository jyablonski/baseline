"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

import { ProfileMenu } from "@/components/account/profile-menu";
import { BaselineWordmark } from "@/components/brand/baseline-wordmark";
import { TeamLogo } from "@/components/team-logo";
import { useHydrated } from "@/hooks/use-hydrated";
import { useProfile } from "@/hooks/use-profile";
import { useAccount, useFeatures } from "@/lib/account";
import { isNavActive, primaryNav, teamHref } from "@/lib/nav";
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
  // Followed teams, in the order set on Account, as logo shortcuts to their pages.
  const { follows } = useProfile();
  const shortcuts =
    hydrated && account.account
      ? follows.flatMap((follow) =>
          follow.entity_type === "team" && follow.name
            ? [
                {
                  teamId: follow.entity_id,
                  name: follow.name,
                  abbreviation: follow.abbreviation,
                  href: teamHref(follow.name),
                },
              ]
            : []
        )
      : [];
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
        <Link href="/" aria-label="Baseline" className="mr-7 h-full shrink-0">
          <BaselineWordmark />
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

        {/* A sibling of the Account nav, not inside it, so landmarks don't nest. */}
        {shortcuts.length > 0 ? (
          <TeamShortcuts
            teams={shortcuts}
            pathname={pathname}
            label="Your teams"
            // The rule keeps the team logos from reading as a second avatar.
            className="ml-auto hidden border-r border-rule pr-3 md:flex"
          />
        ) : null}
        <nav
          aria-label="Account"
          className={cn(
            "hidden h-full shrink-0 items-center gap-4 md:flex",
            shortcuts.length === 0 && "ml-auto"
          )}
        >
          {accountIsLoading ? null : account.account ? (
            <ProfileMenu
              name={account.account.name}
              image={account.account.image}
              showPicks={features.picks}
            />
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
          {shortcuts.length > 0 ? (
            <div className="mt-2 border-t border-rule pt-2">
              <TeamShortcuts
                teams={shortcuts}
                pathname={pathname}
                label="Your teams mobile"
                onNavigate={() => setMenuOpen(false)}
              />
            </div>
          ) : null}
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

type TeamShortcut = {
  teamId: string;
  name: string;
  abbreviation: string | null;
  href: string;
};

function TeamShortcuts({
  teams,
  pathname,
  label,
  onNavigate,
  className = "flex",
}: {
  teams: TeamShortcut[];
  pathname: string;
  label: string;
  onNavigate?: () => void;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn("items-center gap-2", className)}>
      {teams.map((team) => {
        const current = pathname === team.href;
        return (
          <Link
            key={team.teamId}
            href={team.href}
            title={team.name}
            aria-label={team.name}
            aria-current={current ? "page" : undefined}
            onClick={onNavigate}
            className={cn(
              "inline-flex size-8 items-center justify-center rounded-full hover:bg-row-hover",
              current && "bg-tint"
            )}
          >
            <TeamLogo teamId={team.teamId} abbreviation={team.abbreviation} size={22} />
          </Link>
        );
      })}
    </nav>
  );
}

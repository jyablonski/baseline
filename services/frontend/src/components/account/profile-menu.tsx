"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { usePicks } from "@/hooks/use-picks";
import { signOutAndReload } from "@/lib/sign-out";
import { cn } from "@/lib/utils";

const ITEM =
  "block w-full px-[var(--ct-space-3)] py-2.5 text-left text-[var(--ct-fs-nav)] hover:bg-tint";

/** The signed-in visitor's avatar and name, opening a menu of their own pages. */
export function ProfileMenu({ name, showPicks }: { name: string | null; showPicks: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  // The header is on every page; the record is only read once the menu opens.
  const picks = usePicks({ fetch: open });
  const label = name || "Account";
  const summary = showPicks ? picks.sheet?.summary : undefined;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function signOut() {
    setSigningOut(true);
    await signOutAndReload();
  }

  return (
    <div ref={root} className="relative flex h-full items-center">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "ct-tab gap-2.5",
          (open || pathname === "/account" || pathname === "/picks") && "ct-tab-active"
        )}
      >
        <span
          aria-hidden="true"
          className="inline-flex size-7 items-center justify-center rounded-full bg-primary text-[var(--ct-fs-meta)] font-semibold text-primary-foreground"
        >
          {label.trim().charAt(0).toUpperCase()}
        </span>
        <span className="max-w-[14ch] truncate font-semibold">{label}</span>
        <span aria-hidden="true" className="text-[10px] text-ink-3">
          ▼
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Your account"
          className="absolute top-full right-0 z-30 w-[290px] border border-rule-strong bg-raised"
        >
          <div className="border-b border-rule px-[var(--ct-space-3)] py-3">
            <p className="truncate font-semibold">{label}</p>
            {summary ? (
              <p className="type-caption mt-0.5" data-testid="profile-record">
                {summary.wins}–{summary.losses} · {summary.pending} open{" "}
                {summary.pending === 1 ? "pick" : "picks"}
              </p>
            ) : null}
          </div>
          {showPicks ? (
            <Link href="/picks" role="menuitem" className={ITEM} onClick={() => setOpen(false)}>
              Your picks
            </Link>
          ) : null}
          <Link href="/account" role="menuitem" className={ITEM} onClick={() => setOpen(false)}>
            Account
          </Link>
          <button
            type="button"
            role="menuitem"
            disabled={signingOut}
            onClick={() => void signOut()}
            className={cn(ITEM, "border-t border-rule text-ink-2")}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

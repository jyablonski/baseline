import { Fragment } from "react";
import Link from "next/link";

import { CONTACT_EMAIL } from "@/lib/contact";

const FOOTER_LINKS = [
  { href: "/about", label: "About" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: `mailto:${CONTACT_EMAIL}`, label: "Contact" },
];

export function Footer() {
  return (
    <footer className="border-t border-rule">
      <div className="mx-auto w-full max-w-[1280px] px-[14px] pt-6 pb-7 text-center sm:px-6">
        <nav
          aria-label="Footer"
          className="flex items-center justify-center gap-3 text-sm text-ink-2"
        >
          {FOOTER_LINKS.map((item, index) => (
            <Fragment key={item.href}>
              {index > 0 ? (
                <span aria-hidden="true" className="text-ink-3">
                  ·
                </span>
              ) : null}
              {/* next/link is for routes; the mailto is a plain anchor. */}
              {item.href.startsWith("/") ? (
                <Link href={item.href} className="hover:text-foreground">
                  {item.label}
                </Link>
              ) : (
                <a href={item.href} className="hover:text-foreground">
                  {item.label}
                </a>
              )}
            </Fragment>
          ))}
        </nav>
        <p className="mt-1.5 text-[length:var(--ct-fs-num)] text-ink-3">
          Not affiliated with the NBA or its teams.
        </p>
      </div>
    </footer>
  );
}

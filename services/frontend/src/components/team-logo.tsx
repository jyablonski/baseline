import { useState } from "react";
import Link from "next/link";

import { teamLogoLabel, teamLogoUrl } from "@/lib/team-logo";
import { cn } from "@/lib/utils";

// One size for every logo that sits beside a team name in a row or list, so
// tables line up across pages. Only pass `size` for something that is not a
// row, like a page header.
export const TEAM_LOGO_SIZE = 24;

export function TeamLogo({
  teamId,
  abbreviation,
  size = TEAM_LOGO_SIZE,
  className,
}: {
  teamId: string | null | undefined;
  abbreviation?: string | null;
  size?: number;
  className?: string;
}) {
  const logoUrl = teamLogoUrl(abbreviation);
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);

  if (!teamId) return null;
  if (!logoUrl || failedLogoUrl === logoUrl) {
    return (
      <span
        aria-hidden="true"
        style={{ width: size, height: size }}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full bg-muted text-[8px] font-bold text-muted-foreground",
          className
        )}
      >
        {teamLogoLabel(abbreviation)}
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={cn("inline-flex shrink-0 items-center justify-center", className)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- NBA CDN supplies the SVG logo. */}
      <img
        src={logoUrl}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        className="h-full w-full object-contain"
        onError={() => setFailedLogoUrl(logoUrl)}
      />
    </span>
  );
}

export function TeamAbbrLink({
  teamId,
  abbreviation,
  href,
  size,
  className,
}: {
  teamId: string;
  abbreviation: string;
  href: string;
  size?: number;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn("inline-flex items-center gap-1.5 font-semibold hover:text-primary", className)}
    >
      <TeamLogo teamId={teamId} abbreviation={abbreviation} size={size} />
      {abbreviation}
    </Link>
  );
}

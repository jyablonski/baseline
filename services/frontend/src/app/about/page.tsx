import { RefreshTime } from "@/components/layout/refresh-time";
import { Section } from "@/components/layout/section";
import { commitUrl, shortSha } from "@/lib/version";

const SOURCE_URL = {
  bref: "https://www.basketball-reference.com",
  odds: "https://the-odds-api.com",
  reddit: "https://www.reddit.com/r/nba",
};

// Rendered per request so the Eastern default follows daylight saving rather
// than whichever side of it the build ran on.
export const dynamic = "force-dynamic";

export default function AboutPage() {
  const sha = shortSha();
  const href = commitUrl();

  return (
    <article className="space-y-8">
      <header>
        <h1 className="type-page">About</h1>
        <p className="type-prose mt-1">
          An NBA analytics app covering box scores, player and team stats, contract snapshots,
          betting odds, and Elo-based win predictions, updated daily throughout the season.
        </p>
      </header>

      <Section title="Sources">
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>
            <SourceLink href={SOURCE_URL.bref}>Basketball-Reference</SourceLink>: teams, players,
            the season slate, box scores, standings, PBP, remaining-year player salaries, team
            payroll, and the current injury report.
          </li>
          <li>
            <SourceLink href={SOURCE_URL.odds}>The Odds API</SourceLink>: upcoming NBA game
            moneylines and spreads.
          </li>
          <li>
            <SourceLink href={SOURCE_URL.reddit}>Reddit</SourceLink>: r/nba posts and their top
            comments.
          </li>
        </ul>
      </Section>

      <Section title="How the data gets here">
        <p>
          The sources are scraped everyday around <RefreshTime />, picking up the previous
          day&apos;s games and the upcoming slate. The data is then transformed and enriched into
          analytics tables and served out over this app.
        </p>
        <p className="mt-3">
          Coverage defaults to the latest season only. Preseason games are not included.
        </p>
      </Section>

      <Section title="Developer">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo/profile.png"
            alt="Jacob Yablonski"
            width={72}
            height={72}
            className="h-18 w-18 rounded-full border border-rule object-cover"
          />
          <div>
            <p className="font-medium text-foreground">Jacob Yablonski</p>
            <p className="mt-1 flex gap-3">
              <a
                className="underline underline-offset-2"
                href="https://github.com/jyablonski"
                target="_blank"
                rel="noreferrer"
              >
                GitHub
              </a>
              <a
                className="underline underline-offset-2"
                href="https://www.linkedin.com/in/jacobyablonski/"
                target="_blank"
                rel="noreferrer"
              >
                LinkedIn
              </a>
            </p>
          </div>
        </div>
      </Section>

      <Section title="Version">
        {href ? (
          <a className="underline underline-offset-2" href={href} target="_blank" rel="noreferrer">
            {sha}
          </a>
        ) : (
          <p>{sha}</p>
        )}
      </Section>
    </article>
  );
}

// Bold like the plain labels it replaced, plus the underline the other outbound
// links in this page use.
function SourceLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      className="font-medium text-foreground underline underline-offset-2"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  );
}

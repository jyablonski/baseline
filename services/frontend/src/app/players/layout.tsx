import type { Metadata } from "next";

// Re-declare the root template: a plain string title here would otherwise drop it
// for child segments like /players/compare.
export const metadata: Metadata = {
  title: { default: "Players", template: "%s — Baseline" },
};

export default function PlayersLayout({ children }: { children: React.ReactNode }) {
  return children;
}

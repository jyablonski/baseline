import type { Metadata } from "next";

// Reachable by URL but not linked from the nav or footer yet, so keep it out of
// search results until it has a place in the app.
export const metadata: Metadata = {
  title: "About the data",
  robots: { index: false, follow: false },
};

export default function DataLayout({ children }: { children: React.ReactNode }) {
  return children;
}

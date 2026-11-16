import type { Metadata } from "next";

// Linked from the About page, not the nav or footer.
export const metadata: Metadata = {
  title: "About the data",
  description:
    "Where every number on Baseline comes from, what it adds on top, and how its scores and win models are calculated.",
};

export default function DataLayout({ children }: { children: React.ReactNode }) {
  return children;
}

import type { Metadata } from "next";

export const metadata: Metadata = { title: "Social" };

export default function SocialLayout({ children }: { children: React.ReactNode }) {
  return children;
}

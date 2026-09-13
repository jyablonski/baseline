import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Source_Sans_3 } from "next/font/google";
import { Suspense } from "react";

import { Header } from "@/components/layout/header";
import { Providers } from "@/components/providers";

import "@/app/globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const sourceSans = Source_Sans_3({
  variable: "--font-source-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: {
    default: "Baseline",
    // Page first, brand last: tabs truncate from the right and screen readers
    // announce the page before the site.
    template: "%s — Baseline",
  },
  description: "Box scores, game logs, and splits.",
  applicationName: "Baseline",
  openGraph: {
    title: "Baseline",
    description: "Box scores, game logs, and splits.",
    siteName: "Baseline",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${plexSans.variable} ${sourceSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background font-sans text-foreground">
        <Providers>
          <div className="flex min-h-screen flex-col">
            <Suspense
              fallback={
                <header className="h-[var(--ct-header-h-sm)] border-b border-rule-strong bg-raised sm:h-[var(--ct-header-h)]" />
              }
            >
              <Header />
            </Suspense>
            <main className="mx-auto w-full max-w-[1280px] flex-1 px-[14px] py-[26px] sm:px-6">
              {children}
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}

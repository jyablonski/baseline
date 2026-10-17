import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page not found",
};

// Also catches every unmatched URL. Without this file Next renders its own 404,
// which follows the OS color scheme and comes out black on a dark system.
export default function NotFound() {
  return (
    <div className="py-24 text-center">
      <h1 className="type-page">404 — Page not found</h1>
    </div>
  );
}

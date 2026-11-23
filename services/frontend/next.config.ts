import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  output: "standalone",
  // Schedule and Past Games merged into /games. Query params pass through, so
  // /schedule?date=… lands on that day. /past-games needs the latest day with
  // finals, so it is a page (app/past-games), not a rule here.
  async redirects() {
    return [{ source: "/schedule", destination: "/games", permanent: false }];
  },
  typescript: {
    tsconfigPath: "tsconfig.build.json",
  },
};

export default nextConfig;

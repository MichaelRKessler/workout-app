import type { NextConfig } from "next";
import { securityHeaders } from "./lib/securityHeaders";

const nextConfig: NextConfig = {
  env: {
    // Names the service worker's cache. Each build gets its own, so activate
    // purges older caches on any host, not only on Vercel.
    SHELL_BUILD_ID:
      process.env.VERCEL_DEPLOYMENT_ID ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      `build-${Date.now().toString(36)}`,
  },
  experimental: {
    // Pages are thin server shells around client screens that read live data
    // from Convex, so a visited or prefetched page can be reused for a few
    // minutes. Switching tabs then skips a server round trip.
    staleTimes: {
      dynamic: 180,
      static: 300,
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;

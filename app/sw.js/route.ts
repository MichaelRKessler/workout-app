import { shellCacheName } from "@/lib/pwa/cachePolicy";
import { serviceWorkerSource } from "@/lib/pwa/serviceWorkerSource";

export function GET() {
  const buildId =
    process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || "v2";
  return new Response(serviceWorkerSource(shellCacheName(buildId)), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, max-age=0, must-revalidate",
      "Service-Worker-Allowed": "/",
    },
  });
}

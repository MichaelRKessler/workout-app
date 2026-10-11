import { serviceWorkerSource } from "@/lib/pwa/serviceWorkerSource";

export function GET() {
  return new Response(serviceWorkerSource(), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, max-age=0, must-revalidate",
      "Service-Worker-Allowed": "/",
    },
  });
}

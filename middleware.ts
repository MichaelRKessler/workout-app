import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";
import { NextFetchEvent, NextRequest, NextResponse } from "next/server";
import { safeNextPath } from "./lib/safeNext";

const isSignInPage = createRouteMatcher(["/signin"]);
const isProtectedRoute = createRouteMatcher([
  "/",
  "/history(.*)",
  "/exercises(.*)",
  "/body(.*)",
  "/routines(.*)",
  "/start(.*)",
  "/settings",
]);

const authMiddleware = convexAuthNextjsMiddleware(
  async (request, { convexAuth }) => {
    if (isSignInPage(request) && (await convexAuth.isAuthenticated())) {
      const next = safeNextPath(
        request.nextUrl.searchParams.get("next"),
        request.nextUrl.origin,
      );
      return nextjsMiddlewareRedirect(request, next);
    }
    if (isProtectedRoute(request) && !(await convexAuth.isAuthenticated())) {
      const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
      if (next === "/") {
        return nextjsMiddlewareRedirect(request, "/signin");
      }
      return nextjsMiddlewareRedirect(
        request,
        `/signin?next=${encodeURIComponent(next)}`,
      );
    }
    return undefined;
  },
  { cookieConfig: { maxAge: 60 * 60 * 24 * 30 } },
);

export default function middleware(
  request: NextRequest,
  event: NextFetchEvent,
) {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return NextResponse.next();
  }
  return authMiddleware(request, event);
}

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};

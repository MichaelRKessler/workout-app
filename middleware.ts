import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";
import { NextFetchEvent, NextRequest, NextResponse } from "next/server";

const isSignInPage = createRouteMatcher(["/signin"]);
const isProtectedRoute = createRouteMatcher([
  "/",
  "/history(.*)",
  "/exercises(.*)",
  "/body(.*)",
  "/settings",
]);

const authMiddleware = convexAuthNextjsMiddleware(
  async (request, { convexAuth }) => {
    if (isSignInPage(request) && (await convexAuth.isAuthenticated())) {
      return nextjsMiddlewareRedirect(request, "/");
    }
    if (isProtectedRoute(request) && !(await convexAuth.isAuthenticated())) {
      return nextjsMiddlewareRedirect(request, "/signin");
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

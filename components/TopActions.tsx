"use client";

import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import Link from "next/link";

/** The account avatar, which is also the way into Settings. History lives in the tab bar. */
export function TopActions() {
  const viewer = useQuery(api.users.viewer);
  const initial = (viewer?.name || viewer?.email || "").trim().charAt(0).toUpperCase();

  return (
    <div className="-mr-1.5 flex items-center gap-0.5">
      <Link
        href="/settings"
        aria-label="Settings and account"
        className="flex size-11 items-center justify-center rounded-full hover:bg-fill-2"
      >
        <span className="flex size-8 items-center justify-center rounded-full bg-line text-sm font-semibold text-foreground">
          {initial || (
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="12" cy="8" r="3.5" />
              <path d="M5 20a7 7 0 0 1 14 0" />
            </svg>
          )}
        </span>
      </Link>
    </div>
  );
}

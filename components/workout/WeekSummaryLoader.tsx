"use client";

import { api } from "@/convex/_generated/api";
import { localWeekFirstDay, weekRange } from "@/convex/lib/week";
import { useQuery } from "convex/react";
import { useEffect, useState, type ReactNode } from "react";
import type { WeekSummary } from "./HomeView";

type Bounds = {
  weekStarts: number[];
  weekEndsAt: number;
};

function sameBounds(left: Bounds, right: Bounds): boolean {
  return (
    left.weekEndsAt === right.weekEndsAt &&
    left.weekStarts.length === right.weekStarts.length &&
    left.weekStarts.every((start, index) => start === right.weekStarts[index])
  );
}

/**
 * The weekly summary follows the viewer's calendar. The bounds only change
 * when the week rolls over, so the 30 second check does not re-render the
 * workout screen or resubscribe the query.
 */
export function WeekSummaryLoader({
  children,
}: {
  children: (summary: WeekSummary | null | undefined) => ReactNode;
}) {
  const [bounds, setBounds] = useState<Bounds | null>(null);

  useEffect(() => {
    function tick() {
      const week = weekRange(Date.now(), localWeekFirstDay(navigator.language));
      const next = { weekStarts: week.weekStarts, weekEndsAt: week.weekEndsAt };
      setBounds((prev) => (prev && sameBounds(prev, next) ? prev : next));
    }
    tick();
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const summary = useQuery(
    api.sessions.weeklySummary,
    bounds ? { weekStarts: bounds.weekStarts, weekEndsAt: bounds.weekEndsAt } : "skip",
  );
  return children(summary);
}

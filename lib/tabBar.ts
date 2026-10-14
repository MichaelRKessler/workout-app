/** The center tab fires this on Home; LogWorkout answers by opening the mic. */
export const LOG_EVENT = "workout:log";

/** From any other tab, the center button opens Home with this query flag set. */
export const LOG_PARAM = "log";

export type TabKey = "home" | "history" | "exercises" | "body";

/** Which tab a path belongs to. Settings and routines sit outside the tabs. */
export function activeTab(pathname: string): TabKey | null {
  if (pathname === "/") {
    return "home";
  }
  for (const [prefix, key] of [
    ["/history", "history"],
    ["/exercises", "exercises"],
    ["/body", "body"],
  ] as const) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return key;
    }
  }
  return null;
}

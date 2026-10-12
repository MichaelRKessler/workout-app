import { safeNextPath } from "./safeNext";

/** Progress page for an exercise, remembering where Back should return. */
export function exerciseLink(exerciseId: string, from: string): string | null {
  if (
    exerciseId.length === 0 ||
    exerciseId.startsWith("local:") ||
    exerciseId.startsWith("pending:")
  ) {
    return null;
  }
  return `/exercises/${encodeURIComponent(exerciseId)}?from=${encodeURIComponent(from)}`;
}

/** A same-app return path. Missing or unsafe values stay on History. */
export function exerciseBackHref(from: string | null): string {
  if (!from) {
    return "/history";
  }
  const safe = safeNextPath(from);
  if (safe === "/" && from !== "/") {
    return "/history";
  }
  return safe;
}

export function exerciseBackLabel(href: string): string {
  if (href === "/") {
    return "Back to workout";
  }
  if (href.startsWith("/history")) {
    return "Back to history";
  }
  if (href.startsWith("/exercises") || href.startsWith("/settings")) {
    return "Back";
  }
  return "Back";
}

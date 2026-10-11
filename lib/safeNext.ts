/** A same-app path to return to after sign-in. Anything else stays on home. */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || value.length > 200) {
    return "/";
  }
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return "/";
  }
  if (value.includes("://") || value.includes("\\") || value.includes("\0") || value.includes("@")) {
    return "/";
  }
  return value;
}

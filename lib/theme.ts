export type Theme = "light" | "dark";

export const THEME_COOKIE = "theme";

/** Page background per theme. Also used for the browser's theme-color. */
export const THEME_COLORS: Record<Theme, string> = {
  light: "#f7f7f5",
  dark: "#0e0f11",
};

export function parseTheme(value: string | null | undefined): Theme {
  return value === "dark" ? "dark" : "light";
}

export function themeCookie(theme: Theme): string {
  return `${THEME_COOKIE}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function appleStatusBarStyle(theme: Theme): "default" | "black" {
  return theme === "dark" ? "black" : "default";
}

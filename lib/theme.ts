export type Theme = "light" | "dark";

/** What the person picked. "system" follows the phone and is the default. */
export type ThemeChoice = Theme | "system";

export const THEME_COOKIE = "theme";

/** Page background per theme. Also used for the browser's theme-color. */
export const THEME_COLORS: Record<Theme, string> = {
  light: "#f7f7f5",
  dark: "#0e0f11",
};

export function parseTheme(value: string | null | undefined): ThemeChoice {
  return value === "dark" || value === "light" ? value : "system";
}

export function themeCookie(theme: ThemeChoice): string {
  return `${THEME_COOKIE}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function appleStatusBarStyle(theme: ThemeChoice): "default" | "black" {
  return theme === "dark" ? "black" : "default";
}

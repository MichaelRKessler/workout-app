"use client";

import {
  appleStatusBarStyle,
  parseTheme,
  THEME_COLORS,
  themeCookie,
  type Theme,
} from "@/lib/theme";
import { useCallback, useEffect, useState } from "react";

function readTheme(): Theme {
  return parseTheme(document.documentElement.dataset.theme);
}

/** The saved theme lives in a cookie so the server renders the right one on the first paint. */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    setThemeState(readTheme());
  }, []);

  const setTheme = useCallback((next: Theme) => {
    const root = document.documentElement;
    root.dataset.theme = next;
    document.cookie = themeCookie(next);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", THEME_COLORS[next]);
    document
      .querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
      ?.setAttribute("content", appleStatusBarStyle(next));
    setThemeState(next);
  }, []);

  return { theme, setTheme };
}

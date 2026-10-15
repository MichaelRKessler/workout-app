"use client";

import {
  appleStatusBarStyle,
  parseTheme,
  THEME_COLORS,
  themeCookie,
  type ThemeChoice,
} from "@/lib/theme";
import { useCallback, useEffect, useState } from "react";

function readTheme(): ThemeChoice {
  return parseTheme(document.documentElement.dataset.theme);
}

/** The saved theme lives in a cookie so the server renders the right one on the first paint. */
export function useTheme() {
  const [theme, setThemeState] = useState<ThemeChoice>("system");

  useEffect(() => {
    setThemeState(readTheme());
  }, []);

  const setTheme = useCallback((next: ThemeChoice) => {
    const root = document.documentElement;
    root.dataset.theme = next;
    document.cookie = themeCookie(next);
    // One theme-color tag per scheme: a fixed choice paints both, "system" lets each match.
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      const scheme = meta.getAttribute("media")?.includes("dark") ? "dark" : "light";
      meta.setAttribute("content", THEME_COLORS[next === "system" ? scheme : next]);
    }
    document
      .querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
      ?.setAttribute("content", appleStatusBarStyle(next));
    setThemeState(next);
  }, []);

  return { theme, setTheme };
}

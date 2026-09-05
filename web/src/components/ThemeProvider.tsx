"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { DEFAULT_THEME, isLightOnlyRoute, THEME_STORAGE_KEY, type Theme } from "@/lib/theme";

interface ThemeState {
  // What the user chose. Stays whatever they picked even while a light-only
  // screen is showing, so navigating from the landing page back into the app
  // restores dark rather than silently resetting it.
  theme: Theme;
  setTheme: (theme: Theme) => void;
  // True on a screen that ignores the preference (see isLightOnlyRoute).
  // The toggle reads this to explain itself rather than appearing broken.
  lightLocked: boolean;
}

const ThemeContext = createContext<ThemeState | null>(null);

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Always starts at the default so the server and the first client render
  // agree. The stored value is applied in the effect below; the inline script
  // in <head> has already put the class on <html> by then, so there is no
  // flash despite this starting light.
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);

  useEffect(() => {
    try {
      if (localStorage.getItem(THEME_STORAGE_KEY) === "dark") setThemeState("dark");
    } catch {
      // Storage unavailable (private mode, blocked cookies): stay light.
    }
  }, []);

  const lightLocked = isLightOnlyRoute(pathname);

  // The head script only runs on a full page load. This is what keeps the
  // class correct across client-side navigations, which is the whole reason
  // the landing page can stay light while the app behind it is dark.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", !lightLocked && theme === "dark");
  }, [theme, lightLocked]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Preference just won't survive a reload; the toggle still works now.
    }
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme, lightLocked }}>{children}</ThemeContext.Provider>;
}

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

export type Locale = "zh" | "en";
type Language = { locale: Locale; setLocale: (value: Locale) => void; t: (zh: string, en: string) => string };
const LocaleContext = createContext<Language | null>(null);
const localeStorageKey = "ally-ahead.locale";

function initialLocale(): Locale {
  try {
    return localStorage.getItem(localeStorageKey) === "zh" ? "zh" : "en";
  } catch {
    return "en";
  }
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, updateLocale] = useState<Locale>(initialLocale);
  const setLocale = useCallback((value: Locale) => {
    updateLocale(value);
    try {
      localStorage.setItem(localeStorageKey, value);
    } catch {
      // The language can still be changed for this visit.
    }
  }, []);
  const t = useCallback((zh: string, en: string) => locale === "zh" ? zh : en, [locale]);
  return <LocaleContext.Provider value={{ locale, setLocale, t }}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("LocaleProvider missing");
  return value;
}

import { createContext, useContext, useState, type ReactNode } from 'react';
export type Locale = 'zh' | 'en';
type Language = { locale: Locale; setLocale: (value:Locale)=>void; t:(zh:string,en:string)=>string };
const LocaleContext = createContext<Language | null>(null);
export function LocaleProvider({children}:{children:ReactNode}) {
  const [locale,setLocale] = useState<Locale>('zh');
  const value:Language = {locale,setLocale,t:(zh,en)=>locale==='zh'?zh:en};
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
export function useLocale(){const value=useContext(LocaleContext);if(!value)throw new Error('LocaleProvider missing');return value;}

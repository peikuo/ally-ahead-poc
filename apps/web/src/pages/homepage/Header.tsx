import type { RefObject } from "react";
import type { Copy, Locale } from "./content";
import { Wordmark } from "./primitives";

interface HeaderProps {
  poc?: boolean;
  t: Copy;
  locale: Locale;
  wordmark: string;
  menuOpen: boolean;
  solid: boolean;
  menuRef: RefObject<HTMLButtonElement | null>;
  onMenu: () => void;
  onLocale: (locale: Locale) => void;
  onNavigate: (id: string) => void;
  onLogin: () => void;
  onStart: () => void;
}

export function Header({
  poc = false,
  t,
  locale,
  wordmark,
  menuOpen,
  solid,
  menuRef,
  onMenu,
  onLocale,
  onNavigate,
  onLogin,
  onStart,
}: HeaderProps) {
  const language = (
    <div className="language" role="group" aria-label={t.localeOptionsLabel}>
      <button
        type="button"
        data-language="zh"
        aria-pressed={locale === "zh"}
        onClick={() => onLocale("zh")}
      >
        中文
      </button>
      <span aria-hidden="true">/</span>
      <button
        type="button"
        data-language="en"
        aria-pressed={locale === "en"}
        onClick={() => onLocale("en")}
      >
        EN
      </button>
    </div>
  );
  const navigation = (
    <>
      <a
        className="starting-link"
        href="#starting"
        onClick={(e) => {
          e.preventDefault();
          onNavigate("starting");
        }}
      >
        {t.scenariosNav}
      </a>
      <a
        className="road-link"
        href="#clarify"
        onClick={(e) => {
          e.preventDefault();
          onNavigate("clarify");
        }}
      >
        {t.road}
      </a>
      <a
        className="faq-link"
        href="#questions"
        onClick={(e) => {
          e.preventDefault();
          onNavigate("questions");
        }}
      >
        {t.faqNav}
      </a>
      {!poc ? (
        <a
          className="provider-link"
          href="#providers"
          onClick={(e) => {
            e.preventDefault();
            onNavigate("providers");
          }}
        >
          {t.providers}
        </a>
      ) : null}
    </>
  );
  return (
    <>
      <header
        className={`site-header${solid ? " scrolled" : ""}${menuOpen ? " menu-open" : ""}`}
      >
        <Wordmark src={wordmark} onHome={() => onNavigate("home")} />
        <nav aria-label={t.mainNavigation}>
          {navigation}
          {language}
          {!poc ? (
            <button type="button" data-entry="login" onClick={onLogin}>
              {t.login}
            </button>
          ) : null}
          <button type="button" className="header-start" onClick={onStart}>
            {t.directStart}
          </button>
        </nav>
        <button
          ref={menuRef}
          type="button"
          className="menu-button"
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          aria-label={menuOpen ? t.menuClose : t.menuOpen}
          onClick={onMenu}
        >
          <span />
          <span />
        </button>
      </header>
      <nav
        id="mobile-menu"
        className="mobile-menu"
        aria-label={t.mobileNavigation}
        hidden={!menuOpen}
      >
        {navigation}
        <div className="menu-language">{language}</div>
        {!poc ? (
          <button type="button" onClick={onLogin}>
            {t.login}
          </button>
        ) : null}
      </nav>
    </>
  );
}

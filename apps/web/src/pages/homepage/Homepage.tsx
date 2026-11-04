import { useCallback, useEffect, useRef, useState } from "react";
import { preload } from "react-dom";
import { defaultAssets } from "./assets";
import { messages, type Copy } from "./content";
import { pocMessages } from "./poc-content";
import { Header } from "./Header";
import { SceneExperience } from "./SceneExperience";
import { ContentHub } from "./ContentHub";
import {
  scenes,
  sceneAt,
  type HomepageProps,
  type SceneId,
  type StartContext,
  type ContentTab,
} from "./model";
import { useExperience } from "./useExperience";
import "./homepage.css";
import "./compact-content.css";

export function Homepage({
  poc = false,
  locale,
  onLocaleChange,
  onStart,
  onLogin,
  loginLabel,
  onProvider,
  interactionBlocked = false,
  assets = defaultAssets,
}: HomepageProps) {
  const baseCopy: Copy = loginLabel
    ? { ...messages[locale], login: loginLabel }
    : messages[locale];
  const t: Copy = poc ? { ...baseCopy, ...pocMessages[locale] } : baseCopy;
  const [menuOpen, setMenuOpen] = useState(false);
  const [contentTab, setContentTab] = useState<ContentTab>(() => {
    const hash = typeof window === "undefined" ? "" : window.location.hash;
    return hash === "#questions"
      ? "questions"
      : hash === "#providers" && !poc
        ? "providers"
        : "business";
  });
  const [scrolled, setScrolled] = useState(
    () => typeof window !== "undefined" && window.scrollY > 30,
  );
  const [expanded, setExpanded] = useState<{
    id: SceneId;
    pinned: boolean;
  } | null>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const closeDisclosure = useCallback(() => setExpanded(null), []);
  const resetContent = useCallback(() => setContentTab("business"), []);
  const experience = useExperience(
    assets,
    interactionBlocked || menuOpen,
    closeDisclosure,
    resetContent,
  );
  preload(assets[sceneAt(experience.activeIndex).asset], {
    as: "image",
    fetchPriority: "high",
  });

  useEffect(() => {
    const scroll = () => setScrolled(window.scrollY > 30);
    scroll();
    window.addEventListener("scroll", scroll, { passive: true });
    return () => window.removeEventListener("scroll", scroll);
  }, []);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest(".explain")) setExpanded(null);
      if (!event.target.closest(".site-header,#mobile-menu"))
        setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menuOpen) {
        setMenuOpen(false);
        menuRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [menuOpen]);

  const navigate = useCallback(
    (id: string) => {
      if (poc && id === "providers") return;
      setMenuOpen(false);
      setExpanded(null);
      const index = scenes.findIndex((scene) => scene.id === id);
      if (index >= 0) {
        void experience.goTo(index);
        experience.scrollToStage();
      } else {
        if (id === "starting" || id === "questions" || id === "providers") {
          setContentTab(id === "starting" ? "business" : id);
        }
        document
          .getElementById(
            ["starting", "questions", "providers"].includes(id)
              ? "starting"
              : id,
          )
          ?.scrollIntoView({
            behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
              ? "instant"
              : "smooth",
            block: "start",
          });
        window.history.replaceState(null, "", "#" + id);
      }
    },
    [experience.goTo, experience.scrollToStage, poc],
  );
  const start = (context: StartContext) => {
    setMenuOpen(false);
    setExpanded(null);
    onStart(context);
  };
  const login = () => {
    setMenuOpen(false);
    setExpanded(null);
    onLogin();
  };
  const provider = () => {
    setMenuOpen(false);
    setExpanded(null);
    onProvider();
  };

  return (
    <div className="ally-homepage" data-locale={locale}>
      <a
        className="skip-link"
        href="#starting"
        onClick={(event) => {
          event.preventDefault();
          navigate("starting");
        }}
      >
        {t.skipLink}
      </a>
      <Header
        poc={poc}
        t={t}
        locale={locale}
        wordmark={assets.wordmark}
        menuOpen={menuOpen}
        solid={scrolled || experience.activeIndex > 0}
        menuRef={menuRef}
        onMenu={() => setMenuOpen((value) => !value)}
        onLocale={(value) => {
          setExpanded(null);
          onLocaleChange(value);
        }}
        onNavigate={navigate}
        onLogin={login}
        onStart={() => start({ source: "header", locale })}
      />
      <main>
        <SceneExperience
          t={t}
          locale={locale}
          assets={assets}
          activeIndex={experience.activeIndex}
          visited={experience.visited}
          loading={experience.loading}
          imageError={experience.imageError}
          stageRef={experience.stageRef}
          expanded={expanded}
          onExpand={setExpanded}
          onNavigate={(index) => {
            setExpanded(null);
            void experience.goTo(index);
          }}
          onAdvance={experience.advance}
          onStart={start}
        />
        <ContentHub
          poc={poc}
          t={t}
          locale={locale}
          wordmark={assets.wordmark}
          activeTab={contentTab}
          onTabChange={(tab) => {
            setContentTab(tab);
            window.history.replaceState(
              null,
              "",
              "#" + (tab === "business" ? "starting" : tab),
            );
          }}
          onStart={start}
          onLogin={login}
          onProvider={provider}
          onNavigate={navigate}
        />
      </main>
    </div>
  );
}

import { useState, type KeyboardEvent } from "react";
import type { Copy, Locale } from "./content";
import {
  businessCases,
  questions,
  type ContentTab,
  type StartContext,
} from "./model";
import { Action, Lines, Wordmark } from "./primitives";

interface ContentHubProps {
  poc?: boolean;
  t: Copy;
  locale: Locale;
  wordmark: string;
  activeTab: ContentTab;
  onTabChange: (tab: ContentTab) => void;
  onStart: (context: StartContext) => void;
  onLogin: () => void;
  onProvider: () => void;
  onNavigate: (id: string) => void;
}

export function ContentHub({
  poc = false,
  t,
  locale,
  wordmark,
  activeTab,
  onTabChange,
  onStart,
  onLogin,
  onProvider,
  onNavigate,
}: ContentHubProps) {
  const tabOrder: readonly ContentTab[] = poc
    ? ["business", "questions"]
    : ["business", "questions", "providers"];
  const [openQuestion, setOpenQuestion] = useState<string | null>(null);
  const titles = {
    business: t.hubTitle,
    questions: t.faqTitle,
    providers: t.providerSectionTitle,
  };
  const labels = {
    business: t.scenariosTab,
    questions: t.faqNav,
    providers: t.providers,
  };
  const onTabKey = (
    event: KeyboardEvent<HTMLButtonElement>,
    tab: ContentTab,
  ) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const current = tabOrder.indexOf(tab);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabOrder.length - 1
          : (current +
              (event.key === "ArrowRight" ? 1 : -1) +
              tabOrder.length) %
            tabOrder.length;
    const nextTab = tabOrder[next] ?? "business";
    onTabChange(nextTab);
    document.getElementById("hub-tab-" + nextTab)?.focus();
  };

  return (
    <>
      <section
        id="starting"
        className="content-hub editorial"
        aria-labelledby="hub-title"
      >
        <div className="editorial-heading">
          <h2 id="hub-title">
            <Lines text={titles[activeTab]} />
          </h2>
          {activeTab === "providers" ? (
            <Action className="text-action" onClick={onProvider}>
              {t.providerEntry}
            </Action>
          ) : (
            <Action
              className="text-action"
              onClick={() => onStart({ source: "own-need", locale })}
            >
              {t.ownNeed}
            </Action>
          )}
        </div>
        <div className="hub-content">
          <div className="hub-tabs" role="tablist" aria-label={t.hubNavigation}>
            {tabOrder.map((tab) => (
              <button
                key={tab}
                id={"hub-tab-" + tab}
                type="button"
                role="tab"
                data-tab={tab}
                aria-selected={activeTab === tab}
                aria-controls={"hub-panel-" + tab}
                tabIndex={activeTab === tab ? 0 : -1}
                onKeyDown={(event) => onTabKey(event, tab)}
                onClick={() => onTabChange(tab)}
              >
                {labels[tab]}
              </button>
            ))}
          </div>
          {tabOrder.map((tab) => (
            <div
              key={tab}
              id={"hub-panel-" + tab}
              className="hub-panel"
              role="tabpanel"
              aria-labelledby={"hub-tab-" + tab}
              tabIndex={0}
              hidden={activeTab !== tab}
            >
              {tab === "business" ? (
                <div className="business-choices">
                  {businessCases.map((item, index) => (
                    <button
                      key={item.id}
                      type="button"
                      className="business-choice"
                      data-case={item.id}
                      onClick={() =>
                        onStart({
                          source: "business-case",
                          locale,
                          example: t[item.example],
                        })
                      }
                    >
                      <span className="row-number">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="choice-title">{t[item.title]}</span>
                      <span className="row-arrow" aria-hidden="true">
                        ↗
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
              {tab === "questions" ? (
                <div id="questions" className="faq-list">
                  {questions.map((item) => (
                    <details
                      key={item.id}
                      id={"faq-" + item.id}
                      open={openQuestion === item.id}
                    >
                      <summary
                        onClick={(event) => {
                          event.preventDefault();
                          setOpenQuestion((previous) =>
                            previous === item.id ? null : item.id,
                          );
                        }}
                      >
                        <span>{t[item.question]}</span>
                        <span className="plus" aria-hidden="true">
                          +
                        </span>
                      </summary>
                      <p>{t[item.answer]}</p>
                    </details>
                  ))}
                </div>
              ) : null}
              {tab === "providers" ? (
                <div id="providers" className="hub-provider">
                  <p className="provider-statement">
                    <Lines text={t.providerStatement} />
                  </p>
                  <a
                    className="quiet-action"
                    href="#questions"
                    onClick={(event) => {
                      event.preventDefault();
                      setOpenQuestion("private");
                      onTabChange("questions");
                    }}
                  >
                    {t.providerPrivacy}
                  </a>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>
      <footer className="site-footer footer-compact">
        <Wordmark src={wordmark} onHome={() => onNavigate("home")} />
        <nav aria-label={t.footerNavigation}>
          <a
            href="#clarify"
            onClick={(event) => {
              event.preventDefault();
              onNavigate("clarify");
            }}
          >
            {t.road}
          </a>
          <a
            href="#questions"
            onClick={(event) => {
              event.preventDefault();
              onNavigate("questions");
            }}
          >
            {t.faqNav}
          </a>
          {!poc ? (
            <a
              href="#providers"
              onClick={(event) => {
                event.preventDefault();
                onNavigate("providers");
              }}
            >
              {t.providers}
            </a>
          ) : null}
          {!poc ? (
            <button type="button" onClick={onLogin}>
              {t.login}
            </button>
          ) : null}
        </nav>
        <a
          className="back-top"
          href="#home"
          onClick={(event) => {
            event.preventDefault();
            onNavigate("home");
          }}
        >
          {t.back}
        </a>
      </footer>
    </>
  );
}

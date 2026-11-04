import {
  Component,
  createContext,
  Suspense,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { AppLink } from "../../app/router";
import { Brand } from "../../components/Brand";
import { useLocale } from "../../locales/context";
import "./reception-entry.css";

const EntryStarted = createContext<number | null>(null);

class EntryBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <ReceptionLoading failed />
    ) : (
      this.props.children
    );
  }
}

// Keep one start time across the chunk fallback and the initial session read.
export function ReceptionTransition({ children }: { children: ReactNode }) {
  const [started] = useState(() => performance.now());
  return (
    <EntryStarted.Provider value={started}>
      <EntryBoundary>
        <Suspense fallback={<ReceptionLoading phase="page" />}>
          {children}
        </Suspense>
      </EntryBoundary>
    </EntryStarted.Provider>
  );
}

export function ReceptionLoading({
  phase = "session",
  failed = false,
}: {
  phase?: "page" | "session";
  failed?: boolean;
}) {
  const { locale, setLocale, t } = useLocale();
  const inheritedStart = useContext(EntryStarted);
  const [localStart] = useState(() => performance.now());
  const started = inheritedStart ?? localStart;
  const [visible, setVisible] = useState(
    () => failed || performance.now() - started >= 180,
  );
  useEffect(() => {
    const timer = setTimeout(
      () => setVisible(true),
      Math.max(0, 180 - (performance.now() - started)),
    );
    return () => clearTimeout(timer);
  }, [started]);
  return (
    <div
      className="reception-entry-loading"
      data-phase={failed ? "failed" : phase}
      data-visible={visible || failed}
    >
      <header className="reception-entry-header">
        <Brand />
        <button
          type="button"
          className="quiet"
          onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
        >
          {locale === "zh" ? "EN" : "中文"}
        </button>
      </header>
      <div className="reception-entry-body">
        <div className="reception-entry-content">
          <div className="reception-entry-portal" aria-hidden="true">
            <i />
            <span />
          </div>
          <h1>
            {failed
              ? t("接待页面暂未打开", "Reception couldn’t open")
              : t("准备开始交流", "Getting ready to talk")}
          </h1>
          <p className="reception-entry-intro">
            {failed
              ? t(
                  "请重试，或先返回首页。",
                  "Try again, or return to the homepage.",
                )
              : t(
                  "从一个具体问题开始，就好。",
                  "One question is enough to begin.",
                )}
          </p>
          <p
            className="reception-entry-status"
            role={failed ? "alert" : "status"}
            aria-live="polite"
            aria-atomic="true"
          >
            {!failed ? <i aria-hidden="true" /> : null}
            {failed
              ? t("页面资源未能加载。", "Page resources could not be loaded.")
              : phase === "page"
                ? t("正在打开接待页面…", "Opening reception…")
                : t("正在连接接待…", "Connecting to reception…")}
          </p>
          <div className="reception-entry-actions">
            {failed ? (
              <button
                type="button"
                className="primary"
                onClick={() => location.reload()}
              >
                {t("重新打开", "Try again")}
              </button>
            ) : null}
            <AppLink href="/" className="text-link">
              {t("返回首页", "Back to home")} <span aria-hidden="true">↗</span>
            </AppLink>
          </div>
        </div>
      </div>
    </div>
  );
}

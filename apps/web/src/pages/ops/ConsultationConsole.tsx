import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TraceViewerFilters,
  decodeReceptionPresentation,
  type TraceViewerFilterInput,
  type TraceViewerSessionView,
  type TraceViewerRunView,
  type TraceViewerEventView,
  type TraceViewerEventDetailView,
} from "@ally-ahead/contracts";
import { Brand } from "../../components/Brand";
import { useLocale } from "../../locales/context";
import { ReceptionMessage } from "../reception/ReceptionMessage";
import { ReceptionMarkdown } from "../reception/ReceptionMarkdown";
import "../reception/reception.css";
import { consultationOps } from "./ops-api";
import { OpsReadError } from "./ops-reader";
import {
  opsTime,
  opsState,
  opsDuration,
  opsNumber,
  opsEvent,
} from "./ops-display";
import "./consultations.css";

type Detail = TraceViewerEventDetailView;
type Page<T> = { items: T[]; nextCursor: string | null };
const savedKinds = new Set([
  "runtime_started",
  "delivery_saved",
  "assistant_saved",
  "final_saved",
  "runtime_completed",
  "runtime_failed",
]);
const noop = () => {};

function Empty({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="ops-empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}
function Pager({
  next,
  busy,
  onNext,
  onFirst,
}: {
  next: string | null;
  busy: boolean;
  onNext: (cursor: string) => void;
  onFirst: () => void;
}) {
  const { t } = useLocale();
  return (
    <div className="ops-pager">
      <button disabled={busy} onClick={onFirst}>
        {t("回到首批", "First page")}
      </button>
      <button disabled={!next || busy} onClick={() => next && onNext(next)}>
        {t("下一批", "Next page")} →
      </button>
    </div>
  );
}
function RawEvent({
  event,
  detail,
  loading,
  onRead,
  error,
}: {
  event: TraceViewerEventView;
  detail?: Detail;
  loading: boolean;
  onRead: () => void;
  error?: string;
}) {
  const { t, locale } = useLocale();
  const meta = opsEvent(event.type, t);
  const [offset, setOffset] = useState(0);
  const raw = useMemo(
    () => (detail ? JSON.stringify(detail.data, null, 2) : ""),
    [detail],
  );
  return (
    <article
      className="ops-event"
      data-tone={meta.tone}
      data-event-id={event.eventId}
    >
      <span className="ops-event-icon" aria-hidden="true">
        {meta.icon}
      </span>
      <div className="ops-event-title">
        <span>{meta.label}</span>
        <time dateTime={event.at} title={event.at}>
          {opsTime(event.at, locale)}
        </time>
      </div>
      <p className="ops-event-type">
        #{event.sequence} · {event.type}
      </p>
      <details
        onToggle={(e) => {
          if (e.currentTarget.open && !detail && !loading) onRead();
        }}
      >
        <summary>
          {t("记录详情 · 按需读取", "Record detail · load on demand")}
        </summary>
        {loading ? (
          <p role="status">{t("正在读取…", "Reading…")}</p>
        ) : error ? (
          <p className="ops-error">
            {error} <button onClick={onRead}>{t("重试", "Retry")}</button>
          </p>
        ) : detail ? (
          <>
            <p className="ops-event-type">
              {t("记录耗时", "Recorded duration")}:{" "}
              {opsDuration(
                typeof detail.data.durationMs === "number"
                  ? detail.data.durationMs
                  : null,
                t,
              )}
            </p>
            <pre>{raw.slice(offset, offset + 16000)}</pre>
            {raw.length > 16000 ? (
              <div className="ops-raw-pages">
                <button
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - 16000))}
                >
                  {t("上一段", "Previous segment")}
                </button>
                <span>
                  {offset + 1}–{Math.min(offset + 16000, raw.length)} /{" "}
                  {raw.length}
                </span>
                <button
                  disabled={offset + 16000 >= raw.length}
                  onClick={() => setOffset(offset + 16000)}
                >
                  {t("下一段", "Next segment")}
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </details>
    </article>
  );
}
function SavedMessage({ event }: { event: Detail }) {
  const { t } = useLocale();
  const user = event.type === "runtime_started";
  const text = user ? event.data.inputText : event.data.text;
  if (typeof text !== "string")
    return (
      <p className="ops-event-type">
        {t(
          "这条保存记录未包含可回放文字。",
          "This saved record has no replayable text.",
        )}
      </p>
    );
  if (text.length > 64000)
    return (
      <article
        className="ops-message"
        data-author={user ? "user" : "assistant"}
      >
        <p className="ops-message-label">
          {t("已保存长记录 · 有限预览", "Saved long record · bounded preview")}
        </p>
        <pre className="ops-long-saved">{text.slice(0, 16000)}</pre>
        <p className="ops-event-type">
          {t(
            "这里只预览前 16000 字符；完整原文请在右侧详情中分段读取。",
            "Previewing the first 16,000 characters. Read the full text in segments in the event detail.",
          )}
        </p>
      </article>
    );
  const presentation = !user ? decodeReceptionPresentation(text) : null;
  const document =
    presentation?.interaction?.type === "requirements_document"
      ? presentation.interaction
      : null;
  return (
    <article className="ops-message" data-author={user ? "user" : "assistant"}>
      <div className="ops-message-label">
        <b>{user ? t("访客", "Guest") : t("接待", "Reception")}</b>
        <span>
          {user
            ? ""
            : event.type === "delivery_saved"
              ? t("中间交付 · 已保存", "Intermediate · saved")
              : t("最终答复 · 保存记录", "Final reply · saved record")}
        </span>
      </div>
      <div className="ops-message-body">
        {document ? (
          <>
            <ReceptionMarkdown text={presentation?.speech ?? ""} />
            <details className="ops-document">
              <summary>{document.title}</summary>
              <ReceptionMarkdown text={document.markdown} />
            </details>
          </>
        ) : (
          <ReceptionMessage
            text={text}
            assistant={!user}
            interactive={false}
            onAnswer={noop}
            onCompose={noop}
          />
        )}
        {presentation?.progress ? (
          <aside className="ops-saved-achievement">
            <strong>
              {"title" in presentation.progress
                ? presentation.progress.title
                : t("已保存成果记录", "Saved achievement record")}
            </strong>
            {"summary" in presentation.progress ? (
              <p>{presentation.progress.summary}</p>
            ) : (
              <pre>{JSON.stringify(presentation.progress, null, 2)}</pre>
            )}
            <details>
              <summary>{t("依据记录 ID", "Evidence record IDs")}</summary>
              <pre>{presentation.progress.evidenceMessageIds.join("\n")}</pre>
            </details>
          </aside>
        ) : null}
      </div>
    </article>
  );
}

export default function ConsultationConsole() {
  const { t, locale, setLocale } = useLocale();
  const token = useRef<string | null>(null);
  const requests = useRef(new Set<AbortController>());
  const generation = useRef(0);
  const [draft, setDraft] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [sessions, setSessions] = useState<Page<TraceViewerSessionView> | null>(
    null,
  );
  const [runs, setRuns] = useState<Page<TraceViewerRunView> | null>(null);
  const [events, setEvents] = useState<Page<TraceViewerEventView> | null>(null);
  const [eventCursor, setEventCursor] = useState<string | undefined>();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [run, setRun] = useState<TraceViewerRunView | null>(null);
  const [details, setDetails] = useState<Record<string, Detail>>({});
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const [filters, setFilters] = useState<TraceViewerFilterInput>({ limit: 20 });
  const [pane, setPane] = useState("sessions");
  const [replayed, setReplayed] = useState(false);
  const secure = (location.protocol === "https:" || ["localhost","127.0.0.1","[::1]"].includes(location.hostname));
  const resetReaders = useCallback(() => {
    generation.current++;
    for (const controller of requests.current) controller.abort();
    requests.current.clear();
    setBusy([]);
  }, []);
  const clear = useCallback(() => {
    resetReaders();
    token.current = null;
    setDraft("");
    setUnlocked(false);
    setSessions(null);
    setRuns(null);
    setEvents(null);
    setSessionId(null);
    setRun(null);
    setDetails({});
    setDetailErrors({});
    setReplayed(false);
    setError("");
    setFilters({ limit: 20 });
  }, [resetReaders]);
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Ally Ahead · Consultation replay";
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex,nofollow";
    document.head.append(robots);
    const lock = () => clear();
    addEventListener("pagehide", lock);
    return () => {
      removeEventListener("pagehide", lock);
      robots.remove();
      document.title = previousTitle;
      token.current = null;
      generation.current++;
      for (const c of requests.current) c.abort();
      requests.current.clear();
    };
  }, [clear]);
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);
  function describe(failure: unknown) {
    if (!(failure instanceof OpsReadError))
      return t("读取失败，请重试。", "Could not read the record. Try again.");
    if ([401, 403].includes(failure.status))
      return t(
        "令牌无效或已失效，已清除本页记录，请重新输入。",
        "The token is invalid or expired. Records were cleared; enter a token again.",
      );
    if (failure.status === 429)
      return t(
        "读取过于频繁，请稍后再试。",
        "Too many reads. Wait a moment and try again.",
      );
    if (failure.status === 404)
      return t(
        "回放服务未启用，或该记录不可读取。",
        "Replay is not enabled, or this record is unavailable.",
      );
    if (failure.kind === "https")
      return t("请通过 HTTPS 打开此页面。", "Open this page over HTTPS.");
    if (failure.kind === "response")
      return t(
        "返回记录格式不符，未显示该内容。",
        "The response format is invalid. Its contents were not shown.",
      );
    return t(
      "连接中断或服务暂不可用，请重试读取。",
      "The connection or service is unavailable. Retry the read.",
    );
  }
  async function read<T>(
    key: string,
    loader: (value: string, signal: AbortSignal) => Promise<T>,
    accept: (data: T) => void,
  ): Promise<T | undefined> {
    if (!token.current) return;
    const epoch = generation.current,
      controller = new AbortController();
    requests.current.add(controller);
    setBusy((old) => [...old, key]);
    try {
      const data = await loader(token.current, controller.signal);
      if (controller.signal.aborted || epoch !== generation.current) return;
      accept(data);
      return data;
    } catch (failure) {
      if (controller.signal.aborted || epoch !== generation.current) return;
      const message = describe(failure);
      if (
        failure instanceof OpsReadError &&
        [401, 403].includes(failure.status)
      )
        clear();
      if (key.startsWith("detail:"))
        setDetailErrors((old) => ({ ...old, [key.slice(7)]: message }));
      setError(message);
    } finally {
      requests.current.delete(controller);
      if (epoch === generation.current)
        setBusy((old) => old.filter((item) => item !== key));
    }
  }
  function loadSessions(input = filters, cursor?: string) {
    resetReaders();
    setError("");
    setSessions(null);
    setRuns(null);
    setEvents(null);
    setSessionId(null);
    setRun(null);
    setDetails({});
    setReplayed(false);
    setPane("sessions");
    return read(
      "sessions",
      (value, signal) =>
        consultationOps.sessions(value, { ...input, cursor }, signal),
      (page) => {
        setSessions(page);
        setUnlocked(true);
      },
    );
  }
  function loadRuns(id: string, cursor?: string) {
    resetReaders();
    setError("");
    setSessionId(id);
    setRun(null);
    setEvents(null);
    setRuns(null);
    setDetails({});
    setReplayed(false);
    setPane("replay");
    void read(
      "runs",
      (value, signal) =>
        consultationOps.runs(value, id, { ...filters, cursor }, signal),
      setRuns,
    );
  }
  function loadEvents(selected: TraceViewerRunView, cursor?: string) {
    resetReaders();
    setError("");
    setRun(selected);
    setEventCursor(cursor);
    setEvents(null);
    setDetails({});
    setDetailErrors({});
    setReplayed(false);
    void read(
      "events",
      (value, signal) =>
        consultationOps.events(value, selected.runId, cursor, signal),
      setEvents,
    );
  }
  function loadDetail(event: TraceViewerEventView) {
    if (details[event.eventId]) return Promise.resolve(details[event.eventId]);
    setDetailErrors((old) => {
      const next = { ...old };
      delete next[event.eventId];
      return next;
    });
    setError("");
    return read(
      `detail:${event.eventId}`,
      (value, signal) =>
        consultationOps.detail(value, event.runId, event.eventId, signal),
      (detail) => setDetails((old) => ({ ...old, [event.eventId]: detail })),
    );
  }
  async function replay() {
    const epoch = generation.current;
    setReplayed(true);
    const eligible =
      events?.items.filter((event) => savedKinds.has(event.type)) ?? [];
    for (let i = 0; i < eligible.length; i += 3) {
      if (generation.current !== epoch) return;
      await Promise.all(eligible.slice(i, i + 3).map(loadDetail));
    }
  }
  const completion = Object.values(details).find((item) =>
    ["runtime_completed", "runtime_failed"].includes(item.type),
  );
  const duration =
    typeof completion?.data.durationMs === "number"
      ? completion.data.durationMs
      : null;
  const modelRequests =
    typeof completion?.data.modelRequests === "number"
      ? completion.data.modelRequests
      : null;
  const completeIndex =
    run &&
    events &&
    !events.nextCursor &&
    events.items.length === run.lastSequence &&
    events.items[0]?.sequence === 1;
  const corrections = completeIndex
    ? events.items.filter((item) => item.type === "output_correction").length
    : null;
  const indexGap = Boolean(
    run &&
    events &&
    ((!eventCursor &&
      run.lastSequence > 0 &&
      events.items[0]?.sequence !== 1) ||
      events.items.some(
        (item, i) =>
          i > 0 && item.sequence !== events.items[i - 1]!.sequence + 1,
      ) ||
      (!events.nextCursor &&
        (events.items.at(-1)?.sequence ?? 0) < run.lastSequence)),
  );
  const outputs = Object.values(details).filter(
    (item) => item.type === "model_output",
  );
  const uniqueRequests = new Set(
    outputs.map((item) => item.data.requestNumber),
  );
  const usage = outputs
    .map((item) => item.data.usage)
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null && !Array.isArray(item),
    );
  const allUsageRead =
    outputs.length > 0 &&
    modelRequests !== null &&
    outputs.length === modelRequests &&
    uniqueRequests.size === modelRequests &&
    usage.length === outputs.length;
  const sumUsage = (key: string): number | null =>
    allUsageRead &&
    usage.every(
      (item) => typeof item[key] === "number" && Number.isFinite(item[key]),
    )
      ? usage.reduce((sum, item) => sum + Number(item[key]), 0)
      : null;
  const saved = (events?.items ?? []).filter(
    (item) =>
      [
        "runtime_started",
        "delivery_saved",
        "assistant_saved",
        "final_saved",
      ].includes(item.type) && details[item.eventId],
  );
  const loading = busy.length > 0;
  return (
    <div className="ops-console">
      <header className="ops-toolbar">
        <Brand />
        <h1>{t("咨询回放", "Consultation replay")}</h1>
        <span className="ops-readonly">{t("只读", "Read only")}</span>
        <div className="ops-toolbar-actions">
          <button onClick={() => setLocale(locale === "zh" ? "en" : "zh")}>
            {locale === "zh" ? "EN" : "中文"}
          </button>
          {unlocked ? (
            <button onClick={clear}>{t("退出并清除", "Lock & clear")}</button>
          ) : null}
        </div>
      </header>
      {!unlocked ? (
        <div className="ops-lock-surface">
          <form
            className="ops-access"
            onSubmit={(event) => {
              event.preventDefault();
              if (!draft.trim() || loading || !secure) return;
              clear();
              token.current = draft.trim();
              setDraft("");
              void loadSessions({ limit: 20 });
            }}
          >
            <svg
              className="ops-access-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <rect x="5" y="10" width="14" height="11" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 7v-3" />
            </svg>
            <h2>{t("打开咨询记录", "Open consultation records")}</h2>
            <p>
              {t(
                "输入访问令牌后，按需读取已保存的对话和运行事件。",
                "Enter an access token to read saved conversations and run events on demand.",
              )}
            </p>
            <label htmlFor="ops-access-token">
              {t("访问令牌", "Access token")}
            </label>
            <input
              id="ops-access-token"
              type="password"
              autoComplete="off"
              minLength={43}
              maxLength={128}
              pattern={"[A-Za-z0-9_\\-]{43,128}"}
              autoCapitalize="none"
              spellCheck={false}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={loading}
            />
            <button
              type="submit"
              disabled={
                !secure ||
                loading ||
                !/^[A-Za-z0-9_-]{43,128}$/.test(draft.trim())
              }
            >
              {loading
                ? t("正在核对…", "Checking…")
                : t("解锁只读回放", "Unlock read-only replay")}
            </button>
            {!secure ? (
              <p className="ops-error" role="alert">
                {t(
                  "令牌仅通过 HTTPS 发送。请使用 HTTPS 地址打开。",
                  "Tokens are only sent over HTTPS. Open the HTTPS address.",
                )}
              </p>
            ) : null}
            {error ? (
              <p className="ops-error" role="alert">
                {error}
              </p>
            ) : null}
            <p className="ops-access-note">
              {t(
                "令牌仅保存在本页内存，刷新需重输。页面已标注不索引；访问权限由服务端验证。",
                "The token stays in page memory; refresh requires re-entry. No-index is set; access is verified by the server.",
              )}
            </p>
          </form>
        </div>
      ) : (
        <>
          {error ? (
            <div className="ops-banner" role="alert">
              {error}
            </div>
          ) : null}
          <div
            className="ops-metrics"
            aria-label={t("所选轮次统计", "Selected run metrics")}
          >
            {[
              [t("总耗时", "Total duration"), opsDuration(duration, t)],
              [t("模型请求", "Model requests"), opsNumber(modelRequests, t)],
              [t("纠正事件", "Correction events"), opsNumber(corrections, t)],
              ["Tokens", opsNumber(sumUsage("totalTokens"), t)],
              [
                t("缓存读 / 写", "Cache read / write"),
                sumUsage("cacheRead") === null ||
                sumUsage("cacheWrite") === null
                  ? t("未记录", "Not recorded")
                  : `${opsNumber(sumUsage("cacheRead"), t)} / ${opsNumber(sumUsage("cacheWrite"), t)}`,
              ],
            ].map(([label, value]) => (
              <div key={label} className="ops-metric">
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <nav
            className="ops-mobile-nav"
            aria-label={t("回放面板", "Replay panels")}
          >
            {["sessions", "replay", "events"].map((id, i) => (
              <button
                key={id}
                onClick={() => setPane(id)}
                aria-pressed={pane === id}
              >
                {
                  [
                    t("咨询", "Sessions"),
                    t("对话", "Replay"),
                    t("事件", "Events"),
                  ][i]
                }
              </button>
            ))}
          </nav>
          <div className="ops-workspace" data-pane={pane}>
            <section
              className="ops-column"
              data-pane="sessions"
              aria-label={t("咨询列表", "Consultation list")}
            >
              <div className="ops-column-head">
                <h2>{t("咨询记录", "Consultations")}</h2>
                <small>{t("最近轮次优先", "Latest run first")}</small>
              </div>
              <details className="ops-filter">
                <summary>
                  {t("时间、状态与 ID 筛选", "Filter by time, state or ID")}
                </summary>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    const input: Record<string, unknown> = { limit: 20 };
                    for (const [key, value] of data) {
                      if (!String(value).trim()) continue;
                      if (["from", "to"].includes(key)) {
                        const date = new Date(String(value));
                        if (!Number.isFinite(date.getTime())) {
                          setError(
                            t("请核对时间格式。", "Check the date format."),
                          );
                          return;
                        }
                        input[key] = date.toISOString();
                      } else input[key] = String(value).trim();
                    }
                    const parsed = TraceViewerFilters.safeParse(input);
                    if (!parsed.success) {
                      setError(
                        t(
                          "请核对时间范围及完整 UUID。",
                          "Check the time range and full UUIDs.",
                        ),
                      );
                      return;
                    }
                    setFilters(parsed.data);
                    void loadSessions(parsed.data);
                  }}
                >
                  {[
                    ["from", t("开始时间", "From"), "datetime-local"],
                    ["to", t("结束时间", "To"), "datetime-local"],
                    ["sessionId", "Session ID", "text"],
                    ["runId", "Run ID", "text"],
                  ].map(([name, label, type]) => (
                    <label key={name}>
                      {label}
                      <input name={name} type={type} />
                    </label>
                  ))}
                  <label>
                    {t("轮次状态", "Run state")}
                    <select name="state">
                      <option value="">{t("全部", "All")}</option>
                      {[
                        "pending",
                        "running",
                        "retry_wait",
                        "done",
                        "failed",
                        "cancelled",
                      ].map((state) => (
                        <option key={state} value={state}>
                          {opsState(state, t)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" disabled={loading}>
                    {t("应用筛选", "Apply filters")}
                  </button>
                </form>
              </details>
              <div className="ops-scroll">
                {busy.includes("sessions") ? (
                  <Empty title={t("正在读取咨询…", "Reading consultations…")} />
                ) : sessions?.items.length ? (
                  sessions.items.map((item) => (
                    <button
                      className="ops-session"
                      key={item.sessionId}
                      aria-pressed={item.sessionId === sessionId}
                      onClick={() => loadRuns(item.sessionId)}
                    >
                      <div className="ops-session-top">
                        <span>{opsTime(item.lastRunAt, locale)}</span>
                        <span className="ops-state">
                          {item.runCount} {t("轮", "runs")}
                        </span>
                      </div>
                      <div className="ops-session-id">{item.sessionId}</div>
                      <div className="ops-session-meta">
                        {t(
                          "起始时间与异常数：未记录",
                          "Start time and error count: not recorded",
                        )}
                      </div>
                    </button>
                  ))
                ) : (
                  <Empty
                    title={
                      !sessions && error
                        ? t("记录未能读取", "Records could not be read")
                        : t("没有匹配的咨询", "No matching consultations")
                    }
                  >
                    {t(
                      "调整筛选后重新读取。",
                      "Adjust the filters and read again.",
                    )}
                  </Empty>
                )}
              </div>
              <Pager
                next={sessions?.nextCursor ?? null}
                busy={loading}
                onNext={(cursor) => void loadSessions(filters, cursor)}
                onFirst={() => void loadSessions()}
              />
            </section>
            <section
              className="ops-column"
              data-pane="replay"
              aria-label={t("已保存对话", "Saved conversation")}
            >
              <div className="ops-column-head">
                <h2>{t("对话回放", "Conversation replay")}</h2>
                <small>{t("仅已保存记录", "Saved records only")}</small>
              </div>
              <div className="ops-scroll">
                {!sessionId ? (
                  <Empty title={t("选择一段咨询", "Choose a consultation")}>
                    {t(
                      "按需打开轮次，不预取其他咨询内容。",
                      "Open a run on demand. Other consultations are not prefetched.",
                    )}
                  </Empty>
                ) : busy.includes("runs") ? (
                  <Empty title={t("正在读取轮次…", "Reading runs…")} />
                ) : (
                  <div className="ops-run">
                    {runs?.items.map((item, i) => (
                      <button
                        key={item.runId}
                        className="ops-run-heading"
                        aria-pressed={run?.runId === item.runId}
                        onClick={() => loadEvents(item)}
                        title={item.runId}
                      >
                        <span>↗</span>
                        <span>{opsTime(item.createdAt, locale)}</span>
                        <span className="ops-state" data-state={item.state}>
                          {opsState(item.state, t)}
                        </span>
                        <small>{item.runId.slice(0, 8)}</small>
                      </button>
                    ))}
                    {!runs?.items.length ? (
                      <Empty
                        title={
                          !runs && error
                            ? t("轮次未能读取", "Runs could not be read")
                            : t("没有可读取轮次", "No readable runs")
                        }
                      />
                    ) : !run ? (
                      <Empty title={t("选择一轮查看", "Choose a run")}>
                        {t(
                          "右侧会显示实际记录的事件顺序。",
                          "The timeline will show the recorded event order.",
                        )}
                      </Empty>
                    ) : (
                      <>
                        <p className="ops-event-type">
                          Run {run.runId}
                          <br />
                          {t(
                            "当前仅展示本批事件中的保存交付；原始模型输出在右侧详情中。",
                            "Replay covers saved deliveries in this event page. Raw model output is separate in the timeline.",
                          )}
                        </p>
                        <button
                          className="secondary"
                          disabled={loading || !events}
                          onClick={() => void replay()}
                        >
                          {t(
                            "读取本批已保存对话与统计",
                            "Read this page’s saved conversation & metrics",
                          )}
                        </button>
                        {busy.includes("events") ? (
                          <Empty
                            title={t(
                              "正在读取事件索引…",
                              "Reading the event index…",
                            )}
                          />
                        ) : (
                          saved.map((item) => (
                            <SavedMessage
                              key={item.eventId}
                              event={details[item.eventId]!}
                            />
                          ))
                        )}
                        {replayed && !loading && !saved.length ? (
                          <Empty
                            title={t(
                              "本批未提供已保存文字",
                              "No saved text in this page",
                            )}
                          >
                            {t(
                              "可翻页查找其他保存记录。运行中或缺记录不代表没有发生。",
                              "Check another event page. Running or missing records do not imply nothing happened.",
                            )}
                          </Empty>
                        ) : null}
                      </>
                    )}
                  </div>
                )}
              </div>
              {sessionId ? (
                <Pager
                  next={runs?.nextCursor ?? null}
                  busy={loading}
                  onNext={(cursor) => loadRuns(sessionId, cursor)}
                  onFirst={() => loadRuns(sessionId)}
                />
              ) : null}
            </section>
            <section
              className="ops-column"
              data-pane="events"
              aria-label={t("事件时间线", "Event timeline")}
            >
              <div className="ops-column-head">
                <h2>{t("轮次事件", "Run events")}</h2>
                <small>
                  {run
                    ? opsState(run.state, t)
                    : t("按记录顺序", "Recorded order")}
                </small>
              </div>
              <div className="ops-scroll">
                {indexGap ? (
                  <p className="ops-index-note">
                    {t(
                      "记录序号存在缺口；仅展示已读取事件。",
                      "The record sequence has gaps. Only available events are shown.",
                    )}
                  </p>
                ) : null}
                {!run ? (
                  <Empty title={t("等待选择轮次", "Choose a run first")}>
                    {t(
                      "没有推测步骤或隐藏思维回放。",
                      "Only recorded events are available.",
                    )}
                  </Empty>
                ) : busy.includes("events") ? (
                  <Empty title={t("正在读取事件…", "Reading events…")} />
                ) : events?.items.length ? (
                  events.items.map((item) => (
                    <RawEvent
                      key={item.eventId}
                      event={item}
                      detail={details[item.eventId]}
                      loading={busy.includes(`detail:${item.eventId}`)}
                      onRead={() => void loadDetail(item)}
                      error={detailErrors[item.eventId]}
                    />
                  ))
                ) : (
                  <Empty
                    title={
                      !events && error
                        ? t("事件未能读取", "Events could not be read")
                        : t("当前没有事件记录", "No events are recorded yet")
                    }
                  >
                    {t(
                      "运行中可重新读取首批；缺记录保持明确。",
                      "For running requests, reload the first page to check for new records.",
                    )}
                  </Empty>
                )}
              </div>
              {run ? (
                <Pager
                  next={events?.nextCursor ?? null}
                  busy={loading}
                  onNext={(cursor) => loadEvents(run, cursor)}
                  onFirst={() => loadEvents(run)}
                />
              ) : null}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

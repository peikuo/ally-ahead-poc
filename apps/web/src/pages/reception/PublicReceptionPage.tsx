import { decodeReceptionPresentation, isReceptionPresentationText } from "@ally-ahead/contracts";
import { finalReceptionReply, receptionTurnReplies } from "./reception-deliveries";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  receptionApi,
  type ReceptionSessionView,
  type ReceptionView,
} from "../../api/reception";
import { isAborted, RequestError } from "../../api/client";
import { AppLink } from "../../app/router";
import { useSession } from "../../app/session";
import { receptionPocMode } from "../../app/releaseMode";
import { Modal } from "../../components/Modal";
import { Brand } from "../../components/Brand";
import { ErrorNotice } from "../../components/Feedback";
import { useLocale } from "../../locales/context";
import { useDemandAction } from "../../hooks/useDemandAction";
import { ReceptionCharacter } from "./ReceptionCharacter";
import { isReceptionAcknowledgement } from "./reception-gesture";
import { BrowserReplySpeech } from "./ReplySpeech";
import { ReceptionStage } from "./ReceptionStage";
import { ReceptionLoading } from "./ReceptionTransition";
import { FirstMessageNotice } from "./FirstMessageNotice";
import { ReceptionDocumentTools } from "./documents/ReceptionDocumentTools";
import { ReceptionRequirementsTools } from "./poc/ReceptionRequirementsTools";
import { ReceptionTextarea, ReceptionSendIcon } from "./ReceptionTextarea";
import "./reception.css";

const finished = (view: ReceptionView) =>
  ["done", "failed", "cancelled"].includes(view.state);
function closeReceptionMenu(button: HTMLButtonElement) {
  const menu = button.closest("details");
  menu?.removeAttribute("open");
  menu?.querySelector("summary")?.focus();
}
export default function PublicReceptionPage() {
  const { t, locale, setLocale } = useLocale();
  const account = useSession();
  const [session, setSession] = useState<ReceptionSessionView | null>(null);
  const [openDocument, setOpenDocument] = useState<{messageId: string; requestId: string} | null>(null);
  const [view, setView] = useState<ReceptionView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [retry, setRetry] = useState(0);
  const [connection, setConnection] = useState<"loading"|"ready"|"reconnecting"|"disconnected">("loading");
  const [composeHint, setComposeHint] = useState(false);
  const [body, setBody] = useState("");
  const [acknowledgedScope, setAcknowledgedScope] = useState<string | null>(
    null,
  );
  const [pendingFirstSend, setPendingFirstSend] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [textOutput, setTextOutput] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [okAcknowledgement, setOkAcknowledgement] = useState<string | null>(null);
  const [showClear, setShowClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<unknown>(null);
  const [stageVersion, setStageVersion] = useState(0);
  const clearInFlight = useRef(false);
  const clearRequest = useRef<AbortController | null>(null);
  const readRequests = useRef(new Set<AbortController>());
  const requestEpoch = useRef(0);
  const action = useDemandAction();
  const message = useRef<{ body: string; key: string } | null>(null);
  const reconnect = useCallback(() => {setConnection("reconnecting");setRetry((v) => v + 1);}, []);
  const accountUser = account.account?.user.id ?? null;
  const previousAccount = useRef(accountUser);
  const previousAccountEpoch = useRef(account.epoch);
  useLayoutEffect(() => {
    if (account.status === "loading") return;
    const previous = previousAccount.current;
    const previousEpoch = previousAccountEpoch.current;
    previousAccount.current = accountUser;
    previousAccountEpoch.current = account.epoch;
    // Signing in keeps the guest conversation for an explicit claim. Signing
    // out or changing an existing account must discard its cached private UI
    // before paint, then ask the server which reception is accessible now.
    if (!previous || (previous === accountUser && previousEpoch === account.epoch)) return;
    requestEpoch.current++;
    action.cancel();
    clearRequest.current?.abort();
    clearRequest.current = null;
    clearInFlight.current = false;
    for (const request of readRequests.current) request.abort();
    message.current = null;
    setSession(null);
    setView(null);
    setBody("");
    setPlaying(false);
    setOkAcknowledgement(null);
    setPendingFirstSend(null);
    setAcknowledgedScope(null);
    setComposeHint(false);
    setError(null);
    setClearError(null);
    setShowClear(false);
    setClearing(false);
    setStageVersion(value => value + 1);
    reconnect();
  }, [account.status, accountUser, account.epoch]);
  useEffect(
    () => () => {
      requestEpoch.current++;
      clearRequest.current?.abort();
      for (const request of readRequests.current) request.abort();
    },
    [],
  );
  useEffect(() => {
    if (clearInFlight.current) return;
    const controller = new AbortController();
    const epoch = requestEpoch.current;
    readRequests.current.add(controller);
    setError(null);
    void receptionApi
      .session(controller.signal)
      .then((value) => {
        if (controller.signal.aborted || epoch !== requestEpoch.current) return;
        if (message.current && value.run?.inputMessageId === message.current.key) {
          const acceptedBody = message.current.body;
          message.current = null;
          setBody(current => current.trim() === acceptedBody ? "" : current);
          action.cancel();
        }
        setSession(value);
        setView(value.run);
        setConnection("ready");
      })
      .catch((fault) => {
        if (
          !controller.signal.aborted &&
          epoch === requestEpoch.current &&
          !isAborted(fault)
        )
          {setError(fault);setConnection("disconnected");}
      });
    return () => {
      controller.abort();
      readRequests.current.delete(controller);
    };
  }, [retry]);
  const active = view !== null && !finished(view);
  useEffect(() => {
    if (clearing || !view || finished(view)) return;
    const controller = new AbortController();
    const epoch = requestEpoch.current;
    readRequests.current.add(controller);
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const read = async () => {
      if (controller.signal.aborted || epoch !== requestEpoch.current) return;
      try {
        const next = await receptionApi.read(view.runId, controller.signal);
        if (controller.signal.aborted || epoch !== requestEpoch.current) return;
        failures = 0;
        setConnection("ready");
        setError(null);
        setView(current => current?.runId === next.runId && current.revision > next.revision ? current : next);
        if (!finished(next)) timer = setTimeout(() => void read(), 1000);
      } catch (fault) {
        if (
          !controller.signal.aborted &&
          epoch === requestEpoch.current &&
          !isAborted(fault)
        ) {
          failures++;
          const denied = fault instanceof RequestError && [401,403,404,409].includes(fault.status);
          if (!denied && failures <= 2) {
            setConnection("reconnecting");
            timer = setTimeout(() => void read(), failures * 1000);
          } else {
            setError(fault);
            setConnection("disconnected");
          }
        }
      }
    };
    void read();
    return () => {
      controller.abort();
      readRequests.current.delete(controller);
      clearTimeout(timer);
    };
  }, [view?.runId, active, retry, clearing]);
  const lastReply =
    view ? receptionTurnReplies(view.messages, view.inputMessageId).at(-1) : undefined;
  const finalReply = finalReceptionReply(view);
  const invalidReply = Boolean(lastReply && isReceptionPresentationText(lastReply.text) && !decodeReceptionPresentation(lastReply.text));
  const retryText = message.current?.body ?? view?.messages.find(m => m.messageId === view.inputMessageId && m.author === "user")?.text;
  const runId = view?.runId;
  const replyId = finalReply?.messageId;
  const loadReply = useCallback(
    async (signal: AbortSignal) => {
      if (clearInFlight.current)
        throw new DOMException("Aborted", "AbortError");
      const epoch = requestEpoch.current;
      if (!runId) throw new RequestError(409, "CONFLICT");
      const current = await receptionApi.read(runId, signal);
      if (clearInFlight.current || epoch !== requestEpoch.current)
        throw new DOMException("Aborted", "AbortError");
      const reply = finalReceptionReply(current);
      if (!replyId || reply?.messageId !== replyId || !reply?.text)
        throw new RequestError(409, "CONFLICT");
      return reply.text;
    },
    [runId, replyId],
  );
  async function clearConversation() {
    if (!session || clearInFlight.current) return;
    clearInFlight.current = true;
    requestEpoch.current++;
    action.cancel();
    for (const request of readRequests.current) request.abort();
    readRequests.current.clear();
    const controller = new AbortController();
    clearRequest.current = controller;
    setClearing(true);
    setClearError(null);
    setPlaying(false);
    try {
      const cleared = await receptionApi.clear(
        session.csrfToken,
        controller.signal,
      );
      controller.signal.throwIfAborted();
      if (cleared.sessionId !== session.sessionId)
        throw new RequestError(200, "INVALID_RESPONSE");
      setSession(cleared);
      setOkAcknowledgement(null);
      setView(null);
      setConnection("ready");
      setComposeHint(false);
      setBody("");
      message.current = null;
      setError(null);
      setPendingFirstSend(null);
      setShowClear(false);
      // Reset reply selections, drawer state and speech work, while keeping the
      // page's voice preference and account identity outside this reset.
      setStageVersion((version) => version + 1);
      requestAnimationFrame(() =>
        document.getElementById("agent-input")?.focus({ preventScroll: true }),
      );
    } catch (fault) {
      if (!controller.signal.aborted && !isAborted(fault)) setClearError(fault);
    } finally {
      if (clearRequest.current === controller) {
        clearRequest.current = null;
        clearInFlight.current = false;
        if (!controller.signal.aborted) setClearing(false);
      }
    }
  }
  function compose(text: string) {
    setBody(text);
    setComposeHint(true);
    requestAnimationFrame(() =>
      document.getElementById("agent-input")?.focus({ preventScroll: true }),
    );
  }
  function sendInput(text: string, acknowledgedNow = false) {
    if (
      clearInFlight.current ||
      !session?.configured ||
      !text.trim() ||
      active ||
      action.busy
    )
      return;
    if (
      !acknowledgedNow &&
      acknowledgedScope !== session?.sessionId &&
      !view?.messages.some((message) => message.author === "user")
    ) {
      setBody(text);
      setPendingFirstSend(text);
      return;
    }
    if (message.current?.body !== text.trim())
      message.current = {
        body: text.trim(),
        key: crypto.randomUUID(),
      };
    const submission = message.current!;
    const epoch = ++requestEpoch.current;
    for (const request of readRequests.current) request.abort();
    void action.run(
      signal => receptionApi.send(session.csrfToken, {
        body: submission.body, clientMessageKey: submission.key,
        confirmedNonConfidential: true,
      }, signal),
      receipt => {
        if(epoch !== requestEpoch.current) return;
        if (isReceptionAcknowledgement(lastReply?.text, submission.body))
          setOkAcknowledgement(receipt.inputMessageId);
        // Track the accepted run immediately. Reading it is an independent,
        // recoverable operation; a failed GET must never swallow this receipt.
        setView(previous => ({
          runId: receipt.runId, sessionId: session.sessionId,
          inputMessageId: receipt.inputMessageId, state: receipt.state === "running" ? "running" : "pending",
          revision: 0, snapshot: null, failure: null,
          messages: [...(previous?.messages ?? []).filter(m => m.messageId !== receipt.inputMessageId), {
            messageId: receipt.inputMessageId, messageKey: submission.key,
            author: "user", text: submission.body,
          }],
        }));
        setError(null); setConnection("ready"); setComposeHint(false);
        setBody(current => current.trim() === submission.body ? "" : current);
        message.current = null;
      },
    );
  }

  if (connection === "loading" && !session && !error)
    return <ReceptionLoading phase="session" />;

  return (
    <div className="public-reception">
      <header className="public-reception-header">
        <Brand />
        <nav>
          <button
            className="quiet"
            onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
          >
            {locale === "zh" ? "EN" : "中文"}
          </button>
          {!receptionPocMode ? (
            <AppLink
              className="text-link"
              href={account.status === "authenticated" ? "/spaces" : "/login"}
            >
              {account.status === "authenticated"
                ? t("我的空间", "My spaces")
                : t("登录", "Log in")}
            </AppLink>
          ) : null}
        </nav>
      </header>
      <main>
        <ReceptionStage
          key={stageVersion}
          testId="public-reception-page"
          onTextOutputChange={setTextOutput}
          restoring={connection === "loading"}
          messages={view?.messages ?? []}
          reply={lastReply}
          snapshot={view?.snapshot}
          inputMessageId={view?.inputMessageId}
          onOpenDocument={messageId => setOpenDocument({messageId,requestId: crypto.randomUUID()})}
          active={active || action.busy}
          failed={Boolean(view?.failure || invalidReply)}
          progressText={connection === "reconnecting" ? t("正在重新连接，核对回复进度…", "Reconnecting to check reply progress…") : connection === "disconnected" ? t("连接已中断，你的输入已保留。请重新连接。", "Connection interrupted. Your input is preserved. Reconnect to continue.") : view?.snapshot?.messageKey.startsWith("repair:") ? decodeReceptionPresentation(view.snapshot.text)?.speech : undefined}
          voiceEnabled={voiceEnabled}
          canAnswer={
            !clearing && !active && !action.busy && connection === "ready" && Boolean(session?.configured)
          }
          onAnswer={(text) => sendInput(text)}
          onCompose={compose}
          character={
            <ReceptionCharacter
              acknowledgement={okAcknowledgement}
              onAcknowledgementHandled={id => setOkAcknowledgement(current => current === id ? null : current)}
              mode={
                clearing
                  ? "welcome"
                  : playing || textOutput
                    ? "speaking"
                    : active || action.busy
                      ? view?.snapshot?.progress === "responding"
                        ? "typing"
                        : "thinking"
                      : body.trim()
                        ? "listening"
                        : lastReply
                          ? "ready"
                          : "welcome"
              }
              label={t("接待人员", "Receptionist")}
            />
          }
          presence={
            <p
              className="reception-presence"
              role="status"
              data-testid="agent-run-state"
              data-state={view?.state ?? "idle"}
            >
              <i />
              {playing
                ? t("正在朗读回复", "Reading the reply")
                : connection === "disconnected"
                  ? t("连接已中断", "Connection interrupted")
                  : connection === "reconnecting"
                    ? t("正在重新连接…", "Reconnecting…")
                    : active
                  ? (view?.snapshot?.messageKey.startsWith("repair:") ? t("正在核对回复…", "Checking the reply…") : t("正在继续回复…", "Continuing the reply…"))
                  : (view?.state === "failed" || invalidReply)
                    ? t("本次处理未完成", "This response did not complete")
                    : t("我在，慢慢说。", "I’m here. Take your time.")}
            </p>
          }
          speech={
            <BrowserReplySpeech
              key={session?.sessionId ?? "initial"}
              messageId={finalReply?.messageId}
              text={finalReply?.text}
              enabled={voiceEnabled}
              onEnabledChange={setVoiceEnabled}
              loadReply={loadReply}
              onPlaying={setPlaying}
              onAccessError={reconnect}
              disabled={clearing || active || action.busy}
            />
          }
          tools={
            <>
              <ReceptionRequirementsTools
                key={`poc:${session?.sessionId ?? "initial"}:${accountUser ?? "guest"}:${accountUser ? account.epoch : "guest"}`}
                messages={view?.messages ?? []}
                active={active || action.busy}
                disabled={clearing || !session?.configured || account.status === "loading" || connection !== "ready"}
                onSend={sendInput}
                openRequest={openDocument}
                session={session}
                paymentDisabled={clearing || account.status === "loading"}
              />
              <ReceptionDocumentTools
                key={`${session?.sessionId ?? "initial"}:${accountUser ? `${accountUser}:${account.epoch}` : account.status === "loading" ? "checking" : "guest"}`}
                session={session}
                disabled={clearing || account.status === "loading"}
                chatActive={active || action.busy}
              />
              <details className="reception-more-menu"><summary>{t("更多", "More")}<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg></summary><div className="reception-more-content">
              <button
                type="button"
                className="text-link"
                onClick={event => {closeReceptionMenu(event.currentTarget);reconnect();}}
                disabled={clearing || action.busy || connection === "loading" || connection === "reconnecting"}
              >
                {connection === "reconnecting" || connection === "loading" ? t("连接中…", "Connecting…") : t("重新连接", "Reconnect")}
              </button>
              <button
                type="button"
                className="text-link"
                data-testid="clear-reception"
                disabled={!session || clearing}
                onClick={event => {
                  closeReceptionMenu(event.currentTarget);
                  setClearError(null);
                  setShowClear(true);
                }}
              >
                {clearing
                  ? t("正在清空…", "Clearing…")
                  : t("清空本次对话", "Clear conversation")}
              </button>
              </div></details>
            </>
          }
        >
          {[error, action.error].filter(Boolean).map((fault, index) =>
            fault instanceof RequestError &&
            [401, 403, 404].includes(fault.status) ? (
              <p key={index} className="notice" role="alert">
                {t(
                  "临时会话不可用，请重新连接后继续。",
                  "This temporary session is unavailable. Reconnect to continue.",
                )}
              </p>
            ) : (
              <ErrorNotice key={index} error={fault} />
            ),
          )}
          {session && !session.configured ? (
            <p className="notice" role="status">
              {t(
                "接待服务暂未就绪，请稍后重新连接。",
                "Reception is not ready yet. Reconnect shortly.",
              )}
            </p>
          ) : null}
          {view?.failure ? (
            <p className="notice">
              {t(
                "这次没能完成回复，你的输入已保留，可以再试一次。",
                "This reply did not complete. Your input is preserved; you can try again.",
              )}
            </p>
          ) : null}
          {!active && retryText && (view?.failure || invalidReply || action.error) ? (
            <button type="button" className="secondary" data-testid="retry-agent-input"
              disabled={clearing || action.busy || !session?.configured || connection !== "ready"}
              onClick={() => sendInput(retryText, true)}>
              {t("重试上一条", "Retry last message")}
            </button>
          ) : null}
          {composeHint ? <p className="form-hint" role="status">{t("已填入输入框，可修改后点击发送。", "Added to the input box. Edit it or click Send.")}</p> : null}
          <form
            className="reception-composer"
            data-testid="agent-composer"
            onSubmit={(event) => {
              event.preventDefault();
              sendInput(body);
            }}
          >
            <div className="reception-compose-box">
            <label htmlFor="agent-input">
              {t("说说你想解决的问题", "What would you like to solve?")}
            </label>
            <ReceptionTextarea
              id="agent-input"
              canSubmit={Boolean(!active && !clearing && session?.configured && connection === "ready" && body.trim() && !action.busy)}
              maxLength={20000}
              value={body}
              onChange={(event) => {
                setBody(event.target.value);
              }}
              placeholder={t(
                "说说你的想法，或继续补充…",
                "Share your thoughts, or add a little more…",
              )}
              disabled={clearing || action.busy}
              required
            />
            <div className="between">
              {active && session && view ? (
                <button
                  type="button"
                  className="reception-send reception-stop"
                  aria-label={t("停止处理", "Stop")}
                  title={t("停止处理", "Stop")}
                  disabled={clearing || action.busy}
                  onClick={() =>
                    void action.run(
                      (signal) =>
                        receptionApi.stop(
                          session.csrfToken,
                          view.runId,
                          signal,
                        ),
                      next => {setView(next);setConnection("ready");setError(null);},
                    )
                  }
                >
                  <ReceptionSendIcon stop />
                </button>
              ) : (
                <button
                  className="primary reception-send"
                  aria-label={action.busy ? t("发送中…", "Sending…") : t("发送", "Send")}
                  title={t("发送", "Send")}
                  data-testid="send-agent-input"
                  disabled={
                    clearing ||
                    !session?.configured ||
                    connection !== "ready" ||
                    !body.trim() ||
                    action.busy
                  }
                >
                  <ReceptionSendIcon />
                </button>
              )}
            </div>
            </div>
            <p className="reception-composer-help">{active ? t("可以先写下补充，回复结束后再发送。", "Write a follow-up now and send it when the reply finishes.") : t("Enter 发送 · Shift + Enter 换行", "Enter to send · Shift + Enter for a new line")}</p>
          </form>
          {showClear ? (
            <Modal
              title={t("清空本次对话", "Clear conversation")}
              busy={clearing}
              onClose={() => setShowClear(false)}
            >
              <p>
                {t(
                  "将删除本次聊天记录，并清除 AI 聊天上下文。已上传资料会保留，可在新对话中继续使用。",
                  "This deletes the chat history and clears its AI chat context. Uploaded documents are retained and can be used in a new conversation.",
                )}
              </p>
              {clearError ? <ErrorNotice error={clearError} /> : null}
              <div className="dialog-actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={clearing}
                  onClick={() => setShowClear(false)}
                >
                  {t("取消", "Cancel")}
                </button>
                <button
                  type="button"
                  className="primary"
                  data-testid="confirm-clear-reception"
                  disabled={clearing}
                  onClick={() => void clearConversation()}
                >
                  {clearing
                    ? t("正在清空…", "Clearing…")
                    : t("确定清空", "Clear now")}
                </button>
              </div>
            </Modal>
          ) : null}
          {pendingFirstSend !== null ? (
            <FirstMessageNotice
              onModify={() => {
                const draft = pendingFirstSend;
                setPendingFirstSend(null);
                compose(draft);
              }}
              onConfirm={() => {
                const draft = pendingFirstSend;
                setAcknowledgedScope(session?.sessionId ?? null);
                setPendingFirstSend(null);
                sendInput(draft, true);
              }}
            />
          ) : null}
        </ReceptionStage>
      </main>
    </div>
  );
}

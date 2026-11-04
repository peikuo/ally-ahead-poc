import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  decodeReceptionPresentation,
  deriveReceptionJourney,
  parseReceptionSample,
  isReceptionPresentationText,
  receptionStreamingText,
} from "@ally-ahead/contracts";
import type { RunView } from "../../api/agent";
import { useLocale } from "../../locales/context";
import { ReceptionProgress } from "./ReceptionProgress";
import { ReceptionMessage } from "./ReceptionMessage";
import { ReceptionMarkdown } from "./ReceptionMarkdown";
import {
  receptionTurnReplies,
  uniqueReceptionMessages,
  isIntermediateReceptionMessage,
} from "./reception-deliveries";
import {
  receptionSpeechText,
  receptionContentLabel,
} from "./reception-display";
import { ReceptionTypingText } from "./ReceptionTypingText";

type Message = RunView["messages"][number];
export function ReceptionStage({
  messages: suppliedMessages,
  inputMessageId,
  onOpenDocument,
  onTextOutputChange,
  reply,
  active,
  restoring = false,
  progressText,
  snapshot,
  failed = false,
  voiceEnabled,
  canAnswer,
  onAnswer,
  onCompose,
  character,
  presence,
  speech,
  tools,
  children,
  testId,
}: {
  messages: readonly Message[];
  inputMessageId?: string;
  onOpenDocument?: (messageId: string) => void;
  onTextOutputChange?: (outputting: boolean) => void;
  reply: { messageId: string; text: string } | undefined;
  active: boolean;
  restoring?: boolean;
  progressText?: string;
  snapshot?: RunView["snapshot"];
  failed?: boolean;
  voiceEnabled: boolean;
  canAnswer: boolean;
  onAnswer: (text: string) => void;
  onCompose: (text: string) => void;
  character: ReactNode;
  presence: ReactNode;
  speech: ReactNode;
  tools: ReactNode;
  children: ReactNode;
  testId: string;
}) {
  const { t } = useLocale();
  const [restored, setRestored] = useState(!restoring);
  useEffect(() => {
    setRestored(!restoring);
  }, [restoring]);
  const messages = useMemo(
    () => uniqueReceptionMessages(suppliedMessages),
    [suppliedMessages],
  );
  const delivered = useMemo(
    () => receptionTurnReplies(messages, inputMessageId),
    [messages, inputMessageId],
  );
  const journey = useMemo(() => deriveReceptionJourney(messages), [messages]);
  // A temporary cumulative slot, never a saved message or structured card.
  // Only the shared protocol extractor may reveal speech; plain tool/status
  // text and repair notices are not treated as an assistant draft.
  const draft = useMemo(
    () =>
      active &&
      snapshot?.progress === "responding" &&
      !snapshot.messageKey.startsWith("repair:") &&
      isReceptionPresentationText(snapshot.text)
        ? receptionStreamingText(snapshot.text)
        : "",
    [active, snapshot],
  );
  const draftArea = useRef<HTMLDivElement>(null);
  const followDraft = useRef(true);
  const draftKey = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (draftKey.current !== inputMessageId) {
      draftKey.current = inputMessageId;
      followDraft.current = true;
    }
    if (draftArea.current && followDraft.current)
      draftArea.current.scrollTop = draftArea.current.scrollHeight;
  }, [draft, snapshot?.messageKey, reply?.messageId, inputMessageId]);
  const stage = useRef<HTMLDivElement>(null);
  const inputArea = useRef<HTMLElement>(null);
  // The result list is independent of the conversation area. Bound replies by
  // the fixed character and composer rather than the number of saved results.
  useLayoutEffect(() => {
    const root = stage.current,
      composer = inputArea.current;
    if (!root || !composer) return;
    const character = root.querySelector(".reception-character");
    const tools = root.querySelector(".reception-stage-tools");
    const measure = () => {
      const base = root.getBoundingClientRect();
      const controlsBottom = tools
        ? tools.getBoundingClientRect().bottom - base.top
        : 36;
      const portrait = character?.getBoundingClientRect();
      const replyTop =
        matchMedia("(max-width: 1100px)").matches && portrait
          ? Math.max(
              controlsBottom + 96,
              portrait.top - base.top + portrait.height * 0.52,
            )
          : controlsBottom + 24;
      root.style.setProperty(
        "--reception-composer-top",
        `${composer.getBoundingClientRect().top - base.top}px`,
      );
      root.style.setProperty("--reception-tools-bottom", `${controlsBottom}px`);
      root.style.setProperty("--reception-reply-top", `${replyTop}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const node of [root, composer, character, tools])
      if (node) observer.observe(node);
    addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      removeEventListener("resize", measure);
    };
  }, []);
  const history = useRef<HTMLDialogElement>(null);
  const records = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const id = useId();
  const replyToggle = useRef<HTMLButtonElement>(null);
  const interaction = reply
    ? decodeReceptionPresentation(reply.text)?.interaction
    : null;
  const headline =
    progressText ||
    (failed
      ? t(
          "前面的交流已保留。你可以继续补充，或重试这次回复。",
          "Our earlier conversation is saved. Add more detail or retry this reply.",
        )
      : "") ||
    (reply ? receptionSpeechText(reply.text) : "") ||
    (draft ? receptionSpeechText(draft) : "") ||
    (active
      ? t(
          "收到，我们从你刚刚说的情况继续聊。",
          "Received. Let’s work through what you just described.",
        )
      : t(
          "你好，先聊聊你想解决什么问题？",
          "Hello. What would you like to work on?",
        ));
  const hasSpeech = Boolean(reply || draft) && !progressText && !failed;
  const reportTextOutput = useCallback(
    (typing: boolean) => {
      onTextOutputChange?.(typing && hasSpeech);
    },
    [onTextOutputChange, hasSpeech],
  );
  const latestUser =
    messages.filter((m) => m.author === "user").at(-1)?.text ?? "";
  const suppliedSample = parseReceptionSample(latestUser);
  const sampleSeed =
    suppliedSample ??
    (!/^(?:我选择|我想做一次小样|请根据我们|I choose|I’d like to try a sample)/i.test(
      latestUser,
    ) && latestUser.length <= 3000
      ? { sample: latestUser, reference: "" }
      : undefined);
  const autoOpen =
    failed ||
    (active && delivered.length > 0) ||
    !voiceEnabled ||
    Boolean(interaction);
  const [panel, setPanel] = useState({
    replyId: reply?.messageId,
    voiceEnabled,
    open: autoOpen,
  });
  const sameReply =
    panel.replyId === reply?.messageId && panel.voiceEnabled === voiceEnabled;
  // Reset the default for each new reply or mode, without remounting the scene.
  if (!sameReply)
    setPanel({ replyId: reply?.messageId, voiceEnabled, open: autoOpen });
  const replyOpen =
    Boolean(reply) &&
    (!active || delivered.length > 0) &&
    (sameReply ? panel.open : autoOpen);
  function setReplyOpen(open: boolean) {
    setPanel({ replyId: reply?.messageId, voiceEnabled, open });
  }
  function closeReply(returnFocus = false) {
    setReplyOpen(false);
    if (returnFocus) replyToggle.current?.focus({ preventScroll: true });
  }
  const started = active || Boolean(reply) || messages.length > 0;
  useEffect(() => {
    if (records.current && history.current?.open)
      records.current.scrollTop = records.current.scrollHeight;
  }, [messages.length]);
  function openHistory() {
    history.current?.showModal();
    if (records.current)
      records.current.scrollTop = records.current.scrollHeight;
  }
  return (
    <div
      ref={stage}
      className={`reception-stage${started ? " is-conversing" : ""}`}
      data-testid={testId}
    >
      <h1 className="reception-sr-only">{t("需求接待", "Reception")}</h1>
      <div className="reception-stage-tools">
        <button
          ref={toggle}
          type="button"
          className="text-link reception-history-toggle"
          aria-haspopup="dialog"
          aria-controls={id}
          onClick={openHistory}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M5 4h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-5 3V5a1 1 0 0 1 1-1Z" />
            <path d="M8 9h8M8 13h5" />
          </svg>
          {t("聊天记录", "Chat history")} <span>{messages.length}</span>
        </button>
        {speech}
        {tools}
      </div>
      <ReceptionProgress journey={journey} messages={messages} />
      <section
        className="reception-face"
        aria-label={t("与接待员交谈", "Talk with reception")}
      >
        <div className="reception-greeting-slot">
          <div className="reception-bubble-anchor">
            <div className="reception-live-bubble">
              <p
                className={active ? "reception-preparing" : "reception-welcome"}
                data-testid={
                  active
                    ? "agent-live-snapshot"
                    : !reply
                      ? "agent-messages"
                      : undefined
                }
                role={active ? "status" : undefined}
              >
                <ReceptionTypingText
                  text={headline}
                  animate={restored && !restoring}
                  onTypingChange={reportTextOutput}
                />
              </p>
            </div>
            {!active && reply ? (
              <button
                ref={replyToggle}
                type="button"
                className="reception-reply-toggle"
                aria-haspopup="dialog"
                aria-expanded={replyOpen}
                aria-label={
                  replyOpen
                    ? t("收起回复", "Hide reply")
                    : t("显示回复", "Show reply")
                }
                aria-controls={`${id}-reply`}
                onClick={() => setReplyOpen(!replyOpen)}
              >
                <span aria-hidden="true">
                  {replyOpen ? t("收起", "Hide") : t("显示", "Show")}
                </span>
                <span aria-hidden="true">{t("回复", "reply")}</span>
              </button>
            ) : null}
          </div>
        </div>
        {character}
        {presence}
      </section>
      {reply || draft ? (
        <section
          id={`${id}-reply`}
          className="reception-workspace"
          role="dialog"
          aria-modal="false"
          aria-labelledby={`${id}-reply-title`}
          hidden={!draft && !replyOpen}
          onKeyDown={(event) => {
            if (!draft && !active && event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              closeReply(true);
            }
          }}
        >
          <div className="reception-workspace-heading">
            <h2 id={`${id}-reply-title`}>
              {draft && !delivered.length
                ? t("正在生成 · 尚未核对", "Generating · Not yet checked")
                : t("本轮交流", "This conversation")}
            </h2>
            {!draft && !active ? (
              <button
                type="button"
                className="quiet"
                aria-label={t("收起当前回复", "Close current reply")}
                onClick={() => closeReply(true)}
              >
                ×
              </button>
            ) : null}
          </div>
          <div
            key={inputMessageId}
            ref={draftArea}
            onScroll={(event) => {
              const node = event.currentTarget;
              followDraft.current =
                node.scrollHeight - node.scrollTop - node.clientHeight < 40;
            }}
            className="reception-current-exchange"
            data-testid="agent-messages"
            role="region"
            aria-label={t("回复内容", "Reply content")}
            aria-live={draft ? "off" : "polite"}
            tabIndex={0}
          >
            {delivered.map((message) => (
              <article
                key={message.messageId}
                className="reception-current-message"
                data-testid="agent-message-assistant"
                data-message-id={message.messageId}
              >
                <span className="reception-delivery-label">
                  {decodeReceptionPresentation(message.text)?.interaction
                    ? receptionContentLabel(
                        decodeReceptionPresentation(message.text)?.interaction,
                        t,
                      )
                    : isIntermediateReceptionMessage(message)
                      ? t("已说明", "Explained")
                      : t("接待回复", "Reception response")}
                </span>
                <ReceptionMessage
                  text={message.text}
                  condensed={message.messageId !== reply?.messageId}
                  messageId={message.messageId}
                  onOpenDocument={onOpenDocument}
                  assistant
                  sampleSeed={sampleSeed}
                  interactive={
                    canAnswer &&
                    !active &&
                    message.messageId === reply?.messageId
                  }
                  onAnswer={onAnswer}
                  onCompose={(text) => {
                    closeReply();
                    onCompose(text);
                  }}
                />
              </article>
            ))}
            {draft ? (
              <div
                key={`draft:${snapshot?.messageKey}`}
                data-testid="reception-streaming-draft"
              >
                <p className="reception-draft-notice">
                  {t(
                    "正在回复 · 草稿，尚未核对",
                    "Responding · Draft, not yet checked",
                  )}
                </p>
                <ReceptionMarkdown text={draft} allowLinks={false} />
              </div>
            ) : !inputMessageId && reply ? (
              <article
                className="reception-current-message"
                data-testid="agent-message-assistant"
              >
                <ReceptionMessage
                  key={reply.messageId}
                  text={reply.text}
                  messageId={reply.messageId}
                  onOpenDocument={onOpenDocument}
                  assistant
                  sampleSeed={sampleSeed}
                  interactive={canAnswer}
                  onAnswer={onAnswer}
                  onCompose={(text) => {
                    closeReply();
                    onCompose(text);
                  }}
                />
              </article>
            ) : null}
          </div>
        </section>
      ) : null}
      <section
        ref={inputArea}
        className="reception-input-area"
        aria-label={t("回复接待员", "Reply to reception")}
      >
        {children}
        <nav
          className="reception-shortcuts"
          aria-label={t("试试这些方式", "Ways to explore")}
        >
          <button
            type="button"
            className="secondary"
            disabled={!canAnswer}
            onClick={() =>
              onCompose(
                t(
                  "请根据我们已讨论的信息，比较 2–3 个可行方向，说明前提、代价、人工职责和建议先试哪一步。若信息不足，请先问我。",
                  "Compare two or three feasible approaches based on what we have discussed. Explain prerequisites, tradeoffs, human responsibilities, and a recommended first step. Ask me first if you need more information.",
                ),
              )
            }
          >
            {t("比较可行方向", "Compare approaches")}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={!canAnswer}
            onClick={() =>
              onCompose(
                t(
                  "我想做一次小样演练。请先明确要演练的任务，并让我提供一条脱敏样例；参考资料可选。",
                  "I’d like to try a sample exercise. First clarify the task, then ask me for an anonymized example and optional reference material.",
                ),
              )
            }
          >
            {t("做一次小样", "Try an example")}
          </button>
        </nav>
      </section>
      <dialog
        ref={history}
        id={id}
        className="reception-history"
        aria-labelledby={`${id}-title`}
        onClose={() => toggle.current?.focus()}
        onClick={(event) => {
          if (event.target === history.current) {
            const rect = history.current.getBoundingClientRect();
            if (event.clientX < rect.left || event.clientX > rect.right)
              history.current.close();
          }
        }}
      >
        <div className="reception-history-heading">
          <div>
            <h2 id={`${id}-title`}>{t("聊天记录", "Chat history")}</h2>
            <p>
              {t(
                "回看这次交流，继续面对面聊。",
                "Review the conversation, then pick up where you left off.",
              )}
            </p>
          </div>
          <button
            type="button"
            className="quiet"
            aria-label={t("收起聊天记录", "Close chat history")}
            onClick={() => history.current?.close()}
          >
            ×
          </button>
        </div>
        <div
          ref={records}
          className="reception-messages"
          data-testid="reception-history-messages"
        >
          {messages.length ? (
            messages.map((message) => (
              <article
                key={message.messageId}
                className={`reception-message ${message.author}`}
              >
                <small>
                  {message.author === "user"
                    ? t("你", "You")
                    : t("接待助手", "Reception assistant")}
                </small>
                <ReceptionMessage
                  text={message.text}
                  messageId={message.messageId}
                  onOpenDocument={
                    onOpenDocument
                      ? (id) => {
                          history.current?.close();
                          onOpenDocument(id);
                        }
                      : undefined
                  }
                  assistant={message.author === "assistant"}
                  onAnswer={onAnswer}
                  onCompose={onCompose}
                />
              </article>
            ))
          ) : (
            <p className="form-hint">
              {t(
                "开始交流后，记录会出现在这里。",
                "Your conversation will appear here once you begin.",
              )}
            </p>
          )}
        </div>
      </dialog>
    </div>
  );
}

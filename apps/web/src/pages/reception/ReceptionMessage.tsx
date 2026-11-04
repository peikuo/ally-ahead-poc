import { useState, type ReactNode } from "react";
import {
  decodeReceptionPresentation,
  externalCases,
  isReceptionPresentationText,
  formatRequirementsDocumentRequest,
} from "@ally-ahead/contracts";
import { ReceptionExperiment } from "./ReceptionExperiments";
import { useLocale } from "../../locales/context";
import { ReceptionMarkdown } from "./ReceptionMarkdown";
import { markdownToSpeech } from "./markdown";
import { Modal } from "../../components/Modal";
import { RequirementDocumentPreview } from "./poc/RequirementDocumentPreview";

// Old plain-text history remains readable. Invalid/incomplete structured output
// is never exposed as JSON or passed to browser speech.
export function receptionBody(text: string): string {
  const presentation = decodeReceptionPresentation(text);
  if (presentation) return presentation.speech;
  if (isReceptionPresentationText(text)) return "";
  return text;
}
export function receptionSpeech(text: string): string {
  return markdownToSpeech(receptionBody(text));
}
function InteractionFrame({
  label,
  type,
  condensed,
  children,
}: {
  label: string;
  type: string;
  condensed: boolean;
  children: ReactNode;
}) {
  const content = (
    <section
      className="reception-interaction"
      role="group"
      aria-label={label}
      data-testid={`reception-${type}`}
    >
      {children}
    </section>
  );
  return condensed ? (
    <details className="reception-past-artifact">
      <summary title={label}>
        <span>{label}</span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="m6 4 4 4-4 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </summary>
      {content}
    </details>
  ) : (
    content
  );
}
export function ReceptionMessage({
  text,
  messageId,
  onOpenDocument,
  assistant,
  interactive = false,
  condensed = false,
  sampleSeed,
  onAnswer,
  onCompose,
}: {
  text: string;
  messageId?: string;
  onOpenDocument?: (messageId: string) => void;
  assistant: boolean;
  interactive?: boolean;
  condensed?: boolean;
  sampleSeed?: { task?: string; sample: string; reference: string };
  onAnswer: (body: string) => void;
  onCompose: (body: string) => void;
}) {
  const { t, locale } = useLocale();
  const presentation = assistant ? decodeReceptionPresentation(text) : null;
  const speech = assistant ? receptionBody(text) : text;
  const interaction = presentation?.interaction;
  const [selected, setSelected] = useState<string[]>([]);
  const [documentOpen, setDocumentOpen] = useState(false);
  const answer = (value: string) => {
    if (interactive) onAnswer(value);
  };
  return (
    <>
      <ReceptionMarkdown
        text={
          speech ||
          t(
            "这条回复的格式有误，暂时无法展示。原输入已保留，可重试上一条。",
            "This reply has a format error and cannot be displayed. Your input is preserved; retry the last message.",
          )
        }
      />
      {presentation?.caseReferences?.length ? (
        <aside
          className="reception-case-sources"
          aria-label={t("案例出处", "Case sources")}
        >
          <strong>{t("外部参考案例", "External case references")}</strong>
          <ul>
            {presentation.caseReferences.map((id) => {
              const item = externalCases.find(
                (candidate) => candidate.id === id,
              );
              if (!item) return null;
              return (
                <li key={id}>
                  {item.company}：
                  {item.sources.map((source) => (
                    <a
                      key={source.url}
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {source.title}
                    </a>
                  ))}
                </li>
              );
            })}
          </ul>
        </aside>
      ) : null}
      {interaction ? (
        <InteractionFrame
          label={
            "title" in interaction ? interaction.title : interaction.question
          }
          type={interaction.type}
          condensed={
            condensed &&
            !interactive &&
            ["direction_comparison", "sample_result", "demand_review"].includes(
              interaction.type,
            )
          }
        >
          {interaction.type === "requirements_document_offer" ? (
            <>
              <h3>{interaction.title}</h3>
              <ReceptionMarkdown text={interaction.prompt} />
              {interactive ? (
                <div className="actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      answer(formatRequirementsDocumentRequest(locale))
                    }
                  >
                    {t("生成需求文档", "Generate a requirements document")}
                  </button>
                  <button
                    type="button"
                    className="text-link"
                    onClick={() =>
                      document
                        .getElementById("agent-input")
                        ?.focus({ preventScroll: true })
                    }
                  >
                    {t("继续交流", "Keep discussing")}
                  </button>
                </div>
              ) : null}
            </>
          ) : interaction.type === "requirements_document" ? (
            <>
              <h3>{interaction.title}</h3>
              <p>
                {t(
                  "完整需求文档已整理，可查看、下载或提出修改。确认文档不会自动发布或付款。",
                  "The complete requirements document is ready to review, download or revise. Confirmation does not automatically publish or charge.",
                )}
              </p>
              <button
                type="button"
                className="secondary"
                disabled={!messageId}
                onClick={() => {
                  if (messageId && onOpenDocument) onOpenDocument(messageId);
                  else setDocumentOpen(true);
                }}
              >
                {t("查看需求文档", "View requirements document")}
              </button>
              {documentOpen && messageId ? (
                <Modal
                  title={interaction.title}
                  onClose={() => setDocumentOpen(false)}
                >
                  <RequirementDocumentPreview
                    documentMessageId={messageId}
                    title={interaction.title}
                    markdown={interaction.markdown}
                    confirmed={false}
                    readOnly
                    onConfirm={() => {}}
                    onRevise={() => {}}
                    onContinueDiscussion={() => setDocumentOpen(false)}
                  />
                </Modal>
              ) : null}
            </>
          ) : interaction.type === "direction_comparison" ||
            interaction.type === "sample_request" ||
            interaction.type === "sample_result" ? (
            <ReceptionExperiment
              interaction={interaction}
              sampleSeed={sampleSeed}
              interactive={interactive}
              onAnswer={answer}
              onCompose={onCompose}
            />
          ) : interaction.type === "demand_review" ? (
            <>
              <h3>{interaction.title}</h3>
              <dl>
                {(
                  [
                    ["business", t("业务场景", "Business")],
                    ["problem", t("要解决的问题", "Problem")],
                    ["expectedOutcome", t("期望结果", "Expected outcome")],
                    ["aiIntent", t("AI 的作用", "AI intent")],
                  ] as const
                ).map(([field, label]) => (
                  <div key={field}>
                    <dt>{label}</dt>
                    <dd>
                      <ReceptionMarkdown text={interaction[field]} />
                    </dd>
                    {interactive ? (
                      <button
                        type="button"
                        className="text-link"
                        aria-label={`${t("修改", "Edit")} ${label}`}
                        onClick={() =>
                          onCompose(
                            `${t("我想更正", "I’d like to correct")} ${label}（${interaction[field]}）${t("，修改为：", "; change to: ")}`,
                          )
                        }
                      >
                        {t("修改", "Edit")}
                      </button>
                    ) : null}
                  </div>
                ))}
              </dl>
              {interaction.unknowns.length ? (
                <>
                  <h4>{t("还待明确", "Still to clarify")}</h4>
                  <ul>
                    {interaction.unknowns.map((value, index) => (
                      <li key={index}>
                        <ReceptionMarkdown text={value} />
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              <p className="form-hint">
                {t(
                  "这里只核对理解，不会提交或发布需求。",
                  "This only checks our understanding. It does not submit or publish a request.",
                )}
              </p>
              {interactive ? (
                <div className="actions">
                  <button
                    type="button"
                    className="primary"
                    onClick={() =>
                      answer(t("确认这份理解", "I confirm this understanding."))
                    }
                  >
                    {t("确认理解", "Confirm understanding")}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      onCompose(t("我想继续补充：", "I’d like to add: "))
                    }
                  >
                    {t("继续补充", "Add more")}
                  </button>
                </div>
              ) : null}
            </>
          ) : interaction.type === "single_choice" ||
            interaction.type === "multiple_choice" ? (
            <>
              {!speech.trim().includes(interaction.question.trim()) ? (
                <h3>{interaction.question}</h3>
              ) : null}
              <div className="reception-options">
                {interaction.options.map((option) =>
                  interaction.type === "single_choice" ? (
                    <button
                      key={option.id}
                      type="button"
                      className="secondary"
                      disabled={!interactive}
                      onClick={() =>
                        answer(
                          `${interaction.question}\n${t("我的选择：", "My choice: ")}${option.label}`,
                        )
                      }
                    >
                      {option.label}
                    </button>
                  ) : (
                    <label key={option.id} className="check-label">
                      <input
                        type="checkbox"
                        disabled={!interactive}
                        checked={selected.includes(option.id)}
                        onChange={(event) =>
                          setSelected((values) =>
                            event.target.checked
                              ? [...values, option.id]
                              : values.filter((id) => id !== option.id),
                          )
                        }
                      />
                      {option.label}
                    </label>
                  ),
                )}
              </div>
              {interactive ? (
                <>
                  {interaction.type === "multiple_choice" ? (
                    <button
                      type="button"
                      className="primary"
                      disabled={!selected.length}
                      onClick={() =>
                        answer(
                          `${interaction.question}\n${t("我的选择：", "My choices: ")}${interaction.options
                            .filter((option) => selected.includes(option.id))
                            .map((option) => option.label)
                            .join("、")}`,
                        )
                      }
                    >
                      {t("继续", "Continue")}
                    </button>
                  ) : null}
                  <div className="actions reception-alternatives">
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => onCompose("")}
                    >
                      {t("自由补充", "Write my own answer")}
                    </button>
                    {interaction.allowSkip ? (
                      <button
                        type="button"
                        className="text-link"
                        onClick={() =>
                          answer(
                            `${interaction.question}\n${t("我还不确定。", "I’m not sure yet.")}`,
                          )
                        }
                      >
                        {t("不确定", "Not sure")}
                      </button>
                    ) : null}
                    {interaction.allowSkip ? (
                      <button
                        type="button"
                        className="text-link"
                        onClick={() =>
                          answer(
                            `${interaction.question}\n${t("先跳过这个问题。", "Skip this question for now.")}`,
                          )
                        }
                      >
                        {t("跳过", "Skip")}
                      </button>
                    ) : null}
                  </div>
                </>
              ) : null}
            </>
          ) : null}
        </InteractionFrame>
      ) : null}
    </>
  );
}

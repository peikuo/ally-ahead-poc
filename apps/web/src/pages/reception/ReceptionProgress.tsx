import { useId, useState } from "react";
import type {
  ReceptionJourney,
  ReceptionJourneyMessage,
} from "@ally-ahead/contracts";
import { Modal } from "../../components/Modal";
import { useLocale } from "../../locales/context";
import { ReceptionMessage } from "./ReceptionMessage";
import { ReceptionMarkdown } from "./ReceptionMarkdown";
import { markdownToSpeech } from "./markdown";

export function ReceptionProgress({
  journey,
  messages,
}: {
  journey: ReceptionJourney;
  messages: readonly ReceptionJourneyMessage[];
}) {
  const { t } = useLocale();
  const titleId = useId();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = journey.achievements.find((item) => item.id === selectedId);
  // Older saved projections expose only the latest source. Newer ones also
  // retain prior assistant sources when a conclusion is revised.
  const sourceIds = selected?.sourceMessageIds ?? [];
  const evidenceIds = new Set(
    selected
      ? [selected.sourceMessageId, ...sourceIds, ...selected.evidenceMessageIds]
      : [],
  );
  const evidence = messages.filter((message) =>
    evidenceIds.has(message.messageId),
  );
  const artifactLabels = {
    comparison: t("已比较方向", "Approaches compared"),
    sample: t("已试做一条", "Example tried"),
    draft: t("已整理草稿", "Draft prepared"),
    selection: t("已选定方向", "Approach selected"),
  };
  return (
    <aside
      className="reception-progress"
      aria-labelledby={titleId}
      data-testid="reception-progress"
    >
      <div className="reception-achievements-heading">
        <h2 id={titleId}>{t("阶段成果", "Conversation achievements")}</h2>
        {journey.achievements.length ? (
          <span
            aria-label={t(
              `${journey.achievements.length} 项成果`,
              `${journey.achievements.length} achievements`,
            )}
          >
            {journey.achievements.length}
          </span>
        ) : null}
      </div>
      <p className="reception-achievements-intro">
        {t(
          "本次交流中，已经做过、谈清的事。",
          "What we have worked through and clarified together.",
        )}
      </p>
      {journey.achievements.length ? (
        <ul className="reception-achievements-list">
          {journey.achievements.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="reception-achievement"
                data-testid="reception-achievement"
                aria-haspopup="dialog"
                aria-label={t(
                  `${item.title}，查看对话依据`,
                  `${item.title}. View supporting conversation`,
                )}
                onClick={() => setSelectedId(item.id)}
              >
                <span
                  className="reception-achievement-mark"
                  aria-hidden="true"
                />
                <span className="reception-achievement-copy">
                  {item.artifact ? (
                    <span className="reception-achievement-kind">
                      {artifactLabels[item.artifact]}
                    </span>
                  ) : null}
                  <strong>{markdownToSpeech(item.title)}</strong>
                  {item.summary.trim() !== item.title.trim() ? (
                    <span className="reception-achievement-summary">
                      {markdownToSpeech(item.summary)}
                    </span>
                  ) : null}
                  <span className="reception-achievement-link">
                    {t("查看依据", "View evidence")}{" "}
                    <span aria-hidden="true">↗</span>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p
          className="reception-achievements-empty"
          data-testid="reception-achievements-empty"
        >
          {t("暂无已记录的成果。", "No achievements recorded.")}
        </p>
      )}
      {selected ? (
        <Modal
          title={markdownToSpeech(selected.title)}
          onClose={() => setSelectedId(null)}
        >
          <div
            className="reception-progress-detail"
            data-testid="achievement-evidence"
          >
            {selected.artifact ? (
              <p className="form-hint">{artifactLabels[selected.artifact]}</p>
            ) : null}
            <ReceptionMarkdown
              className="reception-achievement-conclusion"
              text={selected.summary}
            />
            <h3>{t("对应的对话依据", "Supporting conversation")}</h3>
            {evidence.length ? (
              evidence.map((message) => (
                <article
                  key={message.messageId}
                  className="reception-progress-evidence"
                >
                  <small>
                    {message.author === "user"
                      ? t("你的描述与决定", "Your input and decisions")
                      : message.messageId === selected.sourceMessageId
                        ? t(
                            "当前结论对应的回复",
                            "Reply for the current conclusion",
                          )
                        : t("接待员当时的整理", "Earlier reception response")}
                  </small>
                  <ReceptionMessage
                    text={message.text}
                    messageId={message.messageId}
                    assistant={message.author === "assistant"}
                    onAnswer={() => {}}
                    onCompose={() => {}}
                  />
                </article>
              ))
            ) : (
              <p className="form-hint">
                {t(
                  "当前记录中没有可展示的对话依据。",
                  "No supporting conversation is available in the current record.",
                )}
              </p>
            )}
          </div>
        </Modal>
      ) : null}
    </aside>
  );
}

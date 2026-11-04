import { useState } from "react";
import { useLocale } from "../../../locales/context";
import { ReceptionMarkdown } from "../ReceptionMarkdown";
import "./reception-poc.css";

type Props = {
  documentMessageId: string;
  title: string;
  markdown: string;
  confirmed: boolean;
  readOnly?: boolean;
  confirmationBlocked?: boolean;
  simulationUnavailableReason?: string;
  busy?: boolean;
  error?: string;
  onConfirm: (messageId: string) => void;
  onRevise: (messageId: string, suggestion: string) => void;
  onContinueDiscussion: () => void;
  onContinueSimulation?: (messageId: string) => void;
};

export function downloadRequirementMarkdown(title: string, markdown: string) {
  const filename =
    title
      .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, " ")
      .trim()
      .slice(0, 80) || "requirements";
  const url = URL.createObjectURL(
    new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename.replace(/\.md$/i, "")}.md`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Confirmation is supplied by the authoritative parent, never inferred from a
// local click. A newly saved document gets a new identity and blank feedback.
export function RequirementDocumentPreview(props: Props) {
  return <DocumentContent key={props.documentMessageId} {...props} />;
}

function DocumentContent({
  documentMessageId,
  title,
  markdown,
  confirmed,
  readOnly = false,
  confirmationBlocked = false,
  simulationUnavailableReason,
  busy = false,
  error,
  onConfirm,
  onRevise,
  onContinueDiscussion,
  onContinueSimulation,
}: Props) {
  const { t } = useLocale();
  const [suggestion, setSuggestion] = useState("");
  return (
    <div
      className="reception-poc-document"
      data-testid="requirement-document-preview"
    >
      <p className="reception-poc-disclosure">
        <strong>{t("POC 演示", "POC demonstration")}</strong>
        {" · "}
        {t(
          "无需平台注册或登录。发布为模拟流程；付款使用 PayPal Sandbox 测试资金，不会真实收费。PayPal 测试买家窗口可能需要登录。",
          "No platform account or login is required. Publication is simulated. Payments use PayPal Sandbox test funds with no real charge. The PayPal test buyer window may require login.",
        )}
      </p>
      <div className="reception-poc-document-actions">
        <button
          type="button"
          className="secondary"
          onClick={() => downloadRequirementMarkdown(title, markdown)}
        >
          {t("下载 .md", "Download .md")}
        </button>
        <button
          type="button"
          className="text-link"
          disabled={busy}
          onClick={onContinueDiscussion}
        >
          {readOnly
            ? t("返回交流", "Back to conversation")
            : t(
                "继续交流 / 补需求或改方向",
                "Keep talking / Add details or change direction",
              )}
        </button>
      </div>
      <div className="reception-poc-document-body">
        <ReceptionMarkdown text={markdown} />
      </div>
      {!readOnly ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && suggestion.trim())
              onRevise(documentMessageId, suggestion.trim());
          }}
        >
          <label>
            {t("补充或修改建议", "Additions or changes")}
            <textarea
              rows={3}
              maxLength={10000}
              value={suggestion}
              disabled={busy}
              onChange={(event) => setSuggestion(event.target.value)}
              placeholder={t(
                "例如：缩小首期范围，补充人工审核条件…",
                "For example: narrow the initial scope or add human review conditions…",
              )}
            />
          </label>
          <button
            type="submit"
            className="secondary"
            disabled={busy || !suggestion.trim()}
          >
            {t("按建议修改文档", "Revise the document")}
          </button>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="notice">
          {error}
        </p>
      ) : null}
      {!readOnly ? (
        <div className="reception-poc-confirmation">
          <p>
            {confirmed
              ? t(
                  "当前文档已确认准确。",
                  "This document is confirmed accurate.",
                )
              : t(
                  "请先核对完整文档。确认准确不会发布需求或发起付款；文档修改后需要重新确认。",
                  "Check the complete document first. Confirming accuracy does not publish a request or start payment. Confirm again after a document change.",
                )}
          </p>
          <button
            type="button"
            className="primary"
            disabled={busy || confirmed || confirmationBlocked}
            onClick={() => onConfirm(documentMessageId)}
          >
            {confirmed
              ? t("已确认当前文档", "Current document confirmed")
              : t("确认当前文档准确", "Confirm document accuracy")}
          </button>
        </div>
      ) : null}
      {!readOnly && confirmed ? (
        <div className="reception-poc-next">
          <p>
            {t(
              "也可以继续交流；下一步需要你单独选择。",
              "You can keep discussing. The next step requires a separate choice.",
            )}
          </p>
          <button
            type="button"
            className="secondary"
            disabled={busy || !onContinueSimulation}
            onClick={() => onContinueSimulation?.(documentMessageId)}
          >
            {t("继续模拟发布", "Continue to simulated publication")}
          </button>
          {!onContinueSimulation && simulationUnavailableReason ? (
            <p role="status">{simulationUnavailableReason}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import {
  decodeReceptionPresentation,
  deriveRequirementsDocumentState,
  formatRequirementsDocumentConfirmation,
  formatRequirementsDocumentRequest,
} from "@ally-ahead/contracts";
import type {
  ReceptionView,
  ReceptionSessionView,
} from "../../../api/reception";
import { Modal } from "../../../components/Modal";
import { useLocale } from "../../../locales/context";
import {
  uniqueReceptionMessages,
  isIntermediateReceptionMessage,
} from "../reception-deliveries";
import { RequirementDocumentPreview } from "./RequirementDocumentPreview";
import { ReceptionPaymentTools } from "./ReceptionPaymentTools";

export function ReceptionRequirementsTools({
  messages: input,
  active,
  disabled,
  onSend,
  openRequest,
  session,
  paymentDisabled,
}: {
  messages: readonly ReceptionView["messages"][number][];
  active: boolean;
  disabled: boolean;
  onSend: (text: string) => void;
  openRequest: { messageId: string; requestId: string } | null;
  session: ReceptionSessionView | null;
  paymentDisabled: boolean;
}) {
  const { t, locale } = useLocale();
  const messages = useMemo(
    () =>
      uniqueReceptionMessages(input).filter(
        (message) => !isIntermediateReceptionMessage(message),
      ),
    [input],
  );
  const current = useMemo(
    () => deriveRequirementsDocumentState(messages).current,
    [messages],
  );
  const [selection, setSelection] = useState<
    "current" | { messageId: string } | null
  >(null);
  const [requested, setRequested] = useState<string | null>(null);
  const [paymentRequest, setPaymentRequest] = useState<{
    messageId: string;
    requestId: string;
  } | null>(null);
  useEffect(() => {
    if (openRequest) setSelection({ messageId: openRequest.messageId });
  }, [openRequest]);
  const selectedId =
    selection === "current" ? current?.messageId : selection?.messageId;
  const selected = messages.find(
    (message) =>
      message.author === "assistant" &&
      message.messageId ===
        (selectedId ?? (requested ? current?.messageId : undefined)),
  );
  const card = selected
    ? decodeReceptionPresentation(selected.text)?.interaction
    : null;
  const document = card?.type === "requirements_document" ? card : null;
  const isCurrent = Boolean(
    selected && selected.messageId === current?.messageId,
  );
  const latestUser = messages.findLast((message) => message.author === "user");
  const generating = requested && active && latestUser?.text === requested;
  const open = Boolean(document && (selection || requested)) || generating;
  function close() {
    setSelection(null);
    setRequested(null);
  }
  return (
    <>
      <ReceptionPaymentTools
        session={session}
        current={current}
        active={active}
        disabled={paymentDisabled}
        startRequest={paymentRequest}
      />
      <button
        type="button"
        className="text-link"
        data-testid="requirements-document-tools"
        disabled={disabled || (!current && active)}
        onClick={() => {
          if (current) setSelection("current");
          else {
            const request = formatRequirementsDocumentRequest(locale);
            setRequested(request);
            onSend(request);
          }
        }}
      >
        {current
          ? t("需求文档", "Requirements document")
          : t("生成需求文档", "Generate document")}
      </button>
      {open ? (
        <Modal
          title={
            document?.title ??
            t("整理需求文档", "Preparing a requirements document")
          }
          onClose={close}
        >
          {document && selected ? (
            <RequirementDocumentPreview
              documentMessageId={selected.messageId}
              title={document.title}
              markdown={document.markdown}
              readOnly={!isCurrent}
              confirmed={
                isCurrent &&
                Boolean(current?.confirmedByMessageId) &&
                !current?.hasPendingRevision
              }
              busy={disabled || active}
              confirmationBlocked={Boolean(current?.hasPendingRevision)}
              onConfirm={(id) =>
                onSend(formatRequirementsDocumentConfirmation(id, locale))
              }
              onRevise={(id, suggestion) => {
                setSelection("current");
                onSend(
                  formatRequirementsDocumentRequest(locale, {
                    documentMessageId: id,
                    instruction: suggestion,
                  }),
                );
              }}
              onContinueDiscussion={() => {
                close();
                requestAnimationFrame(() =>
                  window.document
                    .getElementById("agent-input")
                    ?.focus({ preventScroll: true }),
                );
              }}
              onContinueSimulation={
                isCurrent
                  ? (messageId) => {
                      close();
                      setPaymentRequest({
                        messageId,
                        requestId: crypto.randomUUID(),
                      });
                    }
                  : undefined
              }
              simulationUnavailableReason={t(
                "测试付款暂不可用，仍可下载或继续修改文档。",
                "Test checkout is currently unavailable. You can still download or revise the document.",
              )}
            />
          ) : (
            <p role="status">
              {t(
                "正在根据当前交流整理完整文档。你可以关闭此窗口，继续查看接待进度。",
                "The complete document is being prepared from this conversation. You can close this window and follow the reception progress.",
              )}
            </p>
          )}
        </Modal>
      ) : null}
    </>
  );
}

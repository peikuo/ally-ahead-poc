import { ReceptionDocuments } from "./ReceptionDocuments";
import { useReceptionDocuments } from "./useReceptionDocuments";
import { documentItem, documentLimits } from "./document-view";
import { useLocale } from "../../../locales/context";
import { useState } from "react";
import { receptionPocMode } from "../../../app/releaseMode";

export function ReceptionDocumentTools({
  session,
  disabled,
  chatActive,
}: {
  session: { sessionId: string; csrfToken: string } | null;
  disabled: boolean;
  chatActive: boolean;
}) {
  const { t } = useLocale();
  const [activated, setActivated] = useState(false);
  const docs = useReceptionDocuments(session, disabled || !activated);
  return (
    <ReceptionDocuments
      key={session?.sessionId ?? "unconnected"}
      documents={(docs.list?.documents ?? []).map((doc) =>
        documentItem(doc, t),
      )}
      limits={documentLimits(docs.list?.limits, t)}
      loading={docs.loading}
      disabled={disabled || !session}
      uploadDisabled={
        !docs.list?.processingConfigured ||
        docs.needsCheck ||
        docs.busyId !== null
      }
      serviceNotice={
        docs.list && !docs.list.processingConfigured
          ? t(
              "资料分析服务暂未就绪，可以继续聊天，稍后再试。",
              "Document analysis is not ready. Continue chatting and try later.",
            )
          : undefined
      }
      uploading={docs.uploading}
      busyId={docs.busyId}
      error={docs.error}
      ownership={null}
      onOpen={() => setActivated(true)}
      onRefresh={docs.refresh}
      onUpload={docs.upload}
      onRetry={docs.retry}
      onResumeUpload={docs.resume}
      onSupplement={docs.supplement}
    />
  );
}

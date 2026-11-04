import { RECEPTION_DOCUMENT_LIMITS } from "@ally-ahead/contracts";
import type {
  DocumentList,
  DocumentView,
} from "../../../api/receptionDocuments";
import type {
  ReceptionDocumentItem,
  ReceptionDocumentLimits,
} from "./ReceptionDocuments";
type Translate = (zh: string, en: string) => string;
export function documentLimits(
  limits:
    | DocumentList["limits"]
    | typeof RECEPTION_DOCUMENT_LIMITS = RECEPTION_DOCUMENT_LIMITS,
  t: Translate,
): ReceptionDocumentLimits {
  const unit = limits.bytesPerMiB;
  return {
    maxFiles: limits.maxFiles,
    maxTotalBytes: limits.maxTotalBytes,
    types: [
      {
        extensions: ["txt"],
        maxBytes: limits.txtBytes,
        label: `TXT (${limits.txtBytes / unit} MiB)`,
      },
      {
        extensions: ["md"],
        maxBytes: limits.mdBytes,
        label: `Markdown (${limits.mdBytes / unit} MiB)`,
      },
      {
        extensions: ["docx"],
        maxBytes: limits.docxBytes,
        label: `DOCX (${limits.docxBytes / unit} MiB)`,
      },
      {
        extensions: ["pdf"],
        maxBytes: limits.pdfBytes,
        label: `PDF (${limits.pdfBytes / unit} MiB)`,
      },
    ],
    description: t(
      `TXT/Markdown ≤${limits.txtBytes / unit} MiB；DOCX ≤${limits.docxBytes / unit} MiB；文字型 PDF ≤${limits.pdfBytes / unit} MiB、最多 ${limits.maxPdfPages} 页。每次接待最多 ${limits.maxFiles} 个文件、合计 ${limits.maxTotalBytes / unit} MiB。1 MiB = 1,048,576 字节；解析正文最多 ${limits.maxTextCharacters.toLocaleString()} 字符，超出需拆分。`,
      `TXT/Markdown ≤${limits.txtBytes / unit} MiB; DOCX ≤${limits.docxBytes / unit} MiB; text-based PDF ≤${limits.pdfBytes / unit} MiB and ${limits.maxPdfPages} pages. Up to ${limits.maxFiles} files / ${limits.maxTotalBytes / unit} MiB per reception. 1 MiB = 1,048,576 bytes. Extracted text is limited to ${limits.maxTextCharacters.toLocaleString()} characters; split longer documents.`,
    ),
  };
}
export function documentItem(
  doc: DocumentView,
  t: Translate,
): ReceptionDocumentItem {
  const sources = doc.sources;
  const pending =
    ["queued", "processing"].includes(doc.state) ||
    sources.some((source) => ["queued", "processing"].includes(source.state));
  const failures = sources
    .filter((source) => source.failure)
    .map((source) => source.failure!);
  const uncertain =
    doc.state === "outcome_unknown" ||
    sources.some((source) => source.state === "outcome_unknown");
  const coverage = sources.flatMap((source) => {
    const prefix =
      source.kind === "supplement"
        ? t(
            `用户补充${source.userLocation ? `（用户说明：${source.userLocation}）` : ""}：`,
            `User supplement${source.userLocation ? ` (location described by user: ${source.userLocation})` : ""}: `,
          )
        : "";
    return [
      ...source.coverage.read.map(
        (value) => `${prefix}${t("已读：", "Read: ")}${value}`,
      ),
      ...source.coverage.unread.map(
        (value) => `${prefix}${t("未读：", "Unread: ")}${value}`,
      ),
      ...source.coverage.unreliable.map(
        (value) =>
          `${prefix}${t("不可靠、待核对：", "Unreliable; needs checking: ")}${value}`,
      ),
      ...(source.quality === "partial" &&
      !source.coverage.unread.length &&
      !source.coverage.unreliable.length
        ? [
            prefix +
              t(
                "只读到部分内容，缺失范围无法确认。",
                "Only part was readable; the missing range cannot be confirmed.",
              ),
          ]
        : []),
    ];
  });
  const partial =
    doc.state === "partial" ||
    sources.some((source) => source.quality === "partial");
  const status = uncertain
    ? t("处理结果尚待核对", "Processing outcome needs checking")
    : doc.state === "uploading"
      ? t("原文件尚未上传完成", "Original upload is incomplete")
      : doc.state === "queued"
        ? t("已上传，等待处理", "Uploaded; awaiting processing")
        : pending
          ? sources.some(
              (source) =>
                source.state === "processing" && source.stage === "segment",
            )
            ? t("正在分段整理", "Organizing sections")
            : t("正在解析正文", "Extracting text")
          : doc.state === "failed"
            ? t("资料处理未完成", "Document processing did not complete")
            : partial
              ? t(
                  "部分可用 · 仍有未读或不可靠内容",
                  "Partly available · unread or unreliable material remains",
                )
              : t("可读资料已整理", "Readable material organized");
  const failureText = failures
    .map(
      (failure) =>
        `${t(failure.stage === "parse" ? "解析正文" : failure.stage === "segment" ? "分段摘要" : "上传原件", failure.stage === "parse" ? "Text extraction" : failure.stage === "segment" ? "Section summaries" : "Original upload")}：${failure.message}`,
    )
    .join("；");
  return {
    id: doc.id,
    name: doc.fileName,
    bytes: doc.declaredBytes,
    status,
    detail: uncertain
      ? t(
          "先查询实际状态，避免重复启动处理。",
          "Check the actual status before starting another attempt.",
        )
      : failureText ||
        (doc.state === "ready"
          ? t(
              "资料整理不表示业务事实或需求已由你确认。",
              "Organizing material does not confirm its business facts or your requirements.",
            )
          : partial
            ? t(
                "仅使用已经读到的内容，未补充部分保持未知。",
                "Only the readable content can be used; missing parts remain unknown.",
              )
            : undefined),
    tone: pending
      ? "working"
      : doc.state === "ready" && !partial
        ? "ready"
        : "attention",
    coverage,
    uncertain,
    canRetry:
      !pending && !uncertain && failures.some((failure) => failure.retryable),
    canSupplement: !pending && !uncertain && doc.state !== "uploading",
    sources: sources.map((source) => ({
      id: source.id,
      label:
        source.kind === "supplement"
          ? t(
              `用户补充${source.userLocation ? `（用户说明：${source.userLocation}）` : ""}`,
              `User supplement${source.userLocation ? ` (user-described: ${source.userLocation})` : ""}`,
            )
          : t("原件正文", "Original text"),
      readable: source.quality !== null,
      summary: source.summary,
    })),
    canRecover:
      uncertain && !pending && !failures.some((failure) => !failure.retryable),
    canReplace: !pending && !uncertain,
    canResumeUpload: doc.state === "uploading" && !uncertain,
  };
}

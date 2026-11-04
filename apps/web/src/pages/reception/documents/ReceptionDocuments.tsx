import { useId, useRef, useState, type ReactNode } from "react";
import { receptionDocumentsApi } from "../../../api/receptionDocuments";
import { Modal } from "../../../components/Modal";
import { useLocale } from "../../../locales/context";
import "./documents.css";

// Presentation model only. The API adapter supplies authoritative status,
// coverage and retry availability; this component never infers them from time.
export type ReceptionDocumentItem = {
  id: string;
  name: string;
  bytes: number;
  status: string;
  detail?: string;
  tone: "working" | "ready" | "attention";
  coverage: string[];
  canRetry: boolean;
  canSupplement: boolean;
  uncertain: boolean;
  canResumeUpload: boolean;
  canRecover: boolean;
  canReplace: boolean;
  sources: { id: string; label: string; readable: boolean; summary: string }[];
};
export type ReceptionDocumentLimits = {
  maxFiles: number;
  maxTotalBytes: number;
  types: { extensions: string[]; maxBytes: number; label: string }[];
  description: string;
};
type Props = {
  documents: ReceptionDocumentItem[];
  limits: ReceptionDocumentLimits;
  loading: boolean;
  disabled: boolean;
  busyId: string | null;
  uploading: boolean;
  uploadDisabled: boolean;
  serviceNotice?: string;
  error: string | null;
  onOpen: () => void;
  onRefresh: () => void;
  onUpload: (files: File[], replacesDocumentId?: string) => Promise<File[]>;
  ownership?: ReactNode;
  onResumeUpload: (id: string, file: File) => Promise<void>;
  onRetry: (id: string) => Promise<void>;
  onSupplement: (
    id: string,
    text: string,
    location: string,
    targetSourceId?: string,
  ) => Promise<boolean>;
};

export function ReceptionDocuments(props: Props) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const inputId = useId();
  const chooser = useRef<HTMLInputElement>(null);
  const uploadButton = useRef<HTMLButtonElement>(null);
  const [replaces, setReplaces] = useState<string | null>(null);
  const replacement = useRef<string | null>(null);
  const used = props.documents.reduce((sum, doc) => sum + doc.bytes, 0);
  const accept = props.limits.types
    .flatMap((type) => type.extensions.map((ext) => `.${ext}`))
    .join(",");
  function select(values: File[]) {
    let error: string | null = null;
    if (replacement.current && values.length !== 1) {
      error = t(
        "替换资料时请只选择一个文件。",
        "Choose one file when replacing a document.",
      );
    } else if (
      values.length + props.documents.length - (replacement.current ? 1 : 0) >
      props.limits.maxFiles
    ) {
      error = t(
        `本次接待最多 ${props.limits.maxFiles} 个文件，请减少选择。`,
        `This reception supports up to ${props.limits.maxFiles} files. Select fewer files.`,
      );
    } else if (
      values.reduce(
        (sum, file) => sum + file.size,
        used -
          (props.documents.find((doc) => doc.id === replacement.current)
            ?.bytes ?? 0),
      ) > props.limits.maxTotalBytes
    ) {
      error = t(
        "超过本次接待的文件总额度，请缩小资料后上传。",
        "These files exceed this reception’s total allowance. Use smaller documents.",
      );
    } else {
      for (const file of values) {
        const extension = file.name.split(".").at(-1)?.toLowerCase();
        const type = props.limits.types.find((type) =>
          type.extensions.includes(extension ?? ""),
        );
        if (!type)
          error = t(
            `不支持「${file.name}」的格式，请使用 TXT、Markdown、DOCX 或文字型 PDF。`,
            `“${file.name}” is not supported. Use TXT, Markdown, DOCX or a text-based PDF.`,
          );
        else if (!file.size)
          error = t(
            `「${file.name}」是空文件，请检查后重新选择。`,
            `“${file.name}” is empty. Check the file and select it again.`,
          );
        else if (file.size > type.maxBytes)
          error = t(
            `「${file.name}」超过 ${type.label} 的单文件限制。`,
            `“${file.name}” exceeds the ${type.label} per-file limit.`,
          );
        if (error) break;
      }
    }
    setSelectionError(error);
    setFiles(error ? [] : values);
    if (!error && values.length)
      requestAnimationFrame(() =>
        uploadButton.current?.scrollIntoView({ block: "nearest" }),
      );
  }
  async function upload() {
    if (!files.length || props.uploading || props.disabled) return;
    // Recheck against the latest server list if another upload finished meanwhile.
    if (
      files.length + props.documents.length - (replaces ? 1 : 0) >
        props.limits.maxFiles ||
      files.reduce(
        (n, f) => n + f.size,
        used - (props.documents.find((doc) => doc.id === replaces)?.bytes ?? 0),
      ) > props.limits.maxTotalBytes
    ) {
      select(files);
      return;
    }
    const remaining = await props.onUpload(files, replaces ?? undefined);
    setFiles(remaining);
    if (!remaining.length) {
      setReplaces(null);
      replacement.current = null;
    }
  }
  return (
    <>
      <button
        type="button"
        className="text-link"
        data-testid="reception-documents-toggle"
        disabled={props.disabled && !props.documents.length}
        onClick={() => {
          props.onOpen();
          setOpen(true);
        }}
      >
        {t("资料", "Documents")}
        {props.documents.length ? ` ${props.documents.length}` : ""}
        {props.documents.some((doc) => doc.tone === "working")
          ? t(" · 处理中", " · Processing")
          : props.documents.some((doc) => doc.tone === "attention")
            ? t(" · 待查看", " · Needs attention")
            : ""}
      </button>
      {open ? (
        <Modal
          title={t("本次接待资料", "Documents for this conversation")}
          onClose={() => setOpen(false)}
        >
          <div
            className="reception-documents"
            data-testid="reception-documents"
          >
            <p className="form-hint">
              {t(
                "上传非机密、已脱敏的资料，供本次接待的模型分析；不会自动公开或加入案例库。",
                "Upload non-confidential, anonymized material for model analysis in this conversation. It will not be published or added to the case library automatically.",
              )}
            </p>
            <p className="reception-document-limits">
              {props.limits.description}
            </p>
            {props.ownership}
            {props.serviceNotice ? (
              <p className="notice" role="status">
                {props.serviceNotice}
              </p>
            ) : null}
            <div className="reception-document-upload">
              {replaces ? (
                <button
                  type="button"
                  className="text-link"
                  disabled={props.uploading}
                  onClick={() => {
                    setFiles([]);
                    setReplaces(null);
                    replacement.current = null;
                    setSelectionError(null);
                  }}
                >
                  {t("取消替换", "Cancel replacement")}
                </button>
              ) : null}
              {replaces ? (
                <p className="form-hint">
                  {t(
                    `准备替换「${props.documents.find((doc) => doc.id === replaces)?.name ?? "资料"}」。旧原件保留，替换后重新解析整理；历史原件仍占存储额度。`,
                    `Replacing “${props.documents.find((doc) => doc.id === replaces)?.name ?? "document"}”. The original is retained; the replacement will be processed separately. Retained originals still use storage.`,
                  )}
                </p>
              ) : null}
              <button
                type="button"
                className="secondary"
                disabled={
                  props.disabled ||
                  props.uploading ||
                  props.loading ||
                  props.uploadDisabled
                }
                onClick={() => {
                  setFiles([]);
                  chooser.current?.click();
                }}
              >
                {t("选择文件", "Choose files")}
              </button>
              <input
                ref={chooser}
                hidden
                id={inputId}
                key={files.map((file) => file.name).join("|") || "empty"}
                type="file"
                accept={accept}
                multiple={!replaces}
                disabled={
                  props.disabled ||
                  props.uploading ||
                  props.loading ||
                  props.uploadDisabled
                }
                onChange={(event) =>
                  select(Array.from(event.target.files ?? []))
                }
                data-testid="reception-document-input"
              />
              {files.length ? (
                <div className="reception-document-selection">
                  <ul>
                    {files.map((file, index) => (
                      <li key={`${file.name}:${index}`}>{file.name}</li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className="text-link"
                    disabled={props.uploading}
                    onClick={() => {
                      setFiles([]);
                      setSelectionError(null);
                    }}
                  >
                    {t("重新选择", "Change selection")}
                  </button>
                </div>
              ) : null}
              {selectionError ? (
                <p className="notice" role="alert">
                  {selectionError}
                </p>
              ) : null}
              <button
                type="button"
                className="primary"
                disabled={
                  props.disabled ||
                  props.uploading ||
                  props.loading ||
                  props.uploadDisabled ||
                  !files.length
                }
                onClick={() => void upload()}
                ref={uploadButton}
                data-testid="upload-reception-documents"
              >
                {props.uploading
                  ? t("正在上传…", "Uploading…")
                  : replaces
                    ? t("替换并分析", "Replace and analyze")
                    : t("上传并分析", "Upload and analyze")}
              </button>
            </div>
            {props.error ? (
              <p role="alert" className="notice">
                {props.error}
              </p>
            ) : null}
            <div className="between">
              <h3>{t("已上传资料", "Uploaded documents")}</h3>
              <button
                type="button"
                className="text-link"
                disabled={props.loading || props.disabled}
                onClick={props.onRefresh}
              >
                {props.loading
                  ? t("核对中…", "Checking…")
                  : t("刷新状态", "Refresh status")}
              </button>
            </div>
            {!props.documents.length ? (
              <p className="form-hint">
                {props.loading
                  ? t("正在读取资料状态…", "Loading document status…")
                  : props.error
                    ? t(
                        "暂时无法确认资料列表，请刷新状态后再上传。",
                        "The document list could not be confirmed. Refresh its status before uploading.",
                      )
                    : t(
                        "还没有上传资料，也可以直接在聊天中粘贴相关文字。",
                        "No documents yet. You can also paste relevant text into the chat.",
                      )}
              </p>
            ) : (
              <div className="reception-document-list">
                {props.documents.map((doc) => (
                  <DocumentItem
                    key={doc.id}
                    document={doc}
                    disabled={
                      props.disabled ||
                      props.uploading ||
                      props.uploadDisabled ||
                      props.busyId !== null
                    }
                    busy={props.busyId === doc.id}
                    onRetry={() => props.onRetry(doc.id)}
                    onReplace={() => {
                      replacement.current = doc.id;
                      setReplaces(doc.id);
                      setFiles([]);
                      setSelectionError(null);
                      chooser.current?.click();
                    }}
                    onRefresh={props.onRefresh}
                    onSupplement={(text, location, sourceId) =>
                      props.onSupplement(doc.id, text, location, sourceId)
                    }
                    onResumeUpload={(file) =>
                      props.onResumeUpload(doc.id, file)
                    }
                  />
                ))}
              </div>
            )}
            <p className="form-hint">
              {t(
                "打不开或只读到部分内容时，可补贴当前问题相关文字。资料处理和等待补充都不妨碍继续聊天。",
                "If a file cannot be read completely, paste the part relevant to your question. Processing and missing material do not prevent you from continuing the conversation.",
              )}
            </p>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setOpen(false);
                requestAnimationFrame(() =>
                  document
                    .getElementById("agent-input")
                    ?.focus({ preventScroll: true }),
                );
              }}
            >
              {t("继续聊", "Continue chatting")}
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function DocumentItem({
  document: doc,
  disabled,
  busy,
  onRetry,
  onRefresh,
  onSupplement,
  onResumeUpload,
  onReplace,
}: {
  document: ReceptionDocumentItem;
  disabled: boolean;
  busy: boolean;
  onRetry: () => Promise<void>;
  onRefresh: () => void;
  onSupplement: (
    text: string,
    location: string,
    targetSourceId?: string,
  ) => Promise<boolean>;
  onResumeUpload: (file: File) => Promise<void>;
  onReplace: () => void;
}) {
  const { t } = useLocale();
  const [supplementing, setSupplementing] = useState(false);
  const [text, setText] = useState("");
  const [location, setLocation] = useState("");
  const id = useId();
  const [targetSource, setTargetSource] = useState(doc.sources[0]?.id ?? "");
  const chosenSource = doc.sources.some((source) => source.id === targetSource)
    ? targetSource
    : (doc.sources[0]?.id ?? "");
  const resumeChooser = useRef<HTMLInputElement>(null);
  return (
    <article
      className="reception-document-item"
      data-document-id={doc.id}
      data-tone={doc.tone}
    >
      <h4>{doc.name}</h4>
      <p className="reception-document-status" role="status">
        {doc.status}
      </p>
      {doc.detail ? <p>{doc.detail}</p> : null}
      {doc.coverage.length ? (
        <ul className="reception-document-coverage">
          {doc.coverage.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : null}
      <div className="reception-document-actions">
        {doc.canReplace ? (
          <button
            type="button"
            className="text-link"
            disabled={disabled || busy}
            onClick={onReplace}
          >
            {t("换一个文件", "Replace document")}
          </button>
        ) : null}
        {doc.canRecover ? (
          <button
            type="button"
            className="secondary"
            disabled={disabled || busy}
            onClick={() => void onRetry()}
          >
            {t("核对并恢复未完成步骤", "Check and recover the incomplete step")}
          </button>
        ) : null}
        {doc.canResumeUpload ? (
          <>
            <button
              type="button"
              className="secondary"
              disabled={disabled || busy}
              onClick={() => resumeChooser.current?.click()}
            >
              {t(
                "重新选择原文件继续上传",
                "Choose the original file to resume",
              )}
            </button>
            <input
              hidden
              ref={resumeChooser}
              type="file"
              disabled={disabled || busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onResumeUpload(file);
                event.target.value = "";
              }}
            />
          </>
        ) : null}
        {doc.uncertain ? (
          <button
            type="button"
            className="secondary"
            disabled={disabled || busy}
            onClick={onRefresh}
          >
            {t("先核对实际状态", "Check actual status first")}
          </button>
        ) : doc.canRetry ? (
          <button
            type="button"
            className="secondary"
            disabled={disabled || busy}
            onClick={() => void onRetry()}
          >
            {busy
              ? t("正在提交…", "Submitting…")
              : t("重试失败步骤", "Retry the failed step")}
          </button>
        ) : null}
        {doc.canSupplement ? (
          <button
            type="button"
            className="text-link"
            disabled={disabled || busy}
            onClick={() => setSupplementing(!supplementing)}
          >
            {supplementing
              ? t("收起补充", "Hide supplement")
              : t("补充缺失文字", "Add missing text")}
          </button>
        ) : null}
      </div>
      {doc.sources.some((source) => source.readable) ? (
        <details className="reception-document-sources">
          <summary>
            {t("查看资料摘要与正文", "View document summaries and text")}
          </summary>
          {doc.sources.map((source) => (
            <div key={source.id}>
              <strong>{source.label}</strong>
              {source.summary ? <p>{source.summary}</p> : null}
              {source.readable ? (
                <a
                  className="text-link"
                  href={receptionDocumentsApi.markdownUrl(doc.id, source.id)}
                  download
                >
                  {t("下载可读正文", "Download readable text")}
                </a>
              ) : null}
            </div>
          ))}
          <a
            className="text-link"
            href={receptionDocumentsApi.originalUrl(doc.id)}
            download
          >
            {t("下载原文件", "Download original")}
          </a>
        </details>
      ) : null}
      {supplementing ? (
        <form
          className="reception-document-supplement"
          onSubmit={(event) => {
            event.preventDefault();
            if (!text.trim() || busy || disabled) return;
            void onSupplement(
              text.trim(),
              location.trim(),
              chosenSource || undefined,
            ).then((saved) => {
              if (saved) {
                setText("");
                setLocation("");
                setSupplementing(false);
              }
            });
          }}
        >
          <p className="form-hint">
            {t(
              `补充到「${doc.name}」，来源会标为“用户补充”，不会修改原文件。`,
              `Add to “${doc.name}”. The source will be labeled “User supplement”; the original file stays intact.`,
            )}
          </p>
          {doc.sources.length > 1 ? (
            <>
              <label htmlFor={`${id}-source`}>
                {t(
                  "补充到哪份内容",
                  "Which source does this supplement belong to?",
                )}
              </label>
              <select
                id={`${id}-source`}
                value={chosenSource}
                onChange={(event) => setTargetSource(event.target.value)}
                disabled={disabled || busy}
              >
                {doc.sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.label}
                  </option>
                ))}
              </select>
            </>
          ) : null}
          <label htmlFor={`${id}-location`}>
            {t("你说明的位置（选填）", "Location you describe (optional)")}
          </label>
          <input
            id={`${id}-location`}
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            maxLength={200}
            placeholder={t(
              "例如：第 3 页，或售后条款章节",
              "For example: page 3 or the returns section",
            )}
            disabled={busy || disabled}
          />
          <label htmlFor={`${id}-text`}>
            {t("补充文字", "Supplementary text")}
          </label>
          <textarea
            id={`${id}-text`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={5}
            maxLength={20000}
            required
            disabled={busy || disabled}
          />
          <button
            type="submit"
            className="primary"
            disabled={busy || disabled || !text.trim()}
          >
            {busy
              ? t("正在保存…", "Saving…")
              : t("保存补充并整理", "Save and process supplement")}
          </button>
        </form>
      ) : null}
    </article>
  );
}

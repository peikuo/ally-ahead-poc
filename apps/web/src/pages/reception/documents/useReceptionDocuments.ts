import { useCallback, useEffect, useRef, useState } from "react";
import {
  receptionDocumentsApi,
  type DocumentList,
  type DocumentView,
} from "../../../api/receptionDocuments";
import { isAborted, RequestError } from "../../../api/client";
import { useLocale } from "../../../locales/context";

export function useReceptionDocuments(
  session: { sessionId: string; csrfToken: string } | null,
  disabled: boolean,
) {
  const { t } = useLocale();
  const scope = session?.sessionId ?? "";
  const currentScope = useRef(scope);
  const token = useRef(session?.csrfToken);
  const blocked = useRef(disabled);
  useEffect(() => {
    token.current = session?.csrfToken;
    blocked.current = disabled;
  }, [session?.csrfToken, disabled]);
  const [data, setData] = useState<{
    scope: string;
    list: DocumentList | null;
  }>({ scope, list: null });
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [needsCheck, setNeedsCheck] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const readRequest = useRef<AbortController | null>(null);
  const mutationRequest = useRef<AbortController | null>(null);
  const requestKeys = useRef(new Map<string, string>());
  const list = data.scope === scope ? data.list : null;
  const processing = Boolean(
    list?.documents.some(
      (doc) =>
        ["queued", "processing"].includes(doc.state) ||
        doc.sources.some((source) =>
          ["queued", "processing"].includes(source.state),
        ),
    ),
  );

  function describe(error: unknown) {
    if (error instanceof RequestError) {
      if ([401, 403].includes(error.status))
        return t(
          "本次接待资料暂时无法访问，请先重新连接接待。",
          "These documents cannot be accessed. Reconnect the reception first.",
        );
      if (
        error.status === 404 ||
        error.code === "NOT_READY" ||
        error.status === 503
      )
        return t(
          "资料服务暂未就绪，可以继续文字聊天，稍后再刷新资料状态。",
          "The document service is not ready. Continue chatting and refresh document status later.",
        );
      if (error.status === 409)
        return t(
          "资料状态已变化，请先刷新状态；正在处理的步骤不会重复启动。",
          "Document status has changed. Refresh it first; active steps will not be restarted.",
        );
      if (error.status === 429)
        return t(
          "资料数量或保存额度已用满。历史原件也占用额度，请缩小新文件，或改为补充当前问题相关的少量文字。",
          "The document or storage allowance is full. Retained originals also use storage. Use a smaller file or add a short relevant text supplement.",
        );
      if ([413, 422].includes(error.status))
        return t(
          "资料未通过校验，请检查文件格式、大小、PDF页数或补充文字长度；超长正文请拆分。",
          "The document did not pass validation. Check its format, size, PDF pages or supplementary text length. Split long documents.",
        );
      if (error.status === 0 || error.code === "INVALID_RESPONSE")
        return t(
          "未能确认请求结果，请先刷新实际状态，避免重复上传或处理。",
          "The request outcome could not be confirmed. Refresh the actual status before trying again.",
        );
    }
    return t(
      "资料操作没有完成，请刷新状态核对后再试；你仍可继续聊天。",
      "The document operation did not complete. Refresh its status before retrying. You can still continue chatting.",
    );
  }
  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);
  useEffect(() => {
    currentScope.current = scope;
    mutationRequest.current?.abort();
    mutationRequest.current = null;
    requestKeys.current.clear();
    setError(null);
    setActionError(null);
    setNeedsCheck(false);
    setUploading(false);
    setBusyId(null);
    return () => {
      currentScope.current = "";
      readRequest.current?.abort();
      mutationRequest.current?.abort();
    };
  }, [scope]);
  useEffect(() => {
    if (!scope || disabled || mutationRequest.current) return;
    const controller = new AbortController();
    readRequest.current?.abort();
    readRequest.current = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async (foreground: boolean) => {
      if (foreground) setLoading(true);
      try {
        const next = await receptionDocumentsApi.list(controller.signal);
        if (controller.signal.aborted || currentScope.current !== scope) return;
        if (next.documents.some((doc) => doc.sessionId !== scope))
          throw new RequestError(200, "INVALID_RESPONSE");
        setData({ scope, list: next });
        setError(null);
        setNeedsCheck(false);
        if (
          next.documents.some(
            (doc) =>
              ["queued", "processing"].includes(doc.state) ||
              doc.sources.some((source) =>
                ["queued", "processing"].includes(source.state),
              ),
          )
        )
          timer = setTimeout(() => void load(false), 1500);
      } catch (fault) {
        if (
          !controller.signal.aborted &&
          currentScope.current === scope &&
          !isAborted(fault)
        ) {
          if (
            fault instanceof RequestError &&
            [401, 403].includes(fault.status)
          ) {
            setData({ scope, list: null });
            requestKeys.current.clear();
          }
          setError(describe(fault));
          setNeedsCheck(true);
        }
      } finally {
        if (!controller.signal.aborted && currentScope.current === scope)
          setLoading(false);
      }
    };
    void load(true);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // Polling only observes saved processing state. It never retries processing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, disabled, refreshKey, processing]);

  function key(value: string) {
    let id = requestKeys.current.get(value);
    if (!id) {
      id = crypto.randomUUID();
      requestKeys.current.set(value, id);
    }
    return id;
  }
  function begin(forClaim = false) {
    if (
      !scope ||
      currentScope.current !== scope ||
      !token.current ||
      blocked.current ||
      mutationRequest.current ||
      needsCheck ||
      (!forClaim && !list?.processingConfigured)
    )
      return null;
    readRequest.current?.abort();
    const controller = new AbortController();
    mutationRequest.current = controller;
    return { controller, token: token.current };
  }
  function accept(
    doc: DocumentView,
    controller: AbortController,
    replacedId?: string,
  ) {
    controller.signal.throwIfAborted();
    if (currentScope.current !== scope || doc.sessionId !== scope)
      throw new RequestError(200, "INVALID_RESPONSE");
    setData((previous) =>
      previous.scope === scope && previous.list
        ? {
            scope,
            list: {
              ...previous.list,
              documents: [
                ...previous.list.documents.filter(
                  (value) => value.id !== doc.id && value.id !== replacedId,
                ),
                doc,
              ],
            },
          }
        : previous,
    );
  }
  function fail(fault: unknown, controller: AbortController) {
    if (
      !controller.signal.aborted &&
      currentScope.current === scope &&
      !isAborted(fault)
    ) {
      if (fault instanceof RequestError && [401, 403].includes(fault.status)) {
        setData({ scope, list: null });
        requestKeys.current.clear();
      }
      setActionError(describe(fault));
      setNeedsCheck(true);
    }
  }
  function finish(controller: AbortController) {
    if (mutationRequest.current !== controller) return;
    mutationRequest.current = null;
    if (!controller.signal.aborted && currentScope.current === scope) {
      setUploading(false);
      setBusyId(null);
      refresh();
    }
  }
  async function upload(files: File[], replacesDocumentId?: string) {
    const work = begin();
    if (!work) return files;
    setUploading(true);
    setActionError(null);
    try {
      for (let index = 0; index < files.length; index++) {
        const file = files[index]!;
        try {
          const requestKey = key(
            `file:${replacesDocumentId ?? "new"}:${file.name}:${file.size}:${file.lastModified}`,
          );
          const reserved = await receptionDocumentsApi.reserve(
            work.token,
            file,
            requestKey,
            work.controller.signal,
            replacesDocumentId,
          );
          accept(reserved, work.controller, replacesDocumentId);
          if (reserved.state === "uploading")
            accept(
              await receptionDocumentsApi.content(
                work.token,
                reserved.id,
                file,
                work.controller.signal,
              ),
              work.controller,
            );
        } catch (fault) {
          fail(fault, work.controller);
          // Never leave already accepted files selected for a new reservation.
          // The attempted file is checked in the server list; untouched files stay.
          return files.slice(index + 1);
        }
      }
      return [];
    } finally {
      finish(work.controller);
    }
  }
  async function retry(id: string) {
    const doc = list?.documents.find((doc) => doc.id === id);
    if (
      !doc ||
      ["queued", "processing", "uploading"].includes(doc.state) ||
      (!doc.sources.some((source) => source.failure?.retryable) &&
        doc.state !== "outcome_unknown" &&
        !doc.sources.some((source) => source.state === "outcome_unknown"))
    )
      return;
    const work = begin();
    if (!work) return;
    setBusyId(id);
    setActionError(null);
    try {
      accept(
        await receptionDocumentsApi.retry(
          work.token,
          id,
          work.controller.signal,
        ),
        work.controller,
      );
    } catch (fault) {
      fail(fault, work.controller);
    } finally {
      finish(work.controller);
    }
  }
  async function resume(id: string, file: File) {
    const doc = list?.documents.find((doc) => doc.id === id);
    if (!doc || doc.state !== "uploading") return;
    if (file.name !== doc.fileName || file.size !== doc.declaredBytes) {
      setActionError(
        t(
          "请选择与原上传同名、同大小的文件；替换资料需作为新文件上传。",
          "Choose the original file with the same name and size. Upload replacements as new documents.",
        ),
      );
      return;
    }
    const work = begin();
    if (!work) return;
    setBusyId(id);
    setActionError(null);
    try {
      accept(
        await receptionDocumentsApi.content(
          work.token,
          id,
          file,
          work.controller.signal,
        ),
        work.controller,
      );
    } catch (fault) {
      fail(fault, work.controller);
    } finally {
      finish(work.controller);
    }
  }
  async function supplement(
    id: string,
    text: string,
    location: string,
    targetSourceId?: string,
  ) {
    const doc = list?.documents.find((doc) => doc.id === id);
    if (!doc || ["queued", "processing", "uploading"].includes(doc.state))
      return false;
    const work = begin();
    if (!work) return false;
    setBusyId(id);
    setActionError(null);
    try {
      const requestKey = key(
        JSON.stringify([id, text, location, targetSourceId]),
      );
      accept(
        await receptionDocumentsApi.supplement(
          work.token,
          id,
          text,
          location,
          requestKey,
          work.controller.signal,
          targetSourceId,
        ),
        work.controller,
      );
      return true;
    } catch (fault) {
      fail(fault, work.controller);
      return false;
    } finally {
      finish(work.controller);
    }
  }
  return {
    list,
    loading,
    error: actionError ?? error,
    uploading,
    busyId,
    needsCheck,
    refresh,
    upload,
    retry,
    resume,
    supplement,
    processing,
  };
}

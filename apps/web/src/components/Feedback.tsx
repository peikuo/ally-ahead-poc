import { RequestError } from "../api/client";
import type { ReactNode } from "react";
import { useLocale } from "../locales/context";

export function useErrorText() {
  const { t } = useLocale();
  return (error: unknown): string => {
    if (!(error instanceof RequestError))
      return t("请核对输入后重试。", "Check your input and try again.");
    if (error.code === "CHALLENGE_INVALID")
      return t(
        "验证码不正确、已失效或已被使用，请核对或重新获取。",
        "The code is invalid, expired or already used. Check it or request another.",
      );
    if (error.status === 401)
      return t(
        "登录已失效，请重新登录。",
        "Your session has expired. Sign in again.",
      );
    if (error.status === 403)
      return t(
        "当前没有执行此操作的权限，请重新读取空间状态。",
        "Your current access does not allow this action. Refresh the space.",
      );
    if (error.status === 409)
      return t(
        "状态或版本已变化，请重新读取后再操作。",
        "The state or version changed. Refresh before trying again.",
      );
    if (error.status === 422)
      return t(
        "输入不符合要求，请核对后重试。",
        "Check the input requirements and try again.",
      );
    if (error.status === 429)
      return t(
        "操作过于频繁，请稍后再试。",
        "Too many requests. Please try again later.",
      );
    if (error.code === "MAIL_UNAVAILABLE")
      return t(
        "暂时无法发送登录验证码，请稍后再试。",
        "Login codes are temporarily unavailable. Please try again later.",
      );
    if (error.code === "NOT_READY")
      return t(
        "此操作所需服务尚未就绪，没有确认完成。请保留当前内容，稍后重新读取状态。",
        "A required service is not ready. Completion is not confirmed. Keep your content and refresh the state later.",
      );
    if (error.status === 404)
      return t(
        "内容不存在，或当前空间无权读取。",
        "This content does not exist or is not accessible from this space.",
      );
    if (error.status === 501)
      return t("此功能尚未接入。", "This capability is not connected yet.");
    if (error.status === 503)
      return t(
        "服务暂时不可用，请稍后重试。",
        "The service is temporarily unavailable. Try again later.",
      );
    if (error.code === "INVALID_RESPONSE")
      return t(
        "服务响应无法识别，请重新加载。",
        "The service response could not be validated. Reload the page.",
      );
    if (error.code === "NETWORK_ERROR")
      return t(
        "暂时无法连接服务，请检查连接后重试。",
        "Could not connect to the service. Check your connection and try again.",
      );
    return t(
      "操作没有完成，请稍后重试。",
      "The action did not complete. Please try again later.",
    );
  };
}
export function ErrorNotice({ error }: { error: unknown }) {
  const text = useErrorText();
  const { t } = useLocale();
  return (
    <div className="notice error-notice" role="alert">
      <p>{text(error)}</p>
      {error instanceof RequestError && error.requestId ? (
        <small>
          {t("请求编号", "Request ID")}: {error.requestId}
        </small>
      ) : null}
    </div>
  );
}
export function Loading() {
  const { t } = useLocale();
  return (
    <p className="loading" role="status">
      {t("正在加载…", "Loading…")}
    </p>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="empty">
      <h2>{title}</h2>
      <div>{children}</div>
    </section>
  );
}

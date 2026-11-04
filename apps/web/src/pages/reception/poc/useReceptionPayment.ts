import { createPaymentCheckout } from "./payment-checkout";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Id, type RequirementsDocumentState } from "@ally-ahead/contracts";
import type { ReceptionSessionView } from "../../../api/reception";
import {
  receptionPayments,
  type PaymentView,
  type PaymentTerms,
} from "../../../api/receptionPayments";
import { isAborted, RequestError } from "../../../api/client";
import { navigate, useRoute } from "../../../app/router";
import { useLocale } from "../../../locales/context";

function paymentIdFromUrl(): string | null {
  const value = new URLSearchParams(window.location.search).get("paymentId");
  return Id.safeParse(value).success ? value : null;
}
function retainPaymentId(id: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("paymentId", Id.parse(id));
  navigate(url.pathname + url.search + url.hash, true);
}
const hasApprovedDocument = (current: RequirementsDocumentState["current"]) =>
  Boolean(current?.confirmedByMessageId && !current.hasPendingRevision);
const isPaid = (view: PaymentView) =>
  view.state === "paid" &&
  view.captureStatus === "COMPLETED" &&
  view.outcome === "known" &&
  view.simulationState === "published_awaiting_connection";
const isRefunded = (view: PaymentView) =>
  view.state === "refunded" &&
  view.refundStatus === "COMPLETED" &&
  view.outcome === "known" &&
  view.simulationState === "withdrawn_refunded";

export interface ReceptionPaymentProps {
  session: ReceptionSessionView | null;
  current: RequirementsDocumentState["current"];
  active: boolean;
  disabled: boolean;
  startRequest: { messageId: string; requestId: string } | null;
}

export function useReceptionPayment({
  session,
  current,
  active,
  disabled,
  startRequest,
}: ReceptionPaymentProps) {
  const { t, locale } = useLocale();
  const route = useRoute();
  const urlId = new URLSearchParams(route.split("?")[1] ?? "").get("paymentId");
  const paymentId = Id.safeParse(urlId).success ? urlId : null;
  const [view, setView] = useState<PaymentView | null>(null);
  const [terms, setTerms] = useState<PaymentTerms | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsRead, setNeedsRead] = useState(false);
  const [consent, setConsent] = useState<{
    paymentId: string;
    documentMessageId: string;
    termsVersion: string;
  } | null>(null);
  const [refundConfirmation, setRefundConfirmation] = useState(false);
  const checkoutPermission = useRef(false);
  const reconciliationRequired = useRef(false);
  function stopCheckout() {
    checkoutPermission.current = false;
    setConsent(null);
  }
  const latest = useRef({ session, current, active, disabled, view });
  useLayoutEffect(() => {
    latest.current = { session, current, active, disabled, view };
  });
  const controllers = useRef(new Set<AbortController>());
  const alive = useRef(true);
  const keys = useRef(new Map<string, string>());
  function key(action: string) {
    let value = keys.current.get(action);
    if (!value) {
      value = crypto.randomUUID();
      keys.current.set(action, value);
    }
    return value;
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const c of controllers.current) c.abort();
      controllers.current.clear();
    };
  }, []);
  useEffect(() => {
    stopCheckout();
    setRefundConfirmation(false);
  }, [
    session?.sessionId,
    current?.messageId,
    current?.confirmedByMessageId,
    current?.hasPendingRevision,
  ]);

  function accept(next: PaymentView) {
    if (!alive.current || paymentIdFromUrl() !== next.paymentId) return;
    if (
      latest.current.view?.paymentId === next.paymentId &&
      latest.current.view.revision > next.revision
    )
      return;
    latest.current.view = next;
    setView((previous) =>
      previous?.paymentId === next.paymentId &&
      previous.revision > next.revision
        ? previous
        : next,
    );
    setTerms(next.terms);
    setNeedsRead(false);
    reconciliationRequired.current = false;
  }
  async function request<T>(
    run: (signal: AbortSignal) => Promise<T>,
    mutating = false,
  ): Promise<T> {
    if (!alive.current) throw new DOMException("Aborted", "AbortError");
    const controller = new AbortController();
    controllers.current.add(controller);
    if (alive.current) {
      setBusy(true);
      setNotice(null);
    }
    try {
      const result = await run(controller.signal);
      controller.signal.throwIfAborted();
      return result;
    } catch (error) {
      if (!controller.signal.aborted && !isAborted(error) && alive.current) {
        stopCheckout();
        if (
          error instanceof RequestError &&
          [401, 403, 404].includes(error.status)
        )
          setView(null);
        if (mutating || paymentIdFromUrl()) {
          setNeedsRead(true);
          reconciliationRequired.current = true;
        }
        setNotice(
          t(
            "暂未核对请求结果。请查询服务端状态后再决定下一步；不会自动重复付款或退款。",
            "The result has not been verified. Check server status before continuing. Payments and refunds are never repeated automatically.",
          ),
        );
      }
      throw error;
    } finally {
      controllers.current.delete(controller);
      if (alive.current) setBusy(controllers.current.size > 0);
    }
  }
  useEffect(() => {
    setView(null);
    setTerms(null);
    stopCheckout();
    setNeedsRead(false);
    if (!session || disabled) return;
    const controller = new AbortController();
    controllers.current.add(controller);
    setBusy(true);
    const initialId = paymentIdFromUrl();
    const read = paymentId
      ? receptionPayments.read(paymentId, controller.signal)
      : receptionPayments
          .current(controller.signal)
          .then((result) => result.payment);
    void read
      .then((next) => {
        if (
          controller.signal.aborted ||
          paymentIdFromUrl() !== initialId ||
          !next
        )
          return;
        if (!initialId) retainPaymentId(next.paymentId);
        accept(next);
      })
      .catch((error) => {
        if (!controller.signal.aborted && !isAborted(error))
          setNotice(
            t(
              "暂时无法读取这笔测试付款。请重新核对当前接待会话的付款状态。",
              "This test payment could not be read. Check its status in the current reception session.",
            ),
          );
      })
      .finally(() => {
        controllers.current.delete(controller);
        if (!controller.signal.aborted && alive.current)
          setBusy(controllers.current.size > 0);
      });
    return () => {
      controller.abort();
      controllers.current.delete(controller);
    };
  }, [session?.sessionId, paymentId, disabled]);

  async function check() {
    const id = paymentIdFromUrl();
    if (!session || disabled || busy) return;
    try {
      const next = await request((signal) =>
        id
          ? receptionPayments.read(id, signal)
          : receptionPayments.current(signal).then((result) => result.payment),
      );
      if (next) {
        if (!id) retainPaymentId(next.paymentId);
        accept(next);
      }
    } catch {
      /* safe notice above */
    }
  }
  async function begin(messageId: string) {
    setOpen(true);
    setRefundConfirmation(false);
    stopCheckout();
    const scope = latest.current;
    if (
      !scope.session ||
      scope.disabled ||
      scope.active ||
      scope.current?.messageId !== messageId ||
      !hasApprovedDocument(scope.current)
    ) {
      setNotice(
        t(
          "请先确认当前需求文档，再单独选择继续模拟发布。",
          "Confirm the current document before choosing simulated publication separately.",
        ),
      );
      return;
    }
    try {
      const oldId = paymentIdFromUrl();
      if (oldId) {
        const old = await request((signal) =>
          receptionPayments.read(oldId, signal),
        );
        accept(old);
        if (old.orderId || old.documentMessageId === messageId) return;
      }
      const terms = await request((signal) => receptionPayments.terms(signal));
      setTerms(terms);
      if (!terms.configured || !terms.clientId) {
        setNotice(
          t(
            "PayPal Sandbox 测试付款暂不可用；仍可下载文档或继续交流。",
            "PayPal Sandbox checkout is unavailable. You can still download the document or keep discussing.",
          ),
        );
        return;
      }
      const now = latest.current;
      if (
        now.current?.messageId !== messageId ||
        !hasApprovedDocument(now.current) ||
        now.active ||
        now.disabled ||
        now.session?.sessionId !== scope.session.sessionId
      )
        throw new RequestError(409, "CONFLICT");
      const next = await request(
        (signal) =>
          receptionPayments.prepare(
            scope.session!.csrfToken,
            {
              documentMessageId: messageId,
              confirmedMarkdown: scope.current!.document.markdown,
              confirmedDocument: true,
              consentToSimulatedPublication: true,
              termsVersion: terms.termsVersion,
              requestKey: key(`prepare:${messageId}:${terms.termsVersion}`),
            },
            signal,
          ),
        true,
      );
      if (
        next.documentMessageId !== messageId ||
        next.terms.termsVersion !== terms.termsVersion
      )
        throw new RequestError(409, "CONFLICT");
      retainPaymentId(next.paymentId);
      accept(next);
    } catch (error) {
      if (
        alive.current &&
        error instanceof RequestError &&
        error.status === 409
      )
        setNotice(
          t(
            "文档、付款记录或条款已变化，请先核对当前状态再继续。",
            "The document, payment record or terms changed. Verify the current state before continuing.",
          ),
        );
    }
  }
  useEffect(() => {
    if (startRequest) void begin(startRequest.messageId);
  }, [startRequest?.requestId]);

  function checkoutScope(payment: PaymentView) {
    const now = latest.current;
    if (
      !checkoutPermission.current ||
      reconciliationRequired.current ||
      !now.session ||
      now.disabled ||
      now.active ||
      now.current?.messageId !== payment.documentMessageId ||
      !hasApprovedDocument(now.current) ||
      paymentIdFromUrl() !== payment.paymentId ||
      now.view?.paymentId !== payment.paymentId ||
      now.view.outcome !== "known" ||
      ![
        "awaiting_payment_consent",
        "awaiting_buyer",
        "creating",
        "capturing",
      ].includes(now.view.state)
    )
      throw new RequestError(409, "CONFLICT");
    return now.session.csrfToken;
  }
  const matches = Boolean(
    view &&
      current?.messageId === view.documentMessageId &&
      hasApprovedDocument(current),
  );
  const safeToPay = Boolean(
    view &&
      terms?.configured &&
      terms.clientId &&
      view.outcome === "known" &&
      ["awaiting_payment_consent", "awaiting_buyer"].includes(view.state) &&
      matches &&
      !active &&
      !disabled &&
      !needsRead,
  );
  const checkoutEnabled = Boolean(
    consent &&
      view &&
      consent.paymentId === view.paymentId &&
      consent.documentMessageId === view.documentMessageId &&
      consent.termsVersion === view.terms.termsVersion &&
      matches &&
      !active &&
      !disabled &&
      !needsRead &&
      view.outcome === "known" &&
      [
        "awaiting_payment_consent",
        "awaiting_buyer",
        "creating",
        "capturing",
      ].includes(view.state),
  );
  const paid = Boolean(view && isPaid(view) && !needsRead);
  const refunded = Boolean(view && isRefunded(view) && !needsRead);

  const recoveryAvailable = Boolean(
    view?.refundRecoveryAvailable && !needsRead,
  );

  const { createOrder, approve, cancelCheckout, checkoutError } =
    createPaymentCheckout({
      view,
      currentView: () => latest.current.view,
      checkoutScope,
      request,
      key,
      accept,
      stopCheckout,
      requireReconciliation: () => {
        reconciliationRequired.current = true;
        setNeedsRead(true);
      },
      notice: (zh, en) => setNotice(t(zh, en)),
    });
  function consentToCheckout() {
    if (!view || !safeToPay || busy) return;
    setNotice(null);
    checkoutPermission.current = true;
    setConsent({
      paymentId: view.paymentId,
      documentMessageId: view.documentMessageId,
      termsVersion: view.terms.termsVersion,
    });
  }
  function confirmRefund() {
    if (!view) return;
    setRefundConfirmation(false);
    if (!session) return;
    void request((signal) => {
      const now = latest.current;
      if (
        !now.session ||
        now.disabled ||
        reconciliationRequired.current ||
        paymentIdFromUrl() !== view.paymentId ||
        now.view?.paymentId !== view.paymentId ||
        !(isPaid(now.view) || now.view.refundRecoveryAvailable)
      )
        throw new RequestError(409, "CONFLICT");
      return receptionPayments.refund(
        now.session.csrfToken,
        view.paymentId,
        {
          confirmedFullRefund: true,
          requestKey: key(`refund:${view.paymentId}`),
        },
        signal,
      );
    }, true)
      .then(accept)
      .catch(() => {});
  }
  return {
    t,
    locale,
    view,
    terms,
    open,
    busy,
    notice,
    needsRead,
    consent,
    refundConfirmation,
    paymentId,
    matches,
    safeToPay,
    checkoutEnabled,
    paid,
    refunded,
    recoveryAvailable,
    setOpen,
    stopCheckout,
    setRefundConfirmation,
    check,
    consentToCheckout,
    createOrder,
    approve,
    cancelCheckout,
    checkoutError,
    confirmRefund,
  };
}

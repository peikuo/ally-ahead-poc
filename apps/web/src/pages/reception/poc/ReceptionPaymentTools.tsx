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
import { Modal } from "../../../components/Modal";
import { PayPalSandboxButton } from "../../../components/paypal/PayPalSandboxButton";
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

export function ReceptionPaymentTools({
  session,
  current,
  active,
  disabled,
  startRequest,
}: {
  session: ReceptionSessionView | null;
  current: RequirementsDocumentState["current"];
  active: boolean;
  disabled: boolean;
  startRequest: { messageId: string; requestId: string } | null;
}) {
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
    if (!session || !paymentId || disabled) return;
    const controller = new AbortController();
    controllers.current.add(controller);
    setBusy(true);
    void receptionPayments
      .read(paymentId, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) accept(next);
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
    if (!id || !session || disabled || busy) return;
    try {
      accept(await request((signal) => receptionPayments.read(id, signal)));
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
  const labels: Record<PaymentView["state"], string> = {
    awaiting_payment_consent: t(
      "待你明确同意测试付款",
      "Awaiting your test payment consent",
    ),
    creating: t(
      "服务端正在创建测试订单",
      "Creating the test order on the server",
    ),
    awaiting_buyer: t(
      "等待 PayPal 测试买家操作",
      "Awaiting the PayPal test buyer",
    ),
    capturing: t(
      "服务端正在核对测试收款",
      "Verifying the test capture on the server",
    ),
    paid: paid
      ? t("测试付款成功（Sandbox）", "Test payment successful (Sandbox)")
      : t("付款状态需要核对", "Payment status needs verification"),
    refunding: t("正在申请测试全额退款", "Requesting the test full refund"),
    refund_pending: t(
      "测试退款处理中，尚未确认完成",
      "Test refund pending; completion is not confirmed",
    ),
    refunded: refunded
      ? t("测试全额退款成功", "Test full refund successful")
      : t("退款状态需要核对", "Refund status needs verification"),
    unknown: t(
      "付款或退款结果未知，请核对状态",
      "Payment or refund outcome unknown; check status",
    ),
    failed: t(
      "本次测试请求失败，请先核对状态",
      "The test request failed; verify status first",
    ),
  };
  return (
    <>
      {paymentId || urlId || startRequest ? (
        <button
          type="button"
          className="text-link"
          data-testid="reception-payment-tools"
          disabled={!session || disabled}
          onClick={() => setOpen(true)}
        >
          {t("测试付款状态", "Test payment status")}
        </button>
      ) : null}
      {open ? (
        <Modal
          title={t(
            "测试付款与模拟发布",
            "Test payment and simulated publication",
          )}
          onClose={() => {
            setOpen(false);
            stopCheckout();
            setRefundConfirmation(false);
          }}
        >
          <div
            className="reception-poc-payment"
            data-testid="reception-payment-panel"
          >
            <p className="reception-poc-disclosure">
              <strong>
                {t(
                  "PayPal Sandbox · 无真实收费",
                  "PayPal Sandbox · No real charge",
                )}
              </strong>
              <br />
              {t(
                "无需平台注册登录；PayPal 测试买家窗口可能需要登录。需求发布仅为模拟，不代表已签约或开工。",
                "No platform login is required. The PayPal test buyer window may require login. Publication is simulated and does not mean a contract or work has started.",
              )}
            </p>
            {terms ? (
              <dl className="reception-poc-payment-terms">
                <div>
                  <dt>{t("测试定金", "Test deposit")}</dt>
                  <dd>
                    <strong>USD {terms.amount}</strong>
                  </dd>
                </div>
                <div>
                  <dt>{t("用途", "Purpose")}</dt>
                  <dd>
                    {t(
                      "表达继续对接的意向，不购买技术方案。",
                      "Express intent to continue matching; this does not purchase a technical solution.",
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{t("退款规则", "Refund rule")}</dt>
                  <dd>
                    {t(
                      "签约前可主动申请全额退款。本 POC 只演示未签约阶段，不会自动退款。",
                      "Request a full refund before contracting. This POC demonstrates the pre-contract stage; refunds are never automatic.",
                    )}
                  </dd>
                </div>
              </dl>
            ) : null}
            {busy ? (
              <p role="status">
                {t(
                  "正在核对服务端结果，请勿重复提交。",
                  "Checking the server result. Do not submit again.",
                )}
              </p>
            ) : null}
            {notice ? (
              <p role="status" className="notice">
                {notice}
              </p>
            ) : null}
            {view ? (
              <>
                <p
                  role="status"
                  data-testid="reception-payment-state"
                  data-state={view.state}
                >
                  <strong>{labels[view.state]}</strong>
                </p>
                {!matches ? (
                  <p className="form-hint">
                    {t(
                      "这笔记录关联此前确认的文档。后续改稿不会覆盖付款；仍可核对状态或按规则申请退款。",
                      "This record belongs to an earlier confirmed document. Later revisions do not overwrite the payment; status checks and eligible refunds remain available.",
                    )}
                  </p>
                ) : null}
                {paid ? (
                  <p data-testid="poc-simulated-publication">
                    {t(
                      "需求模拟发布 · 待对接演示。仅为 Sandbox 付款回执，不代表已签约或开工。",
                      "Request simulated as published · Pending matching demo. This is a Sandbox receipt and does not mean a contract or work has started.",
                    )}
                  </p>
                ) : null}
                {refunded ? (
                  <p>
                    {t(
                      "测试资金已全额退回，模拟发布已撤回。",
                      "Test funds were fully refunded and simulated publication was withdrawn.",
                    )}
                  </p>
                ) : null}
                {view.captureId ? (
                  <p className="form-hint">
                    {t("Sandbox 回执：", "Sandbox receipt: ")}
                    {view.captureId}
                  </p>
                ) : null}
                {!consent && safeToPay ? (
                  <button
                    type="button"
                    className="primary"
                    data-testid="consent-sandbox-payment"
                    disabled={busy}
                    onClick={() => {
                      setNotice(null);
                      checkoutPermission.current = true;
                      setConsent({
                        paymentId: view.paymentId,
                        documentMessageId: view.documentMessageId,
                        termsVersion: view.terms.termsVersion,
                      });
                    }}
                  >
                    {t(
                      "同意条款并打开 PayPal 测试付款",
                      "Agree to terms and open PayPal test checkout",
                    )}
                  </button>
                ) : null}
                {checkoutEnabled ? (
                  <PayPalSandboxButton
                    clientId={terms?.clientId ?? undefined}
                    currency={view.terms.currency}
                    enabled
                    language={locale}
                    createOrder={async () => {
                      const token = checkoutScope(view);
                      const next = await request(
                        (signal) =>
                          receptionPayments.create(
                            token,
                            view.paymentId,
                            {
                              termsVersion: view.terms.termsVersion,
                              expectedRevision: view.revision,
                              confirmedSandboxPayment: true,
                              requestKey: key(`create:${view.paymentId}`),
                            },
                            signal,
                          ),
                        true,
                      );
                      const bound =
                        next.paymentId === view.paymentId &&
                        next.documentMessageId === view.documentMessageId &&
                        next.documentHash === view.documentHash &&
                        next.terms.termsVersion === view.terms.termsVersion &&
                        next.terms.clientId === view.terms.clientId &&
                        next.terms.configured &&
                        next.revision >= view.revision &&
                        (!view.orderId || next.orderId === view.orderId);
                      // Preserve an authoritative uncertain/failed result, but
                      // never hand its ID to the SDK as an approvable order.
                      if (bound) accept(next);
                      try {
                        if (
                          !bound ||
                          !next.orderId ||
                          next.outcome !== "known" ||
                          next.state !== "awaiting_buyer" ||
                          ![
                            "CREATED",
                            "PAYER_ACTION_REQUIRED",
                            "APPROVED",
                          ].includes(next.orderStatus ?? "") ||
                          next.captureId ||
                          next.captureStatus ||
                          next.refundId ||
                          next.refundStatus ||
                          next.simulationState !== "not_published"
                        )
                          throw new RequestError(409, "CONFLICT");
                        checkoutScope(next);
                        if (latest.current.view?.orderId !== next.orderId)
                          throw new RequestError(409, "CONFLICT");
                      } catch (error) {
                        stopCheckout();
                        reconciliationRequired.current = true;
                        setNeedsRead(true);
                        setNotice(
                          t(
                            "订单尚不能继续买家批准，请先核对付款状态。",
                            "This order is not ready for buyer approval. Check payment status first.",
                          ),
                        );
                        throw error;
                      }
                      return next.orderId;
                    }}
                    onApprove={async (orderId) => {
                      const token = checkoutScope(view);
                      if (latest.current.view?.orderId !== orderId)
                        throw new RequestError(409, "CONFLICT");
                      accept(
                        await request(
                          (signal) =>
                            receptionPayments.capture(
                              token,
                              view.paymentId,
                              {
                                orderId,
                                requestKey: key(`capture:${view.paymentId}`),
                              },
                              signal,
                            ),
                          true,
                        ),
                      );
                      stopCheckout();
                    }}
                    onCancel={() => {
                      stopCheckout();
                      setNotice(
                        t(
                          "已关闭 PayPal 测试窗口。付款状态以服务端核对结果为准，不会自动退款。",
                          "The PayPal test window was closed. Verify server status; no refund is automatic.",
                        ),
                      );
                    }}
                    onError={() => {
                      stopCheckout();
                      setNeedsRead(true);
                      reconciliationRequired.current = true;
                      setNotice(
                        t(
                          "测试付款窗口未完成，请先核对付款状态。",
                          "Checkout did not finish. Check payment status first.",
                        ),
                      );
                    }}
                  />
                ) : null}
                {paid && !refundConfirmation ? (
                  <button
                    type="button"
                    className="secondary"
                    data-testid="request-sandbox-refund"
                    disabled={busy || disabled || needsRead}
                    onClick={() => setRefundConfirmation(true)}
                  >
                    {t("申请测试全额退款", "Request a test full refund")}
                  </button>
                ) : null}
                {refundConfirmation && paid ? (
                  <section
                    className="reception-poc-refund"
                    aria-label={t("确认测试退款", "Confirm test refund")}
                  >
                    <p>
                      {t(
                        "确认主动申请退回 USD 500.00 测试资金？完成后会撤回本次模拟发布。",
                        "Request a full USD 500.00 test refund? Simulated publication will be withdrawn once the refund completes.",
                      )}
                    </p>
                    <button
                      type="button"
                      className="primary"
                      disabled={busy || disabled}
                      onClick={() => {
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
                            !isPaid(now.view)
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
                      }}
                    >
                      {t("确定申请测试全额退款", "Confirm test full refund")}
                    </button>
                    <button
                      type="button"
                      className="text-link"
                      disabled={busy}
                      onClick={() => setRefundConfirmation(false)}
                    >
                      {t("暂不退款", "Keep the payment")}
                    </button>
                  </section>
                ) : null}
              </>
            ) : null}
            {paymentId ? (
              <button
                type="button"
                className="text-link"
                disabled={busy || disabled || !session}
                onClick={() => void check()}
              >
                {t("核对付款 / 退款状态", "Check payment / refund status")}
              </button>
            ) : null}
            {!paymentId && !busy && !view ? (
              <p>
                {t(
                  "当前没有可核对的付款回执。可返回已确认文档，重新选择继续模拟发布。",
                  "No payment receipt is available to check. Return to the confirmed document and explicitly choose simulated publication again.",
                )}
              </p>
            ) : null}
            <button
              type="button"
              className="text-link"
              onClick={() => {
                setOpen(false);
                stopCheckout();
              }}
            >
              {t(
                "返回接待，继续交流",
                "Return to reception and keep discussing",
              )}
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

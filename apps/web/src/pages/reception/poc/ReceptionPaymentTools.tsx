import type { PaymentView } from "../../../api/receptionPayments";
import { Modal } from "../../../components/Modal";
import { PayPalSandboxButton } from "../../../components/paypal/PayPalSandboxButton";
import {
  useReceptionPayment,
  type ReceptionPaymentProps,
} from "./useReceptionPayment";

export function ReceptionPaymentTools(props: ReceptionPaymentProps) {
  const { session, disabled } = props;
  const {
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
  } = useReceptionPayment(props);
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
      {session ? (
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
                    onClick={consentToCheckout}
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
                    createOrder={createOrder}
                    onApprove={approve}
                    onCancel={cancelCheckout}
                    onError={checkoutError}
                  />
                ) : null}
                {(paid || recoveryAvailable) && !refundConfirmation ? (
                  <button
                    type="button"
                    className="secondary"
                    data-testid={
                      recoveryAvailable
                        ? "recover-sandbox-refund"
                        : "request-sandbox-refund"
                    }
                    disabled={busy || disabled || needsRead}
                    onClick={() => setRefundConfirmation(true)}
                  >
                    {recoveryAvailable
                      ? t("恢复此前测试退款", "Recover previous test refund")
                      : t("申请测试全额退款", "Request a test full refund")}
                  </button>
                ) : null}
                {refundConfirmation && (paid || recoveryAvailable) ? (
                  <section
                    className="reception-poc-refund"
                    aria-label={t("确认测试退款", "Confirm test refund")}
                  >
                    <p>
                      {recoveryAvailable
                        ? t(
                            "继续恢复此前已申请的测试退款？系统会沿用原退款请求，不会新建另一笔退款。",
                            "Recover the previously requested test refund? The original refund request will be reused.",
                          )
                        : t(
                            "确认主动申请退回 USD 500.00 测试资金？完成后会撤回本次模拟发布。",
                            "Request a full USD 500.00 test refund? Simulated publication will be withdrawn once the refund completes.",
                          )}
                    </p>
                    <button
                      type="button"
                      className="primary"
                      disabled={busy || disabled}
                      onClick={confirmRefund}
                    >
                      {recoveryAvailable
                        ? t(
                            "确认恢复此前测试退款",
                            "Confirm previous refund recovery",
                          )
                        : t("确定申请测试全额退款", "Confirm test full refund")}
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
            {session ? (
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

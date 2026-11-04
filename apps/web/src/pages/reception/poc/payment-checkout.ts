import type { PaymentView } from "../../../api/receptionPayments";
import { receptionPayments } from "../../../api/receptionPayments";
import { RequestError } from "../../../api/client";

interface CheckoutContext {
  view: PaymentView | null;
  currentView: () => PaymentView | null;
  checkoutScope: (payment: PaymentView) => string;
  request: <T>(
    run: (signal: AbortSignal) => Promise<T>,
    mutating?: boolean,
  ) => Promise<T>;
  key: (action: string) => string;
  accept: (payment: PaymentView) => void;
  stopCheckout: () => void;
  requireReconciliation: () => void;
  notice: (zh: string, en: string) => void;
}

// SDK callbacks depend on the server payment API and explicit checkout scope.
// Session/React state ownership remains in useReceptionPayment.
export function createPaymentCheckout({
  view,
  currentView,
  checkoutScope,
  request,
  key,
  accept,
  stopCheckout,
  requireReconciliation,
  notice,
}: CheckoutContext) {
  const createOrder = async () => {
    if (!view) throw new RequestError(409, "CONFLICT");
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
        !["CREATED", "PAYER_ACTION_REQUIRED", "APPROVED"].includes(
          next.orderStatus ?? "",
        ) ||
        next.captureId ||
        next.captureStatus ||
        next.refundId ||
        next.refundStatus ||
        next.simulationState !== "not_published"
      )
        throw new RequestError(409, "CONFLICT");
      checkoutScope(next);
      if (currentView()?.orderId !== next.orderId)
        throw new RequestError(409, "CONFLICT");
    } catch (error) {
      stopCheckout();
      requireReconciliation();
      notice(
        "订单尚不能继续买家批准，请先核对付款状态。",
        "This order is not ready for buyer approval. Check payment status first.",
      );
      throw error;
    }
    return next.orderId;
  };
  const approve = async (orderId: string) => {
    if (!view) throw new RequestError(409, "CONFLICT");
    const token = checkoutScope(view);
    if (currentView()?.orderId !== orderId)
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
  };
  const cancelCheckout = () => {
    stopCheckout();
    notice(
      "已关闭 PayPal 测试窗口。付款状态以服务端核对结果为准，不会自动退款。",
      "The PayPal test window was closed. Verify server status; no refund is automatic.",
    );
  };
  const checkoutError = () => {
    stopCheckout();
    requireReconciliation();
    notice(
      "测试付款窗口未完成，请先核对付款状态。",
      "Checkout did not finish. Check payment status first.",
    );
  };

  return { createOrder, approve, cancelCheckout, checkoutError };
}

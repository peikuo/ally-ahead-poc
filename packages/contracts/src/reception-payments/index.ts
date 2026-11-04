import { z } from "zod";
const id = z.uuid();
const providerId = z.string().regex(/^[A-Z0-9]{1,64}$/),
  providerStatus = z.string().regex(/^[A-Z_]{1,64}$/);
export const RECEPTION_PAYMENT_TERMS_VERSION =
  "sandbox-usd500-before-contract-v1" as const;
export const ReceptionPaymentTerms = z.strictObject({
  environment: z.literal("sandbox"),
  configured: z.boolean(),
  clientId: z.string().nullable(),
  amount: z.literal("500.00"),
  currency: z.literal("USD"),
  termsVersion: z.literal(RECEPTION_PAYMENT_TERMS_VERSION),
  purpose: z.literal("refundable_connection_intent"),
  refundRule: z.literal("before_contract_full"),
  noRealFees: z.literal(true),
});
export const PrepareReceptionPayment = z.strictObject({
  documentMessageId: id,
  confirmedMarkdown: z.string().trim().min(1).max(40000),
  confirmedDocument: z.literal(true),
  consentToSimulatedPublication: z.literal(true),
  termsVersion: z.literal(RECEPTION_PAYMENT_TERMS_VERSION),
  requestKey: id,
});
export const CreateReceptionPaymentOrder = z.strictObject({
  termsVersion: z.literal(RECEPTION_PAYMENT_TERMS_VERSION),
  expectedRevision: z.number().int().nonnegative(),
  confirmedSandboxPayment: z.literal(true),
  requestKey: id,
});
export const CaptureReceptionPayment = z.strictObject({
  orderId: z.string().regex(/^[A-Z0-9]{1,64}$/),
  requestKey: id,
});
export const RefundReceptionPayment = z.strictObject({
  confirmedFullRefund: z.literal(true),
  requestKey: id,
});
export const ReceptionPaymentState = z.enum([
  "awaiting_payment_consent",
  "creating",
  "awaiting_buyer",
  "capturing",
  "paid",
  "refunding",
  "refund_pending",
  "refunded",
  "unknown",
  "failed",
]);
export const ReceptionPaymentView = z.strictObject({
  paymentId: id,
  documentMessageId: id,
  documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  terms: ReceptionPaymentTerms,
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  state: ReceptionPaymentState,
  orderId: providerId.nullable(),
  orderStatus: providerStatus.nullable(),
  captureId: providerId.nullable(),
  captureStatus: providerStatus.nullable(),
  refundId: providerId.nullable(),
  refundStatus: providerStatus.nullable(),
  simulationState: z.enum([
    "not_published",
    "published_awaiting_connection",
    "withdrawn_refunded",
  ]),
  outcome: z.enum(["known", "unknown", "failed"]),
  retryable: z.boolean(),
  refundRecoveryAvailable: z.boolean(),
});

export const ReceptionCurrentPayment = z.strictObject({
  payment: ReceptionPaymentView.nullable(),
});

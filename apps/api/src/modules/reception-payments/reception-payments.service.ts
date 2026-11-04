import { createHash, randomUUID } from "node:crypto";
import { RECEPTION_PAYMENT_TERMS_VERSION } from "@ally-ahead/contracts";
import { AppError } from "../../infrastructure/errors.js";
import {
  exactCapture,
  SandboxPaymentError,
  type SandboxPaymentPort,
} from "./paypal-sandbox.client.js";
import type { ReceptionPaymentConfig } from "./reception-payments.config.js";
import type {
  PaymentAction,
  ReceptionPaymentAccess,
  ReceptionPaymentDocumentReader,
  ReceptionPaymentRecord,
  ReceptionPaymentStore,
} from "./reception-payments.ports.js";
export const PAYMENT_TERMS_VERSION = RECEPTION_PAYMENT_TERMS_VERSION;
const IDEMPOTENCY_WINDOW_MS = 6 * 3600000;
// A mutation can make several sequential provider calls, each bounded to 25 seconds.
const ACTION_LEASE_MS = 180000;
interface PrepareInput {
  documentMessageId: string;
  confirmedMarkdown: string;
  confirmedDocument: true;
  consentToSimulatedPublication: true;
  termsVersion: string;
  requestKey: string;
}
interface CreateInput {
  termsVersion: string;
  expectedRevision: number;
  confirmedSandboxPayment: true;
  requestKey: string;
}
export class ReceptionPaymentsService<Tx> {
  constructor(
    readonly store: ReceptionPaymentStore<Tx>,
    readonly documents: ReceptionPaymentDocumentReader<Tx>,
    readonly config: ReceptionPaymentConfig | undefined,
    readonly paypal: SandboxPaymentPort | undefined,
    readonly clock: () => number = Date.now,
  ) {}
  terms() {
    return {
      environment: "sandbox" as const,
      configured: !!this.config && !!this.paypal,
      clientId: this.config?.clientId ?? null,
      amount: "500.00" as const,
      currency: "USD" as const,
      termsVersion: PAYMENT_TERMS_VERSION,
      purpose: "refundable_connection_intent" as const,
      refundRule: "before_contract_full" as const,
      noRealFees: true as const,
    };
  }
  private ready() {
    if (!this.config || !this.paypal) throw new AppError("NOT_READY", 503);
    return this.paypal;
  }
  private async get(tx: Tx, sid: string, id: string) {
    const record = await this.store.get(tx, sid, id, true);
    if (!record) throw new AppError("NOT_FOUND", 404);
    return record;
  }
  private view(r: ReceptionPaymentRecord) {
    return {
      paymentId: r.id,
      documentMessageId: r.documentMessageId,
      documentHash: r.documentHash,
      terms: this.terms(),
      revision: r.revision,
      state: r.state,
      orderId: r.orderId,
      orderStatus: r.orderStatus,
      captureId: r.captureId,
      captureStatus: r.captureStatus,
      refundId: r.refundId,
      refundStatus: r.refundStatus,
      simulationState:
        r.refundStatus === "COMPLETED"
          ? ("withdrawn_refunded" as const)
          : r.captureStatus === "COMPLETED" || r.captureStatus === "REFUNDED"
            ? ("published_awaiting_connection" as const)
            : ("not_published" as const),
      outcome: r.outcome,
      refundRecoveryAvailable: this.canRecoverRefund(r),
      retryable: r.outcome !== "known" && !r.pending,
    };
  }
  private canRecoverRefund(r: ReceptionPaymentRecord) {
    const attempted = r.attemptedAt.refund;
    return (
      attempted !== undefined &&
      this.clock() - attempted < IDEMPOTENCY_WINDOW_MS &&
      !!r.captureId &&
      !r.refundId &&
      !r.pending &&
      (r.state === "unknown" || r.state === "failed")
    );
  }
  async current(access: ReceptionPaymentAccess<Tx>) {
    const record = await access((tx, sid) => this.store.active(tx, sid));
    return { payment: record ? await this.read(access, record.id) : null };
  }
  private update(r: ReceptionPaymentRecord) {
    const prior = r.revision;
    r.revision++;
    r.updatedAt = new Date(this.clock()).toISOString();
    return prior;
  }
  async prepare(access: ReceptionPaymentAccess<Tx>, input: PrepareInput) {
    if (
      !input.confirmedDocument ||
      !input.consentToSimulatedPublication ||
      input.termsVersion !== PAYMENT_TERMS_VERSION
    )
      throw new AppError("CONFLICT", 409);
    const markdown = input.confirmedMarkdown.trim();
    if (!markdown || markdown.length > 40000)
      throw new AppError("VALIDATION_FAILED", 422);
    const hash = createHash("sha256").update(markdown).digest("hex");
    return access(async (tx, sid) => {
      await this.store.lockSession(tx, sid);
      const source = await this.documents.readConfirmableDocument(
        tx,
        sid,
        input.documentMessageId,
      );
      if (
        source.messageId !== input.documentMessageId ||
        source.kind !== "requirements_document" ||
        source.complete !== true ||
        !source.confirmedByMessageId ||
        source.hasPendingRevision !== false ||
        source.markdown.trim() !== markdown
      )
        throw new AppError("CONFLICT", 409);
      const previous = await this.store.byPrepareKey(tx, sid, input.requestKey);
      if (previous) {
        if (
          previous.documentHash !== hash ||
          previous.documentMessageId !== input.documentMessageId ||
          previous.termsVersion !== input.termsVersion
        )
          throw new AppError("CONFLICT", 409);
        return this.view(previous);
      }
      const active = await this.store.active(tx, sid);
      if (active) {
        if (
          active.documentHash === hash &&
          active.documentMessageId === input.documentMessageId &&
          active.termsVersion === input.termsVersion
        )
          return this.view(active);
        // New confirmed documents must not obscure an existing or uncertain payment.
        if (active.orderId || active.attemptedAt.create || active.pending)
          throw new AppError("CONFLICT", 409);
      }
      const at = new Date(this.clock()).toISOString();
      const record: ReceptionPaymentRecord = {
        id: randomUUID(),
        sessionId: sid,
        documentMessageId: input.documentMessageId,
        confirmedMarkdown: markdown,
        documentHash: hash,
        termsVersion: input.termsVersion,
        prepareRequestKey: input.requestKey,
        revision: 0,
        state: "awaiting_payment_consent",
        documentConfirmedAt: at,
        publicationConsentAt: at,
        paymentConsentAt: null,
        orderId: null,
        orderStatus: null,
        captureId: null,
        captureStatus: null,
        refundId: null,
        refundStatus: null,
        createKey: randomUUID(),
        captureKey: randomUUID(),
        refundKey: randomUUID(),
        attemptedAt: {},
        pending: null,
        outcome: "known",
        failureCode: null,
        createdAt: at,
        updatedAt: at,
      };
      await this.store.insert(tx, record);
      return this.view(record);
    });
  }
  private async reserve(
    access: ReceptionPaymentAccess<Tx>,
    id: string,
    action: PaymentAction,
    input?: CreateInput,
    orderId?: string,
  ) {
    return access(async (tx, sid) => {
      const r = await this.get(tx, sid, id);
      if (r.termsVersion !== PAYMENT_TERMS_VERSION)
        throw new AppError("CONFLICT", 409);
      if (action === "capture" && (!orderId || orderId !== r.orderId))
        throw new AppError("CONFLICT", 409);
      if (r.pending && r.pending.expiresAt > this.clock())
        throw new AppError("CONFLICT", 409);
      if (
        action === "refund" &&
        r.refundStatus === "COMPLETED" &&
        r.outcome === "known"
      )
        return { record: r, done: true };
      if (action === "create" || action === "capture") {
        const source = await this.documents.readConfirmableDocument(
          tx,
          sid,
          r.documentMessageId,
        );
        if (
          source.messageId !== r.documentMessageId ||
          source.hasPendingRevision !== false ||
          !source.confirmedByMessageId ||
          source.markdown.trim() !== r.confirmedMarkdown
        )
          throw new AppError("CONFLICT", 409);
      }
      if (action === "create") {
        if (
          !input?.confirmedSandboxPayment ||
          input.termsVersion !== r.termsVersion
        )
          throw new AppError("CONFLICT", 409);
        if (r.orderId) return { record: r, done: true };
        if (input.expectedRevision !== r.revision)
          throw new AppError("CONFLICT", 409);
        r.paymentConsentAt ??= new Date(this.clock()).toISOString();
      }
      if ((action === "capture" || action === "refund") && !r.orderId)
        throw new AppError("CONFLICT", 409);
      if (action === "refund" && !r.captureId)
        throw new AppError("CONFLICT", 409);
      if (action !== "status") {
        const first = r.attemptedAt[action];
        if (
          first !== undefined &&
          this.clock() - first >= IDEMPOTENCY_WINDOW_MS
        )
          throw new AppError("CONFLICT", 409);
        r.attemptedAt[action] ??= this.clock();
      }
      r.pending = {
        action,
        leaseId: randomUUID(),
        expiresAt: this.clock() + ACTION_LEASE_MS,
      };
      if (action !== "status")
        r.state =
          action === "create"
            ? "creating"
            : action === "capture"
              ? "capturing"
              : "refunding";
      const revision = this.update(r);
      await this.store.save(tx, r, revision);
      return { record: r, done: false };
    });
  }
  private async finish(
    access: ReceptionPaymentAccess<Tx>,
    reserved: ReceptionPaymentRecord,
    result: ReceptionPaymentRecord,
    error?: unknown,
  ) {
    return access(async (tx, sid) => {
      const latest = await this.get(tx, sid, reserved.id);
      if (latest.pending?.leaseId !== reserved.pending?.leaseId)
        throw new AppError("CONFLICT", 409);
      if (error) {
        latest.outcome =
          error instanceof SandboxPaymentError ? error.outcome : "unknown";
        latest.failureCode =
          error instanceof SandboxPaymentError
            ? error.code
            : "PAYPAL_RESPONSE_UNKNOWN";
        latest.state = latest.outcome === "unknown" ? "unknown" : "failed";
      } else {
        Object.assign(latest, {
          orderId: result.orderId,
          orderStatus: result.orderStatus,
          captureId: result.captureId,
          captureStatus: result.captureStatus,
          refundId: result.refundId,
          refundStatus: result.refundStatus,
          state: result.state,
          outcome: result.outcome,
          failureCode: null,
        });
      }
      latest.pending = null;
      const revision = this.update(latest);
      await this.store.save(tx, latest, revision);
      return this.view(latest);
    });
  }
  private async reconcile(r: ReceptionPaymentRecord) {
    const api = this.ready();
    if (!r.orderId) return;
    const order = await api.order(r.orderId);
    if (order.id !== r.orderId)
      throw new SandboxPaymentError("PAYPAL_ORDER_MISMATCH", "unknown");
    const captured = exactCapture(order);
    r.orderStatus = order.status;
    if (captured) {
      if (r.captureId && r.captureId !== captured.id)
        throw new SandboxPaymentError("PAYPAL_CAPTURE_MISMATCH", "unknown");
      r.captureId = captured.id;
      r.captureStatus = captured.status;
    }
    if (r.refundId) {
      const refund = await api.refundStatus(r.refundId);
      if (
        refund.id !== r.refundId ||
        refund.amount.currency_code !== "USD" ||
        refund.amount.value !== "500.00"
      )
        throw new SandboxPaymentError("PAYPAL_REFUND_MISMATCH", "unknown");
      r.refundStatus = refund.status;
    }
    r.state =
      r.refundStatus === "COMPLETED"
        ? "refunded"
        : r.refundStatus === "PENDING"
          ? "refund_pending"
          : r.refundStatus
            ? "failed"
            : r.captureStatus === "COMPLETED"
              ? "paid"
              : r.captureStatus === "REFUNDED"
                ? "unknown"
                : r.captureId
                  ? "unknown"
                  : "awaiting_buyer";
    r.outcome =
      r.state === "unknown"
        ? "unknown"
        : r.state === "failed"
          ? "failed"
          : "known";
  }
  private async execute(
    access: ReceptionPaymentAccess<Tx>,
    id: string,
    action: PaymentAction,
    input?: CreateInput,
    orderId?: string,
  ) {
    const api = this.ready();
    const reserved = await this.reserve(access, id, action, input, orderId);
    if (reserved.done) return this.view(reserved.record);
    const result = structuredClone(reserved.record);
    try {
      if (action === "create") {
        const order = await api.create(result.createKey);
        result.orderId = order.id;
        result.orderStatus = order.status;
        result.state = "awaiting_buyer";
        result.outcome = "known";
      } else {
        await this.reconcile(result);
        if (action === "capture" && !result.captureId) {
          if (result.orderStatus !== "APPROVED")
            throw new SandboxPaymentError("PAYPAL_BUYER_APPROVAL_REQUIRED");
          await api.capture(result.orderId!, result.captureKey);
          await this.reconcile(result);
          // Deliberately no refund here: refund requires a later explicit user action.
        }
        if (action === "refund" && !result.refundId) {
          const recover =
            result.captureStatus === "REFUNDED" &&
            reserved.record.attemptedAt.refund !== undefined;
          if (result.captureStatus !== "COMPLETED" && !recover)
            throw new SandboxPaymentError("PAYPAL_COMPLETED_CAPTURE_REQUIRED");
          const refund = await api.refund(result.captureId!, result.refundKey);
          if (
            refund.amount.currency_code !== "USD" ||
            refund.amount.value !== "500.00"
          )
            throw new SandboxPaymentError("PAYPAL_REFUND_MISMATCH", "unknown");
          result.refundId = refund.id;
          result.refundStatus = refund.status;
          await this.reconcile(result);
        }
      }
      return await this.finish(access, reserved.record, result);
    } catch (error) {
      return this.finish(access, reserved.record, result, error);
    }
  }
  create(access: ReceptionPaymentAccess<Tx>, id: string, input: CreateInput) {
    return this.execute(access, id, "create", input);
  }
  capture(access: ReceptionPaymentAccess<Tx>, id: string, orderId: string) {
    return this.execute(access, id, "capture", undefined, orderId);
  }
  async refund(
    access: ReceptionPaymentAccess<Tx>,
    id: string,
    confirmed: boolean,
  ) {
    if (!confirmed) throw new AppError("VALIDATION_FAILED", 422);
    return this.execute(access, id, "refund");
  }
  async read(access: ReceptionPaymentAccess<Tx>, id: string) {
    const r = await access(async (tx, sid) => {
      const saved = await this.get(tx, sid, id);
      if (saved.pending && saved.pending.expiresAt <= this.clock()) {
        // A process may have died after provider dispatch but before saving a receipt.
        // Expiry is uncertainty, never proof that creating/capturing/refunding failed.
        saved.pending = null;
        saved.state = "unknown";
        saved.outcome = "unknown";
        saved.failureCode = "PAYPAL_ACTION_INTERRUPTED";
        const revision = this.update(saved);
        await this.store.save(tx, saved, revision);
      }
      return saved;
    });
    if (!r.orderId || (r.pending && r.pending.expiresAt > this.clock()))
      return this.view(r);
    return this.execute(access, id, "status");
  }
}

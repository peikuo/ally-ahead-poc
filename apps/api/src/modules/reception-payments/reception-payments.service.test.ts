import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ReceptionPaymentsService,
  PAYMENT_TERMS_VERSION,
} from "./reception-payments.service.js";
import {
  SandboxPaymentError,
  type SandboxPaymentPort,
} from "./paypal-sandbox.client.js";
import type { Transaction } from "../../infrastructure/database.js";
import type {
  ReceptionPaymentAccess,
  ReceptionPaymentRecord,
  ReceptionPaymentStore,
} from "./reception-payments.ports.js";
function fixture() {
  const sid = randomUUID(),
    doc = randomUUID(),
    records = new Map<string, ReceptionPaymentRecord>();
  let inside = false,
    captured = false,
    refunded = false,
    approved = false,
    loseRefund = false,
    pending = false;
  const calls = { create: 0, capture: 0, refund: 0 };
  let clockOffset = 0;
  const refundKeys: string[] = [];
  const tx = {} as Transaction;
  const access: ReceptionPaymentAccess<Transaction> = async (fn) => {
    assert.equal(inside, false);
    inside = true;
    try {
      return await fn(tx, sid);
    } finally {
      inside = false;
    }
  };
  const foreign: ReceptionPaymentAccess<Transaction> = async (fn) =>
    fn(tx, randomUUID());
  const store: ReceptionPaymentStore<Transaction> = {
    async lockSession() {},
    async byPrepareKey(_tx, s, key) {
      return structuredClone(
        [...records.values()].find(
          (r) => r.sessionId === s && r.prepareRequestKey === key,
        ),
      );
    },
    async active(_tx, s) {
      return structuredClone(
        [...records.values()].reverse().find((r) => r.sessionId === s),
      );
    },
    async get(_tx, s, id) {
      const r = records.get(id);
      return r?.sessionId === s ? structuredClone(r) : undefined;
    },
    async insert(_tx, r) {
      records.set(r.id, structuredClone(r));
    },
    async save(_tx, r, rev) {
      assert.equal(records.get(r.id)?.revision, rev);
      records.set(r.id, structuredClone(r));
    },
  };
  const amount = { currency_code: "USD", value: "500.00" };
  const api: SandboxPaymentPort = {
    async create() {
      assert.equal(inside, false);
      calls.create++;
      return { id: "ORDER1", status: "PAYER_ACTION_REQUIRED" };
    },
    async order() {
      assert.equal(inside, false);
      return {
        id: "ORDER1",
        status: captured
          ? "COMPLETED"
          : approved
            ? "APPROVED"
            : "PAYER_ACTION_REQUIRED",
        purchase_units: [
          {
            amount,
            ...(captured
              ? {
                  payments: {
                    captures: [
                      {
                        id: "CAP1",
                        status: refunded ? "REFUNDED" : "COMPLETED",
                        amount,
                      },
                    ],
                  },
                }
              : {}),
          },
        ],
      };
    },
    async capture() {
      assert.equal(inside, false);
      calls.capture++;
      captured = true;
      return { id: "ORDER1", status: "COMPLETED" };
    },
    async refund(_id, key) {
      assert.equal(inside, false);
      calls.refund++;
      refundKeys.push(key);
      refunded = true;
      if (loseRefund) {
        loseRefund = false;
        throw new SandboxPaymentError("LOST", "unknown");
      }
      return { id: "REF1", status: pending ? "PENDING" : "COMPLETED", amount };
    },
    async refundStatus() {
      assert.equal(inside, false);
      return { id: "REF1", status: pending ? "PENDING" : "COMPLETED", amount };
    },
  };
  const docs = {
    async readConfirmableDocument(_tx: Transaction, s: string, id: string) {
      if (s !== sid || id !== doc) throw Error("not this document");
      return {
        messageId: doc,
        markdown: "# Needs\nUser-approved edits",
        kind: "requirements_document" as const,
        complete: true as const,
        confirmedByMessageId: randomUUID(),
        hasPendingRevision: false as const,
      };
    },
  };
  const service = new ReceptionPaymentsService(
    store,
    docs,
    { clientId: "controlled-id", secret: "controlled-secret" },
    api,
    () => Date.now() + clockOffset,
  );
  const input = {
    documentMessageId: doc,
    confirmedMarkdown: "# Needs\nUser-approved edits",
    confirmedDocument: true as const,
    consentToSimulatedPublication: true as const,
    termsVersion: PAYMENT_TERMS_VERSION,
    requestKey: randomUUID(),
  };
  async function prepare() {
    return service.prepare(access, input);
  }
  async function create() {
    const p = await prepare();
    return service.create(access, p.paymentId, {
      termsVersion: PAYMENT_TERMS_VERSION,
      expectedRevision: p.revision,
      confirmedSandboxPayment: true,
      requestKey: randomUUID(),
    });
  }
  return {
    service,
    access,
    foreign,
    records,
    input,
    prepare,
    create,
    calls,
    refundKeys,
    advanceHours(hours: number) {
      clockOffset += hours * 3600000;
    },
    approve() {
      approved = true;
    },
    lose() {
      loseRefund = true;
    },
    pending() {
      pending = true;
    },
    complete() {
      pending = false;
    },
    api,
    store,
    docs,
  };
}
test("stale missing unapproved order closes once and only explicit replacement permits a new order", async () => {
  const f = fixture();
  const old = await f.create();
  assert.equal((await f.service.read(f.access, old.paymentId)).state, "awaiting_buyer");
  let lookups = 0;
  f.api.order = async () => {
    lookups++;
    throw new SandboxPaymentError("PAYPAL_ORDER_NOT_FOUND", "unknown");
  };
  const replacement = { ...f.input, requestKey: randomUUID(), replacePaymentId: old.paymentId };
  assert.equal((await f.service.read(f.access, old.paymentId)).state, "unknown");
  await assert.rejects(f.service.prepare(f.access, replacement));

  f.advanceHours(8);
  const closed = await f.service.read(f.access, old.paymentId);
  assert.equal(closed.replacementAvailable, true);
  assert.equal(closed.retryable, false);
  assert.equal(closed.orderId, "ORDER1");
  assert.deepEqual(await f.service.read(f.access, old.paymentId), closed);
  assert.equal(lookups, 2);
  await assert.rejects(f.service.capture(f.access, old.paymentId, "ORDER1"));
  await assert.rejects(f.service.prepare(f.foreign, replacement));
  await assert.rejects(f.service.prepare(f.access, { ...replacement, confirmedMarkdown: "# Changed" }));
  assert.equal((await f.prepare()).paymentId, old.paymentId);

  const next = await f.service.prepare(f.access, replacement);
  assert.notEqual(next.paymentId, old.paymentId);
  assert.equal(next.state, "awaiting_payment_consent");
  assert.equal(next.orderId, null);
  assert.equal((await f.service.prepare(f.access, replacement)).paymentId, next.paymentId);
  await assert.rejects(f.service.prepare(f.access, { ...replacement, requestKey: randomUUID() }));
  assert.deepEqual(f.calls, { create: 1, capture: 0, refund: 0 });

  f.api.create = async () => {
    f.calls.create++;
    return { id: "ORDER2", status: "PAYER_ACTION_REQUIRED" };
  };
  const created = await f.service.create(f.access, next.paymentId, {
    termsVersion: PAYMENT_TERMS_VERSION, expectedRevision: next.revision,
    confirmedSandboxPayment: true, requestKey: randomUUID(),
  });
  assert.equal(created.orderId, "ORDER2");
  assert.equal((await f.service.read(f.access, old.paymentId)).orderId, "ORDER1");
  assert.deepEqual(f.calls, { create: 2, capture: 0, refund: 0 });
});

test("a missing order after a capture attempt remains unknown and cannot be replaced", async () => {
  const f = fixture();
  const old = await f.create();
  f.approve();
  f.api.capture = async () => {
    f.calls.capture++;
    throw new SandboxPaymentError("PAYPAL_RESPONSE_UNKNOWN", "unknown");
  };
  assert.equal((await f.service.capture(f.access, old.paymentId, "ORDER1")).outcome, "unknown");
  f.advanceHours(8);
  f.api.order = async () => { throw new SandboxPaymentError("PAYPAL_ORDER_NOT_FOUND", "unknown"); };
  const checked = await f.service.read(f.access, old.paymentId);
  assert.equal(checked.state, "unknown");
  assert.equal(checked.replacementAvailable, undefined);
  await assert.rejects(f.service.prepare(f.access, {
    ...f.input, requestKey: randomUUID(), replacePaymentId: old.paymentId,
  }));
  assert.deepEqual(f.calls, { create: 1, capture: 1, refund: 0 });
});
test("document consent creates no provider transaction, binds exact snapshot and request replay", async () => {
  const f = fixture(),
    p = await f.prepare();
  assert.equal(p.state, "awaiting_payment_consent");
  assert.equal(f.calls.create, 0);
  assert.equal((await f.prepare()).paymentId, p.paymentId);
  await assert.rejects(
    f.service.prepare(f.access, {
      ...f.input,
      confirmedMarkdown: "changed without renewed request",
    }),
  );
  await assert.rejects(
    f.service.prepare(f.access, {
      ...f.input,
      documentMessageId: randomUUID(),
    }),
  );
  await assert.rejects(
    f.service.prepare(f.access, {
      ...f.input,
      consentToSimulatedPublication: false as unknown as true,
    }),
  );
});
test("create/capture uses same saved order, owns session, and NEVER auto-refunds", async () => {
  const f = fixture(),
    p = await f.create();
  assert.equal(p.orderId, "ORDER1");
  assert.equal(p.simulationState, "not_published");
  await assert.rejects(f.service.capture(f.foreign, p.paymentId, "ORDER1"));
  await assert.rejects(f.service.capture(f.access, p.paymentId, "STALEORDER"));
  const notApproved = await f.service.capture(f.access, p.paymentId, "ORDER1");
  assert.equal(notApproved.state, "failed");
  assert.equal(f.calls.capture, 0);
  f.approve();
  const paid = await f.service.capture(f.access, p.paymentId, "ORDER1");
  assert.equal(paid.state, "paid");
  assert.equal(paid.simulationState, "published_awaiting_connection");
  assert.equal(f.calls.refund, 0);
  await f.service.capture(f.access, p.paymentId, "ORDER1");
  assert.equal(f.calls.capture, 1);
});
test("explicit refund, pending status, same-key recovery and no duplicate refund", async () => {
  const f = fixture(),
    p = await f.create();
  f.approve();
  await f.service.capture(f.access, p.paymentId, "ORDER1");
  await assert.rejects(f.service.refund(f.access, p.paymentId, false));
  f.lose();
  const unknown = await f.service.refund(f.access, p.paymentId, true);
  assert.equal(unknown.state, "unknown");
  assert.equal(unknown.refundId, null);
  f.pending();
  const pending = await f.service.refund(f.access, p.paymentId, true);
  assert.equal(pending.state, "refund_pending");
  assert.equal(f.refundKeys[0], f.refundKeys[1]);
  f.complete();
  const done = await f.service.read(f.access, p.paymentId);
  assert.equal(done.state, "refunded");
  assert.equal(done.simulationState, "withdrawn_refunded");
  await f.service.refund(f.access, p.paymentId, true);
  assert.equal(f.calls.refund, 2);
});
test("unset credentials never start checkout; frozen terms and immutable doc cannot be bypassed", async () => {
  const f = fixture();
  const off = new ReceptionPaymentsService(
    f.store,
    f.docs,
    undefined,
    undefined,
  );
  assert.equal(off.terms().configured, false);
  const p = await off.prepare(f.access, f.input);
  await assert.rejects(
    off.create(f.access, p.paymentId, {
      termsVersion: PAYMENT_TERMS_VERSION,
      expectedRevision: p.revision,
      confirmedSandboxPayment: true,
      requestKey: randomUUID(),
    }),
  );
  const created = await f.create();
  await assert.rejects(
    f.service.prepare(f.access, {
      ...f.input,
      requestKey: randomUUID(),
      confirmedMarkdown: "new document after order exists",
    }),
  );
  assert.equal(created.terms.amount, "500.00");
});
test("persisted action reservation blocks concurrent calls and expired request windows fail closed", async () => {
  const f = fixture(),
    p = await f.create();
  const saved = f.records.get(p.paymentId)!;
  saved.pending = {
    action: "capture",
    leaseId: randomUUID(),
    expiresAt: Date.now() + 60000,
  };
  await assert.rejects(f.service.capture(f.access, p.paymentId, "ORDER1"));
  assert.equal(f.calls.capture, 0);
  saved.pending = null;
  saved.attemptedAt.capture = Date.now() - 7 * 3600000;
  await assert.rejects(f.service.capture(f.access, p.paymentId, "ORDER1"));
  assert.equal(f.calls.capture, 0);
});
test("URL recovery uses owned GET; later document changes cannot hide payment or block explicit refund", async () => {
  const f = fixture(),
    p = await f.create();
  f.approve();
  await f.service.capture(f.access, p.paymentId, "ORDER1");
  f.docs.readConfirmableDocument = async () => {
    throw Error("document revised after payment");
  };
  await assert.rejects(f.service.capture(f.access, p.paymentId, "ORDER1"));
  await assert.rejects(f.service.read(f.foreign, p.paymentId));
  const recovered = await f.service.read(f.access, p.paymentId);
  assert.equal(recovered.state, "paid");
  assert.equal(f.calls.create, 1);
  const refunded = await f.service.refund(f.access, p.paymentId, true);
  assert.equal(refunded.state, "refunded");
  assert.equal(f.calls.refund, 1);
});
test("expired persisted create reservation becomes unknown on GET without creating replacement order", async () => {
  const f = fixture(),
    p = await f.prepare(),
    saved = f.records.get(p.paymentId)!;
  saved.state = "creating";
  saved.pending = {
    action: "create",
    leaseId: randomUUID(),
    expiresAt: Date.now() - 1,
  };
  saved.attemptedAt.create = Date.now() - 120000;
  const recovered = await f.service.read(f.access, p.paymentId);
  assert.equal(recovered.state, "unknown");
  assert.equal(recovered.outcome, "unknown");
  assert.equal(recovered.retryable, true);
  assert.equal(f.calls.create, 0);
});

test("session discovery returns only the owned receipt and does not need the current document", async () => {
  const f = fixture();
  assert.deepEqual(await f.service.current(f.access), { payment: null });
  const payment = await f.create();
  f.approve();
  await f.service.capture(f.access, payment.paymentId, "ORDER1");
  f.docs.readConfirmableDocument = async () => {
    throw Error("new unconfirmed revision");
  };
  const found = await f.service.current(f.access);
  assert.equal(found.payment?.paymentId, payment.paymentId);
  assert.equal(found.payment?.state, "paid");
  assert.deepEqual(await f.service.current(f.foreign), { payment: null });
  assert.deepEqual(f.calls, { create: 1, capture: 1, refund: 0 });
});

test("lost refund response exposes explicit same-key recovery while reads never repeat a refund", async () => {
  const f = fixture(),
    payment = await f.create();
  f.approve();
  await f.service.capture(f.access, payment.paymentId, "ORDER1");
  f.lose();
  const lost = await f.service.refund(f.access, payment.paymentId, true);
  assert.equal(lost.refundRecoveryAvailable, true);
  const found = await f.service.current(f.access);
  assert.equal(found.payment?.state, "unknown");
  assert.equal(found.payment?.captureStatus, "REFUNDED");
  assert.equal(found.payment?.refundRecoveryAvailable, true);
  await f.service.read(f.access, payment.paymentId);
  assert.equal(f.calls.refund, 1, "status/discovery cannot dispatch refunds");
  await assert.rejects(f.service.refund(f.access, payment.paymentId, false));
  const recovered = await f.service.refund(f.access, payment.paymentId, true);
  assert.equal(recovered.state, "refunded");
  assert.equal(recovered.refundRecoveryAvailable, false);
  assert.equal(f.refundKeys[0], f.refundKeys[1]);
  await f.service.refund(f.access, payment.paymentId, true);
  assert.equal(f.calls.refund, 2, "finished refunds are not dispatched again");
});

test("refund recovery is unavailable outside the original provider idempotency window", async () => {
  const f = fixture(),
    payment = await f.create();
  f.approve();
  await f.service.capture(f.access, payment.paymentId, "ORDER1");
  f.lose();
  await f.service.refund(f.access, payment.paymentId, true);
  f.records.get(payment.paymentId)!.attemptedAt.refund =
    Date.now() - 7 * 3600000;
  const found = await f.service.current(f.access);
  assert.equal(found.payment?.state, "unknown");
  assert.equal(found.payment?.refundRecoveryAvailable, false);
  await assert.rejects(f.service.refund(f.access, payment.paymentId, true));
  assert.equal(f.calls.refund, 1);
});

test("a slow provider call retains its reservation beyond one minute", async () => {
  const f = fixture();
  let now = Date.now();
  const service = new ReceptionPaymentsService(
    f.store,
    f.docs,
    { clientId: "controlled-id", secret: "controlled-secret" },
    f.api,
    () => now,
  );
  const prepared = await service.prepare(f.access, f.input);
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const original = f.api.create;
  f.api.create = async (requestId) => {
    started();
    await gate;
    return original(requestId);
  };
  const input = {
    termsVersion: PAYMENT_TERMS_VERSION,
    expectedRevision: prepared.revision,
    confirmedSandboxPayment: true as const,
    requestKey: randomUUID(),
  };
  const creating = service.create(f.access, prepared.paymentId, input);
  await entered;
  try {
    now += 61000;
    assert.equal(
      (await service.read(f.access, prepared.paymentId)).state,
      "creating",
    );
    await assert.rejects(service.create(f.access, prepared.paymentId, input));
  } finally {
    release();
  }
  assert.equal((await creating).state, "awaiting_buyer");
  assert.equal(f.calls.create, 1);
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import { createApp } from "../apps/api/dist/src/poc/app.js";
import { config } from "../apps/api/dist/src/poc/config.js";
import { controlled, say, document } from "./controlled.mjs";
import {
  ReceptionSession,
  ReceptionRunView,
  ReceptionDocumentList,
  ReceptionPaymentView,
  formatRequirementsDocumentRequest,
  formatRequirementsDocumentConfirmation,
  deriveRequirementsDocumentState,
} from "../packages/contracts/dist/index.js";
const url = process.env.POC_TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw Error(
    "Use POC_TEST_DATABASE_URL ending in _test (isolated database, initialize first).",
  );
const f = await controlled();
const origin = "http://127.0.0.1:3219";
const cfg = config({
  DATABASE_URL: url,
  PORT: "3219",
  APP_ORIGIN: origin,
  FILE_STORAGE_DIR: ".data/test-files",
  TRACE_VIEWER_TOKEN: "synthetic_trace_token_00000000000000000000000000",
});
const svc = await createApp(cfg, {
  purpose: "synthetic-local-test",
  onError: (e) => {
    if (!(e.status < 500) && e.name !== "ZodError") console.error(e);
  },
  agent: f.agent,
  paypal: f.paypal,
});
const server = svc.app.listen(cfg.port, cfg.host);
await new Promise((r) => server.once("listening", r));
let cookie = "",
  csrf = "";
let checked = 0;
const rawFetch = globalThis.fetch;
globalThis.fetch = (url, options) => {
  assert.equal(
    new URL(String(url)).origin,
    origin,
    "No external services in acceptance",
  );
  return rawFetch(url, options);
};
async function request(
  path,
  {
    method = "GET",
    body,
    raw,
    token = csrf,
    auth = cookie,
    expect = 200,
    originHeader = origin,
  } = {},
) {
  const response = await fetch(origin + "/api/v1/" + path, {
    method,
    headers: {
      ...(auth ? { cookie: auth } : {}),
      ...(method === "GET"
        ? {}
        : {
            origin: originHeader,
            "X-CSRF-Token": token,
            "Content-Type": raw
              ? "application/octet-stream"
              : "application/json",
          }),
    },
    ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }),
  });
  assert.equal(
    response.status,
    expect,
    `${method} ${path}: ${await (response.status === expect ? Promise.resolve("") : response.text())}`,
  );
  checked++;
  return response;
}
async function json(path, options) {
  return (await request(path, options)).json();
}
async function send(text, outputs = [say("Synthetic acknowledgement.")]) {
  f.outputs.push(...outputs);
  const receipt = await json("reception/messages", {
    method: "POST",
    body: {
      body: text,
      clientMessageKey: randomUUID(),
      confirmedNonConfidential: true,
    },
  });
  for (let i = 0; i < 120; i++) {
    const v = ReceptionRunView.parse(
      await json("reception/runs/" + receipt.runId),
    );
    if (["done", "failed", "cancelled"].includes(v.state)) {
      assert.equal(v.state, "done", JSON.stringify(v));
      return v;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error("RUN_TIMEOUT");
}
try {
  await request("auth/login", { method: "POST", body: {}, expect: 404 });
  await request("reception/session", {
    method: "POST",
    body: {},
    originHeader: "https://attacker.invalid",
    expect: 403,
  });
  const sr = await request("reception/session", { method: "POST", body: {} });
  cookie = sr.headers.get("set-cookie").split(";")[0];
  const session = ReceptionSession.parse(await sr.json());
  csrf = session.csrfToken;
  assert.equal(
    ReceptionSession.parse(
      await json("reception/session", { method: "POST", body: {}, token: "" }),
    ).sessionId,
    session.sessionId,
  );
  await request("reception/clear", {
    method: "POST",
    body: {},
    token: "wrong",
    expect: 403,
  });
  assert.deepEqual(await json("reception/poc-payments/current"), {
    payment: null,
  });
  await request("reception/poc-payments/current", { auth: "", expect: 401 });
  const input =
    "The fictional shop needs invoice checks against orders and human review.";
  const first = await send(input, [
    [
      {
        type: "toolCall",
        id: "read1",
        name: "read",
        arguments: {
          path: "/ally-ahead/reception/skills/enterprise-diagnosis/SKILL.md",
        },
      },
    ],
    [
      {
        type: "toolCall",
        id: "communicate1",
        name: "communicate",
        arguments: {
          speech: "I am checking the fictional invoice workflow.",
          interaction: null,
        },
      },
    ],
    say("Which invoice fields should the clerk compare?"),
  ]);
  assert.equal(
    first.messages.filter((m) => m.delivery === "intermediate").length,
    1,
  );
  assert.equal(
    first.messages.filter(
      (m) => m.author === "assistant" && m.delivery === "final",
    ).length,
    1,
  );
  assert.ok(
    f.observations.some((c) =>
      JSON.stringify(c).includes("enterprise-diagnosis"),
    ),
  );
  const replayBody = {
    body: "Replay input",
    clientMessageKey: randomUUID(),
    confirmedNonConfidential: true,
  };
  f.outputs.push(say("Replay accepted once."));
  const a = await json("reception/messages", {
      method: "POST",
      body: replayBody,
    }),
    b = await json("reception/messages", { method: "POST", body: replayBody });
  assert.equal(a.runId, b.runId);
  await request("reception/messages", {
    method: "POST",
    body: { ...replayBody, body: "Different replay" },
    expect: 409,
  });
  while (svc.runner.active.size) await new Promise((r) => setTimeout(r, 50));
  const bytes = await readFile(
    new URL("./fixtures/brief.txt", import.meta.url),
  );
  let uploaded = await json("reception/documents", {
    method: "POST",
    body: {
      fileName: "brief.txt",
      format: "txt",
      declaredBytes: bytes.length,
      clientRequestKey: randomUUID(),
      confirmedNonConfidential: true,
    },
  });
  await json(`reception/documents/${uploaded.id}/content`, {
    method: "PUT",
    body: bytes,
    raw: true,
  });
  for (let i = 0; i < 100; i++) {
    const list = ReceptionDocumentList.parse(await json("reception/documents"));
    uploaded = list.documents.find((d) => d.id === uploaded.id);
    if (uploaded.state === "ready") break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(uploaded.state, "ready");
  assert.match(uploaded.sources[0].summary, /MOCK SUMMARY/);
  assert.equal(
    await (await request(`reception/documents/${uploaded.id}/original`)).text(),
    bytes.toString(),
  );
  const outline = await json(`reception/documents/${uploaded.id}/outline`);
  assert.ok(outline.nodes.length);
  const segment = await svc.doc
    .reader(session.sessionId)
    .read(uploaded.id, outline.nodes[0].id);
  assert.match(segment.text, /Synthetic/);
  const hits = await svc.doc
    .reader(session.sessionId)
    .search(uploaded.id, "invoice");
  assert.ok(hits.hits.length);
  const supplemented = await json(
    `reception/documents/${uploaded.id}/supplements`,
    {
      method: "POST",
      body: {
        text: "Supplement exception note for human review.",
        clientRequestKey: randomUUID(),
        confirmedNonConfidential: true,
      },
    },
  );
  const supplement = supplemented.sources.find((s) => s.kind === "supplement");
  assert.ok(supplement);
  await svc.db.pool.query("update documents set state='failed' where id=$1", [
    uploaded.id,
  ]);
  await json(`reception/documents/${uploaded.id}/retry`, {
    method: "POST",
    body: {},
  });
  while (svc.doc.active.has(uploaded.id))
    await new Promise((r) => setTimeout(r, 50));
  const retried = await svc.doc
    .reader(session.sessionId)
    .search(uploaded.id, "Supplement exception");
  assert.ok(
    retried.hits.some((h) => h.sourceId === supplement.id),
    "Retry preserves supplement index",
  );
  const evidence = [{ messageId: first.inputMessageId, quote: input }];
  const markdown = "# Invoice review\n\n## Approval\n\nClerks compare invoices against orders and send exceptions for human review.";
  const requestCount = f.observations.length;
  const v = await send(formatRequirementsDocumentRequest("en"), [
    markdown + "\n\n--- USER EVIDENCE ---\n[999]",
    "[1]",
  ]);
  let current = deriveRequirementsDocumentState(v.messages).current;
  assert.ok(current);
  assert.equal(current.document.markdown, markdown);
  assert.deepEqual(current.document.evidence, evidence);
  assert.equal(f.observations.length - requestCount, 2);
  assert.ok(f.observations.at(-1).messages.some(message =>
    message.role === "system" && String(message.content).includes("Correct only the evidence selection")));

  const terms = await json("reception/poc-payments/terms");
  const prepare = {
    documentMessageId: current.messageId,
    confirmedMarkdown: current.document.markdown,
    confirmedDocument: true,
    consentToSimulatedPublication: true,
    termsVersion: terms.termsVersion,
    requestKey: randomUUID(),
  };
  await request("reception/poc-payments/prepare", {
    method: "POST",
    body: prepare,
    expect: 409,
  });
  await send(formatRequirementsDocumentConfirmation(current.messageId, "en"));
  const p = ReceptionPaymentView.parse(
    await json("reception/poc-payments/prepare", {
      method: "POST",
      body: prepare,
    }),
  );
  assert.equal(f.calls.create, 0);
  const order = ReceptionPaymentView.parse(
    await json(`reception/poc-payments/${p.paymentId}/orders`, {
      method: "POST",
      body: {
        termsVersion: terms.termsVersion,
        expectedRevision: p.revision,
        confirmedSandboxPayment: true,
        requestKey: randomUUID(),
      },
    }),
  );
  assert.equal(order.state, "awaiting_buyer");
  const paid = ReceptionPaymentView.parse(
    await json(`reception/poc-payments/${p.paymentId}/capture`, {
      method: "POST",
      body: { orderId: order.orderId, requestKey: randomUUID() },
    }),
  );
  assert.equal(paid.state, "paid");
  assert.equal(f.calls.refund, 0);
  const ongoing = send("Keep discussing the synthetic scope.");
  for (let i = 0; i < 100 && !svc.runner.active.size; i++)
    await new Promise((r) => setTimeout(r, 10));
  await request("reception/clear", { method: "POST", body: {}, expect: 409 });
  await ongoing;
  const revision = formatRequirementsDocumentRequest("en", {
    documentMessageId: current.messageId,
    instruction: "Keep human approval explicit.",
  });
  await send(revision, [document(evidence)]);
  await request(`reception/poc-payments/${p.paymentId}/orders`, {
    method: "POST",
    body: {
      termsVersion: terms.termsVersion,
      expectedRevision: paid.revision,
      confirmedSandboxPayment: true,
      requestKey: randomUUID(),
    },
    expect: 404,
  });
  assert.equal(
    (await json(`reception/poc-payments/${p.paymentId}`)).state,
    "paid",
  );
  const discovered = await json("reception/poc-payments/current");
  assert.equal(discovered.payment.paymentId, p.paymentId);
  assert.equal(discovered.payment.state, "paid");
  assert.equal(f.calls.refund, 0);
  f.loseNextRefundResponse();
  const lost = await json(`reception/poc-payments/${p.paymentId}/refund`, {
    method: "POST",
    body: { confirmedFullRefund: true, requestKey: randomUUID() },
  });
  assert.equal(lost.state, "unknown");
  assert.equal(lost.refundRecoveryAvailable, true);
  const unknown = await json("reception/poc-payments/current");
  assert.equal(unknown.payment.state, "unknown");
  assert.equal(unknown.payment.captureStatus, "REFUNDED");
  assert.equal(unknown.payment.refundRecoveryAvailable, true);
  assert.equal(f.calls.refund, 1);
  await request(`reception/poc-payments/${p.paymentId}/refund`, {
    method: "POST",
    body: { confirmedFullRefund: false, requestKey: randomUUID() },
    expect: 422,
  });
  assert.equal(
    (
      await json(`reception/poc-payments/${p.paymentId}/refund`, {
        method: "POST",
        body: { confirmedFullRefund: true, requestKey: randomUUID() },
      })
    ).state,
    "refunded",
  );
  assert.equal(f.calls.refund, 2);
  assert.equal(f.refundKeys[0], f.refundKeys[1]);
  assert.equal(
    (await json("reception/poc-payments/current")).payment.state,
    "refunded",
  );
  assert.equal(f.calls.refund, 2);
  await request(`reception/runs/${v.runId}`, { auth: "", expect: 401 });
  const foreign = await request("reception/session", {
    method: "POST",
    body: {},
    auth: "",
  });
  const foreignCookie = foreign.headers.get("set-cookie").split(";")[0];
  await request(`reception/poc-payments/${p.paymentId}`, {
    auth: foreignCookie,
    expect: 404,
  });
  assert.deepEqual(
    await json("reception/poc-payments/current", { auth: foreignCookie }),
    { payment: null },
  );
  await request(`reception/documents/${uploaded.id}/original`, {
    auth: foreignCookie,
    expect: 404,
  });
  await request("ops/consultations/sessions", { expect: 401 });
  const ops = await fetch(origin + "/api/v1/ops/consultations/sessions", {
    headers: { Authorization: "Bearer " + cfg.traceToken },
  });
  assert.equal(ops.status, 200);
  const items = (await ops.json()).items;
  assert.ok(items.some((i) => i.sessionId === session.sessionId));
  const events = await fetch(
    `${origin}/api/v1/ops/consultations/runs/${first.runId}/events`,
    { headers: { Authorization: "Bearer " + cfg.traceToken } },
  );
  assert.ok((await events.json()).items.length);
  await assert.rejects(
    svc.db.pool.query(
      "update payments set record=jsonb_set(record,'{documentHash}','\"tampered\"'),revision=revision+1 where id=$1",
      [p.paymentId],
    ),
  );
  const tableNames = (
    await svc.db.pool.query(
      "select tablename from pg_tables where schemaname='public'",
    )
  ).rows.map((r) => r.tablename);
  assert.equal(tableNames.length, 10);
  assert.ok(!tableNames.includes("tenants"));
  console.log(
    JSON.stringify(
      {
        result: "PASS",
        httpChecks: checked,
        piProviderCalls: f.observations.length,
        paymentCalls: f.calls,
        dbTables: tableNames,
        mode: "synthetic Pi transport + mock summaries and PayPal; real PostgreSQL and HTTP",
      },
      null,
      2,
    ),
  );
} finally {
  globalThis.fetch = rawFetch;
  await new Promise((r) => server.close(r));
  await svc.close();
}

// Exercise the POC UI through local HTTP and PostgreSQL with synthetic providers.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createApp } from "../apps/api/dist/src/poc/app.js";
import { config } from "../apps/api/dist/src/poc/config.js";
import { controlled, say, document } from "./controlled.mjs";
const database = process.env.POC_TEST_DATABASE_URL;
if (!database || !new URL(database).pathname.endsWith("_test"))
  throw Error("Set isolated POC_TEST_DATABASE_URL ending in _test");
const f = await controlled();
const origin = "http://127.0.0.1:3221";
const svc = await createApp(
  config({
    DATABASE_URL: database,
    PORT: "3221",
    APP_ORIGIN: origin,
    FILE_STORAGE_DIR: ".data/browser-files",
  }),
  { purpose: "synthetic-local-test", agent: f.agent, paypal: f.paypal },
);
const server = svc.app.listen(3221, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
let browser;
const errors = [],
  external = [],
  apiPaths = [];
const shots =
  process.env.POC_SCREENSHOT_DIR ?? "/tmp/ally-poc-browser-evidence";
await mkdir(shots, { recursive: true });
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) {
      if (url.pathname.startsWith("/api/")) apiPaths.push(url.pathname);
      return route.continue();
    }
    if (url.hostname === "www.paypal.com" && url.pathname === "/sdk/js")
      return route.fulfill({
        contentType: "application/javascript",
        body: `window.allyPayPalSandbox={Buttons(options){let b;return{isEligible(){return true},async render(container){b=document.createElement('button');b.textContent='MOCK PayPal Sandbox';b.onclick=async()=>{try{const id=await options.createOrder();await options.onApprove({orderID:id});}catch(e){options.onError(e)}};container.appendChild(b)},async close(){b?.remove()}}}};`,
      });
    external.push(url.origin);
    await route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(origin);
  await page.getByRole("heading").first().waitFor();
  assert.equal(await page.title(), "Ally Ahead");
  await page.screenshot({ path: shots + "/home-zh-desktop.png" });
  await page.getByRole("button", { name: "EN", exact: true }).click();
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  await page.screenshot({ path: shots + "/home-en-desktop.png" });
  await page.locator(".header-start").click();
  await page.getByTestId("agent-composer").waitFor();
  await page
    .locator("#agent-input")
    .fill("Synthetic invoice workflow for a fictional shop.");
  f.outputs.push(say("Which invoice fields need human checking?"));
  await page.getByTestId("send-agent-input").click();
  await page
    .getByRole("button", { name: "Confirm and send", exact: true })
    .click();
  await page
    .getByText("Which invoice fields need human checking?", { exact: true })
    .first()
    .waitFor();
  f.outputs.push(document());
  await page.getByTestId("requirements-document-tools").click();
  const preview = page.getByTestId("requirement-document-preview");
  await preview.waitFor();
  await preview
    .getByRole("button", { name: "Confirm document accuracy", exact: true })
    .waitFor();
  const download = page.waitForEvent("download");
  await preview
    .getByRole("button", { name: "Download .md", exact: true })
    .click();
  assert.match((await download).suggestedFilename(), /\.md$/);
  f.outputs.push(say("The synthetic document confirmation is saved."));
  await preview
    .getByRole("button", { name: "Confirm document accuracy", exact: true })
    .click();
  await preview
    .getByRole("button", { name: "Current document confirmed", exact: true })
    .waitFor();
  await page.screenshot({ path: shots + "/document-confirmed-desktop.png" });
  await preview
    .getByRole("button", {
      name: "Continue to simulated publication",
      exact: true,
    })
    .click();
  await page.getByTestId("consent-sandbox-payment").waitFor();
  await page.getByTestId("consent-sandbox-payment").click();
  await page
    .getByRole("button", { name: "MOCK PayPal Sandbox", exact: true })
    .click();
  await page
    .locator('[data-testid="reception-payment-state"][data-state="paid"]')
    .waitFor();
  await page.getByTestId("poc-simulated-publication").waitFor();
  assert.equal(f.calls.refund, 0);
  await page.screenshot({ path: shots + "/mock-paid-desktop.png" });
  const paymentId = new URL(page.url()).searchParams.get("paymentId");
  assert.ok(paymentId);
  // Re-enter without a receipt URL: the server discovers only this session's payment.
  await page.goto(origin + "/reception");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.getByTestId("reception-payment-tools").click();
  await page
    .locator('[data-testid="reception-payment-state"][data-state="paid"]')
    .waitFor();
  assert.equal(new URL(page.url()).searchParams.get("paymentId"), paymentId);
  assert.deepEqual(f.calls, { create: 1, capture: 1, refund: 0 });
  await page
    .getByRole("button", {
      name: "Return to reception and keep discussing",
      exact: true,
    })
    .click();
  await page.getByTestId("requirements-document-tools").click();
  f.outputs.push(document());
  await preview
    .getByLabel("Additions or changes", { exact: true })
    .fill("Keep human approval explicit in the revised document.");
  await preview
    .getByRole("button", { name: "Revise the document", exact: true })
    .click();
  await expect(
    preview.getByRole("button", {
      name: "Confirm document accuracy",
      exact: true,
    }),
  ).toBeEnabled();
  await preview
    .getByRole("button", {
      name: "Keep talking / Add details or change direction",
      exact: true,
    })
    .click();
  // An unconfirmed replacement document must not hide the original paid receipt/refund.
  await page.goto(origin + "/reception");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.getByTestId("reception-payment-tools").click();
  await page
    .locator('[data-testid="reception-payment-state"][data-state="paid"]')
    .waitFor();
  assert.equal(new URL(page.url()).searchParams.get("paymentId"), paymentId);
  await page
    .getByText("This record belongs to an earlier confirmed document.", {
      exact: false,
    })
    .waitFor();
  assert.equal(await page.getByTestId("consent-sandbox-payment").count(), 0);
  assert.equal(f.calls.create, 1);
  f.loseNextRefundResponse();
  await page.getByTestId("request-sandbox-refund").click();
  await page
    .getByRole("button", { name: "Confirm test full refund", exact: true })
    .click();
  await page
    .locator('[data-testid="reception-payment-state"][data-state="unknown"]')
    .waitFor();
  assert.equal(f.calls.refund, 1);
  await page.screenshot({ path: shots + "/refund-response-lost-desktop.png" });
  // Discovery and status reads never repeat the refund; recovery requires fresh explicit consent.
  await page.goto(origin + "/reception");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.getByTestId("reception-payment-tools").click();
  await page
    .locator('[data-testid="reception-payment-state"][data-state="unknown"]')
    .waitFor();
  assert.equal(f.calls.refund, 1);
  await page
    .getByRole("button", { name: "Check payment / refund status", exact: true })
    .click();
  await expect(page.getByTestId("recover-sandbox-refund")).toBeEnabled();
  assert.equal(f.calls.refund, 1);
  await page.getByTestId("recover-sandbox-refund").click();
  await page
    .getByRole("button", { name: "Keep the payment", exact: true })
    .click();
  assert.equal(f.calls.refund, 1);
  await page.getByTestId("recover-sandbox-refund").click();
  await page
    .getByRole("button", {
      name: "Confirm previous refund recovery",
      exact: true,
    })
    .click();
  await page
    .locator('[data-testid="reception-payment-state"][data-state="refunded"]')
    .waitFor();
  assert.equal(f.calls.refund, 2);
  assert.equal(f.refundKeys[0], f.refundKeys[1]);
  await page.reload();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.getByTestId("reception-payment-tools").click();
  await page
    .locator('[data-testid="reception-payment-state"][data-state="refunded"]')
    .waitFor();
  assert.equal(f.calls.refund, 2);
  assert.equal(await page.getByTestId("recover-sandbox-refund").count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: shots + "/mock-refunded-mobile.png" });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page
    .getByRole("button", {
      name: "Return to reception and keep discussing",
      exact: true,
    })
    .click();
  await page.screenshot({ path: shots + "/reception-mobile.png" });
  assert.equal((await page.request.get(origin + "/login")).status(), 404);
  assert.equal(
    (await page.request.get(origin + "/api/v1/tenants")).status(),
    404,
  );
  assert.equal(await page.locator("vite-error-overlay").count(), 0);
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  assert.ok(!apiPaths.some((p) => /\/me$|\/tenants|\/auth|claim/.test(p)));
  console.log(
    JSON.stringify(
      {
        result: "PASS",
        viewports: ["1440x1000", "390x844"],
        checks: [
          "homepage zh/en",
          "reception first-message consent",
          "saved final reply",
          "document generation/download/confirmation",
          "separate publication and checkout consent",
          "mock PayPal button/capture",
          "receipt discovery without URL",
          "old receipt after document revision",
          "lost refund response",
          "explicit same-key refund recovery",
          "no refund on status reads",
          "completed refund survives refresh",
          "mobile overflow",
          "formal route absent",
          "no page/console errors",
          "zero external traffic",
        ],
        paymentCalls: f.calls,
        screenshots: shots,
        mock: true,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error("BROWSER_FINDING", error.message);
  throw error;
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
  await svc.close();
}

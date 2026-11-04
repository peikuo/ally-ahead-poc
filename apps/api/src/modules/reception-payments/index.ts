import type { Request } from "express";
import { loadReceptionPaymentConfig } from "./reception-payments.config.js";
import {
  PayPalSandboxClient,
  type SandboxPaymentPort,
} from "./paypal-sandbox.client.js";
import type {
  ReceptionPaymentAccess,
  ReceptionPaymentDocumentReader,
  ReceptionPaymentStore,
} from "./reception-payments.ports.js";
import { ReceptionPaymentsService } from "./reception-payments.service.js";
import { paymentRouter } from "./reception-payments.routes.js";

export type { SandboxPaymentPort } from "./paypal-sandbox.client.js";

export function createReceptionPaymentsRouter<Tx>(options: {
  store: ReceptionPaymentStore<Tx>;
  documents: ReceptionPaymentDocumentReader<Tx>;
  access: (request: Request) => ReceptionPaymentAccess<Tx>;
  testProvider?: {
    purpose: "synthetic-local-test";
    client: SandboxPaymentPort;
  };
}) {
  if (
    options.testProvider &&
    options.testProvider.purpose !== "synthetic-local-test"
  ) {
    throw new Error("INVALID_TEST_BINDINGS");
  }
  const config = options.testProvider
    ? { clientId: "synthetic-test-only", secret: "synthetic-test-only" }
    : loadReceptionPaymentConfig();
  const provider =
    options.testProvider?.client ??
    (config ? new PayPalSandboxClient(config) : undefined);
  const service = new ReceptionPaymentsService(
    options.store,
    options.documents,
    config,
    provider,
  );
  return paymentRouter(service, options.access);
}

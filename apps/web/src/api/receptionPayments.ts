import {
  Id,
  ReceptionPaymentTerms,
  ReceptionPaymentView,
  ReceptionCurrentPayment,
  PrepareReceptionPayment,
  CreateReceptionPaymentOrder,
  CaptureReceptionPayment,
  RefundReceptionPayment,
} from "@ally-ahead/contracts";
import type { z } from "zod";
import { receptionRequest } from "./reception";

export type PaymentView = z.infer<typeof ReceptionPaymentView>;
export type PaymentTerms = z.infer<typeof ReceptionPaymentTerms>;
const path = (id: string) =>
  `/poc-payments/${encodeURIComponent(Id.parse(id))}`;
export const receptionPayments = {
  current: (signal: AbortSignal) =>
    receptionRequest("/poc-payments/current", ReceptionCurrentPayment, signal),
  terms: (signal: AbortSignal) =>
    receptionRequest("/poc-payments/terms", ReceptionPaymentTerms, signal),
  read: (id: string, signal: AbortSignal) =>
    receptionRequest(path(id), ReceptionPaymentView, signal),
  prepare: (
    token: string,
    input: z.infer<typeof PrepareReceptionPayment>,
    signal: AbortSignal,
  ) =>
    receptionRequest("/poc-payments/prepare", ReceptionPaymentView, signal, {
      token,
      body: PrepareReceptionPayment.parse(input),
    }),
  create: (
    token: string,
    id: string,
    input: z.infer<typeof CreateReceptionPaymentOrder>,
    signal: AbortSignal,
  ) =>
    receptionRequest(`${path(id)}/orders`, ReceptionPaymentView, signal, {
      token,
      body: CreateReceptionPaymentOrder.parse(input),
    }),
  capture: (
    token: string,
    id: string,
    input: z.infer<typeof CaptureReceptionPayment>,
    signal: AbortSignal,
  ) =>
    receptionRequest(`${path(id)}/capture`, ReceptionPaymentView, signal, {
      token,
      body: CaptureReceptionPayment.parse(input),
    }),
  refund: (
    token: string,
    id: string,
    input: z.infer<typeof RefundReceptionPayment>,
    signal: AbortSignal,
  ) =>
    receptionRequest(`${path(id)}/refund`, ReceptionPaymentView, signal, {
      token,
      body: RefundReceptionPayment.parse(input),
    }),
};

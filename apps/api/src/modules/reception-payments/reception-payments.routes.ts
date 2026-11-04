import { Router, type Request } from "express";
import {
  Id,
  PrepareReceptionPayment,
  CreateReceptionPaymentOrder,
  CaptureReceptionPayment,
  RefundReceptionPayment,
} from "@ally-ahead/contracts";
import type { ReceptionPaymentAccess } from "./reception-payments.ports.js";
import type { ReceptionPaymentsService } from "./reception-payments.service.js";

// Authentication/CSRF and transaction ownership are supplied by the application.
export function paymentRouter<Tx>(
  service: ReceptionPaymentsService<Tx>,
  access: (req: Request) => ReceptionPaymentAccess<Tx>,
) {
  const router = Router();
  router.get("/terms", async (req, res) => {
    res.json(await access(req)(async () => service.terms()));
  });
  router.get("/current", async (req, res) => {
    res.json(await service.current(access(req)));
  });
  router.post("/prepare", async (req, res) => {
    res.json(
      await service.prepare(
        access(req),
        PrepareReceptionPayment.parse(req.body),
      ),
    );
  });
  router.get("/:id", async (req, res) => {
    res.json(await service.read(access(req), Id.parse(req.params.id)));
  });
  router.post("/:id/orders", async (req, res) => {
    res.json(
      await service.create(
        access(req),
        Id.parse(req.params.id),
        CreateReceptionPaymentOrder.parse(req.body),
      ),
    );
  });
  router.post("/:id/capture", async (req, res) => {
    res.json(
      await service.capture(
        access(req),
        Id.parse(req.params.id),
        CaptureReceptionPayment.parse(req.body).orderId,
      ),
    );
  });
  router.post("/:id/refund", async (req, res) => {
    res.json(
      await service.refund(
        access(req),
        Id.parse(req.params.id),
        RefundReceptionPayment.parse(req.body).confirmedFullRefund,
      ),
    );
  });
  return router;
}

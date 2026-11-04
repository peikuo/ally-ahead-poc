import { deriveRequirementsDocumentState } from "@ally-ahead/contracts";
import type { Transaction } from "../infrastructure/database.js";
import { AppError } from "../infrastructure/errors.js";
import type { ReceptionPaymentDocumentReader } from "../modules/reception-payments/reception-payments.ports.js";
import { messages } from "./store.js";

export const paymentDocuments: ReceptionPaymentDocumentReader<Transaction> = {
  async readConfirmableDocument(tx, sid, id) {
    const current = deriveRequirementsDocumentState(
      await messages(tx, sid),
    ).current;
    if (!current || current.messageId !== id)
      throw new AppError("NOT_FOUND", 404);
    if (!current.confirmedByMessageId || current.hasPendingRevision)
      throw new AppError("CONFLICT", 409);
    return {
      messageId: id,
      markdown: current.document.markdown,
      kind: "requirements_document",
      complete: true,
      confirmedByMessageId: current.confirmedByMessageId,
      hasPendingRevision: false,
    };
  },
};

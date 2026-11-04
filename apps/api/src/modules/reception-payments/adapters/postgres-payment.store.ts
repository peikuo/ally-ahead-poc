import type { Transaction } from "../../../infrastructure/database.js";
import { AppError } from "../../../infrastructure/errors.js";
import type {
  ReceptionPaymentStore,
  ReceptionPaymentRecord,
} from "../reception-payments.ports.js";

export class PostgresPaymentStore
  implements ReceptionPaymentStore<Transaction>
{
  async lockSession(tx: Transaction, sessionId: string) {
    if (
      !(
        await tx.query("select id from sessions where id=$1 for update", [
          sessionId,
        ])
      ).rowCount
    ) {
      throw new AppError("NOT_FOUND", 404);
    }
  }
  async byPrepareKey(tx: Transaction, sid: string, key: string) {
    return (
      await tx.query(
        "select record from payments where session_id=$1 and prepare_key=$2",
        [sid, key],
      )
    ).rows[0]?.record;
  }
  async active(tx: Transaction, sid: string) {
    return (
      await tx.query(
        "select record from payments where session_id=$1 order by created_at desc limit 1",
        [sid],
      )
    ).rows[0]?.record;
  }
  async get(tx: Transaction, sid: string, id: string, lock: boolean) {
    return (
      await tx.query(
        `select record from payments where session_id=$1 and id=$2 ${lock ? "for update" : ""}`,
        [sid, id],
      )
    ).rows[0]?.record;
  }
  async insert(tx: Transaction, r: ReceptionPaymentRecord) {
    await tx.query(
      "insert into payments(id,session_id,document_message_id,prepare_key,revision,record) values($1,$2,$3,$4,$5,$6)",
      [
        r.id,
        r.sessionId,
        r.documentMessageId,
        r.prepareRequestKey,
        r.revision,
        r,
      ],
    );
  }
  async save(tx: Transaction, r: ReceptionPaymentRecord, rev: number) {
    if (
      !(
        await tx.query(
          "update payments set revision=$1,record=$2 where id=$3 and session_id=$4 and revision=$5",
          [r.revision, r, r.id, r.sessionId, rev],
        )
      ).rowCount
    )
      throw new AppError("CONFLICT", 409);
  }
}

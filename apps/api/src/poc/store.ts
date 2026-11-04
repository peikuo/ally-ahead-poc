import { randomUUID } from "node:crypto";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { ReceptionRunView } from "@ally-ahead/contracts";
import type { Transaction } from "../infrastructure/database.js";
import { AppError } from "../infrastructure/errors.js";
import {
  captureEntry,
  validateHistory,
  visibleText,
  type EntryPolicy,
  type StoredEntry,
} from "../modules/agent/entry-codec.js";
export async function lockSession(tx: Transaction, sid: string) {
  if (
    !(await tx.query("select id from sessions where id=$1 for update", [sid]))
      .rowCount
  )
    throw new AppError("NOT_FOUND", 404);
}
export async function messages(tx: Transaction, sid: string) {
  return (
    await tx.query(
      'select id as "messageId",message_key as "messageKey",author,text,delivery from messages where session_id=$1 order by ordinal',
      [sid],
    )
  ).rows.map((r) => ({ ...r, ...(r.delivery ? {} : { delivery: undefined }) }));
}
export async function run(tx: Transaction, sid: string, id?: string) {
  const r = (
    await tx.query(
      `select * from runs where session_id=$1 ${id ? "and id=$2" : ""} order by created_at desc limit 1`,
      id ? [sid, id] : [sid],
    )
  ).rows[0];
  if (!r) {
    if (id) throw new AppError("NOT_FOUND", 404);
    return null;
  }
  return ReceptionRunView.parse({
    runId: r.id,
    sessionId: sid,
    inputMessageId: r.input_id,
    state: r.state,
    finalMessageId: r.final_message_id,
    revision: r.revision,
    snapshot: r.snapshot,
    failure: r.failure,
    messages: await messages(tx, sid),
  });
}
export async function history(
  tx: Transaction,
  sid: string,
): Promise<StoredEntry[]> {
  return (
    await tx.query(
      'select entry_id as "entryId",parent_entry_id as "parentEntryId",mapping_id as "messageId",sequence,entry from native_entries where session_id=$1 order by sequence',
      [sid],
    )
  ).rows;
}
export async function assertRunning(tx: Transaction, sid: string, rid: string) {
  await lockSession(tx, sid);
  if (
    !(
      await tx.query(
        "select id from runs where id=$1 and session_id=$2 and state='running'",
        [rid, sid],
      )
    ).rowCount
  )
    throw new AppError("CONFLICT", 409);
}
export async function saveEntries(
  tx: Transaction,
  sid: string,
  rid: string,
  natives: SessionEntry[],
  policy: EntryPolicy,
) {
  await assertRunning(tx, sid, rid);
  const previous = await history(tx, sid),
    next = [...previous];
  for (const native of natives) {
    const entry = captureEntry(native, policy);
    const old = next.find((r) => r.entryId === entry.id);
    if (old) {
      if (JSON.stringify(old.entry) !== JSON.stringify(entry))
        throw new AppError("CONFLICT", 409);
      continue;
    }
    if (entry.parentId !== (next.at(-1)?.entryId ?? null))
      throw new AppError("CONFLICT", 409);
    const visible = visibleText(entry);
    let mid = randomUUID();
    if (visible?.author === "user") {
      const input = (
        await tx.query(
          "select input_id,input_text,input_at from runs where id=$1",
          [rid],
        )
      ).rows[0];
      if (
        entry.id !== input.input_id ||
        visible.text !== input.input_text ||
        entry.timestamp !== input.input_at.toISOString()
      )
        throw new AppError("CONFLICT", 409);
      mid = input.input_id;
    }
    next.push({
      entryId: entry.id,
      parentEntryId: entry.parentId,
      messageId: mid,
      sequence: next.length + 1,
      entry,
    });
  }
  validateHistory(next, policy);
  if (next.length > 1000 || Buffer.byteLength(JSON.stringify(next)) > 2_000_000)
    throw new AppError("RATE_LIMITED", 429);
  let published = false;
  for (const row of next.slice(previous.length)) {
    await tx.query(
      "insert into native_entries(session_id,sequence,entry_id,parent_entry_id,mapping_id,entry) values($1,$2,$3,$4,$5,$6)",
      [
        sid,
        row.sequence,
        row.entryId,
        row.parentEntryId,
        row.messageId,
        row.entry,
      ],
    );
    const v = visibleText(row.entry as SessionEntry);
    if (v?.author === "assistant") {
      await tx.query(
        "insert into messages(id,session_id,run_id,author,text,delivery,message_key) values($1,$2,$3,$4,$5,$6,$7)",
        [
          row.messageId,
          sid,
          rid,
          v.author,
          v.text,
          v.delivery ?? "final",
          row.entryId,
        ],
      );
      published = true;
    }
  }
  await tx.query(
    `update runs set revision=revision+1 ${published ? ",snapshot=null" : ""} where id=$1`,
    [rid],
  );
  return next;
}

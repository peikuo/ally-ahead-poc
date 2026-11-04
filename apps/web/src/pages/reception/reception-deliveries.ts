import type { RunView } from "../../api/agent";

type Message = RunView["messages"][number];

export function uniqueReceptionMessages(
  messages: readonly Message[],
): Message[] {
  // Full authoritative views replace one another; this is not an append cache.
  // Keep stable order/identity even if a repeated transport row is present.
  return [
    ...new Map(
      messages.map((message) => [message.messageId, message]),
    ).values(),
  ];
}

export function receptionTurnReplies(
  messages: readonly Message[],
  inputMessageId?: string,
): Message[] {
  if (!inputMessageId) return [];
  const ordered = uniqueReceptionMessages(messages);
  const boundary = ordered.findIndex(
    (message) =>
      message.messageId === inputMessageId && message.author === "user",
  );
  if (boundary < 0) return [];
  const nextInput = ordered.findIndex(
    (message, index) => index > boundary && message.author === "user",
  );
  return ordered
    .slice(boundary + 1, nextInput < 0 ? undefined : nextInput)
    .filter((message) => message.author === "assistant");
}

export function isIntermediateReceptionMessage(message: Message): boolean {
  return "delivery" in message && message.delivery === "intermediate";
}

export function finalReceptionReply(
  view:
    | Pick<RunView, "state" | "messages" | "inputMessageId" | "finalMessageId">
    | null
    | undefined,
): Message | undefined {
  if (view?.state !== "done" || !view.finalMessageId) return undefined;
  // Missing delivery on old saved assistant messages retains final semantics.
  // Never use a previous turn's final or promote an intermediate on failure.
  return receptionTurnReplies(view.messages, view.inputMessageId).findLast(
    (message) =>
      message.messageId === view.finalMessageId &&
      !isIntermediateReceptionMessage(message),
  );
}

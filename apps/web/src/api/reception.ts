import {
  AgentRunReceipt,
  ApiError,
  ReceptionRunView,
  ReceptionSession,
  StartReceptionRun,
} from "@ally-ahead/contracts";
import type { z } from "zod";
import { RequestError } from "./client";
export type ReceptionView = z.infer<typeof ReceptionRunView>;
export type ReceptionSessionView = z.infer<typeof ReceptionSession>;
// Guest CSRF stays with the reception session and never replaces account CSRF.
export async function receptionRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  signal: AbortSignal,
  post?: {
    token?: string;
    accountToken?: string;
    body?: unknown;
    rawBody?: Blob;
    method?: "POST" | "PUT";
  },
) {
  let response: Response;
  try {
    response = await fetch(`/api/v1/reception${path}`, {
      method: post ? (post.method ?? "POST") : "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal,
      headers: {
        Accept: "application/json",
        ...(post
          ? {
              "Content-Type": post.rawBody
                ? "application/octet-stream"
                : "application/json",
              ...(post.token ? { "X-CSRF-Token": post.token } : {}),
              ...(post.accountToken
                ? { "X-Account-CSRF-Token": post.accountToken }
                : {}),
            }
          : {}),
      },
      ...(post ? { body: post.rawBody ?? JSON.stringify(post.body) } : {}),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new RequestError(0, "NETWORK_ERROR");
  }
  const data: unknown = await response.json().catch(() => null);
  signal.throwIfAborted();
  if (!response.ok) {
    const error = ApiError.safeParse(data);
    throw new RequestError(
      response.status,
      error.success ? error.data.error.code : "INVALID_RESPONSE",
    );
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    throw new RequestError(response.status, "INVALID_RESPONSE");
  return parsed.data;
}
export const receptionApi = {
  session: (signal: AbortSignal) =>
    receptionRequest("/session", ReceptionSession, signal, { body: {} }),
  clear: (token: string, signal: AbortSignal) =>
    receptionRequest(
      "/clear",
      ReceptionSession.refine((v) => v.run === null),
      signal,
      {
        token,
        body: {},
      },
    ),
  read: (id: string, signal: AbortSignal) =>
    receptionRequest(
      `/runs/${encodeURIComponent(id)}`,
      ReceptionRunView.refine((v) => v.runId === id),
      signal,
    ),
  send: (
    token: string,
    input: z.infer<typeof StartReceptionRun>,
    signal: AbortSignal,
  ) =>
    receptionRequest("/messages", AgentRunReceipt, signal, {
      token,
      body: StartReceptionRun.parse(input),
    }),
  stop: (token: string, id: string, signal: AbortSignal) =>
    receptionRequest(
      `/runs/${encodeURIComponent(id)}/stop`,
      ReceptionRunView,
      signal,
      {
        token,
        body: {},
      },
    ),
};

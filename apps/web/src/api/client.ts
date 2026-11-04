import { ApiError } from "@ally-ahead/contracts";
import type { z } from "zod";

import { accessEvents, getCsrfToken, setCsrfToken } from "./sessionMemory";
export { accessEvents, setCsrfToken } from "./sessionMemory";

export class RequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly requestId?: string,
  ) {
    super(code);
    this.name = "RequestError";
  }
}

type Options = {
  method?: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  body?: unknown;
  rawBody?: Blob;
  rawMime?: "audio/wav";
  signal?: AbortSignal;
  forbidden?: "revalidate" | "local";
};
export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  options?: Options,
): Promise<T>;
export async function request(
  path: string,
  schema: null,
  options?: Options,
): Promise<void>;
export async function request<T>(
  path: string,
  schema: z.ZodType<T> | null,
  options: Options = {},
): Promise<T | void> {
  const response = await fetchResponse(path, options);
  if (schema === null && response.status === 204) return;
  const parsed = schema?.safeParse(await response.json().catch(() => null));
  options.signal?.throwIfAborted();
  if (!parsed?.success)
    throw new RequestError(
      response.status,
      "INVALID_RESPONSE",
      response.headers.get("X-Request-Id") ?? undefined,
    );
  return parsed.data;
}

async function fetchResponse(
  path: string,
  options: Options,
  accept = "application/json",
) {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: accept };
  if (options.rawBody)
    headers["Content-Type"] = options.rawMime ?? "application/octet-stream";
  else if (options.body !== undefined)
    headers["Content-Type"] = "application/json";
  const csrf = getCsrfToken();
  if (method !== "GET" && csrf) headers["X-CSRF-Token"] = csrf;
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      ...(options.rawBody
        ? { body: options.rawBody }
        : options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (
      options.signal?.aborted ||
      (error instanceof DOMException && error.name === "AbortError")
    )
      throw error;
    throw new RequestError(0, "NETWORK_ERROR");
  }
  options.signal?.throwIfAborted();
  if (!response.ok) {
    const payload = ApiError.safeParse(await response.json().catch(() => null));
    options.signal?.throwIfAborted();
    const fault = payload.success ? payload.data.error : undefined;
    // A late response from a prior session must not clear a newer login.
    if (getCsrfToken() === csrf) {
      if (response.status === 401) {
        setCsrfToken(null);
        accessEvents.dispatchEvent(new Event("unauthenticated"));
      }
      if (response.status === 403 && options.forbidden !== "local")
        accessEvents.dispatchEvent(new Event("forbidden"));
    }
    throw new RequestError(
      response.status,
      fault?.code ?? "INVALID_RESPONSE",
      fault?.requestId ?? response.headers.get("X-Request-Id") ?? undefined,
    );
  }
  return response;
}
export async function requestAudio(
  path: string,
  options: Options,
): Promise<Blob> {
  const response = await fetchResponse(path, options, "audio/wav");
  if (
    response.headers.get("content-type")?.split(";")[0]?.trim() !== "audio/wav"
  )
    throw new RequestError(response.status, "INVALID_RESPONSE");
  const blob = await response.blob();
  options.signal?.throwIfAborted();
  if (!blob.size || blob.size > 32 * 1024 * 1024)
    throw new RequestError(response.status, "INVALID_RESPONSE");
  return blob;
}

export function isAborted(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

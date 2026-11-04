import type { z } from "zod";

export class OpsReadError extends Error {
  constructor(
    public readonly status: number,
    public readonly kind: "http" | "network" | "response" | "https",
  ) {
    super(kind);
  }
}

// This reader is independent of account cookies and their CSRF/session events.
// Its caller owns an in-memory token and aborts all readers on lock or unmount.
export async function readOps<T>(
  path: string,
  token: string,
  schema: z.ZodType<T>,
  signal: AbortSignal,
): Promise<T> {
  if ((location.protocol !== "https:" && !["localhost","127.0.0.1","[::1]"].includes(location.hostname))) throw new OpsReadError(0, "https");
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(token))
    throw new OpsReadError(401, "http");
  let response: Response;
  try {
    response = await fetch(`/api/v1/ops/consultations${path}`, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
  } catch {
    if (signal.aborted) throw signal.reason;
    throw new OpsReadError(0, "network");
  }
  if (!response.ok) throw new OpsReadError(response.status, "http");
  const parsed = schema.safeParse(await response.json().catch(() => null));
  signal.throwIfAborted();
  if (!parsed.success) throw new OpsReadError(response.status, "response");
  return parsed.data;
}

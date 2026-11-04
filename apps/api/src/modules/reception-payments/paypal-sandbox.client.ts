import { z } from "zod";
const amount = z.object({
  currency_code: z.string().regex(/^[A-Z]{3}$/),
  value: z.string().min(1).max(32),
});
const capture = z.object({
  id: z.string().regex(/^[A-Z0-9]{1,64}$/),
  status: z.string().regex(/^[A-Z_]{1,64}$/),
  amount,
});
const order = z.object({
  id: z.string().regex(/^[A-Z0-9]{1,64}$/),
  status: z.string().regex(/^[A-Z_]{1,64}$/),
  purchase_units: z
    .array(
      z.object({
        amount: amount.optional(),
        payments: z
          .object({ captures: z.array(capture).optional() })
          .optional(),
      }),
    )
    .optional(),
});
const refund = z.object({
  id: z.string().regex(/^[A-Z0-9]{1,64}$/),
  status: z.string().regex(/^[A-Z_]{1,64}$/),
  amount,
});
export type PayPalOrder = z.infer<typeof order>;
export type PayPalCapture = z.infer<typeof capture>;
export type PayPalRefund = z.infer<typeof refund>;
export class SandboxPaymentError extends Error {
  constructor(
    readonly code: string,
    readonly outcome: "unknown" | "failed" = "failed",
  ) {
    super(code);
  }
}
export interface SandboxPaymentPort {
  create(requestId: string): Promise<PayPalOrder>;
  order(orderId: string): Promise<PayPalOrder>;
  capture(orderId: string, requestId: string): Promise<PayPalOrder>;
  refund(captureId: string, requestId: string): Promise<PayPalRefund>;
  refundStatus(refundId: string): Promise<PayPalRefund>;
}
const base = "https://api-m.sandbox.paypal.com";
export class PayPalSandboxClient implements SandboxPaymentPort {
  #token?: string;
  #expires = 0;
  #pendingToken?: Promise<string>;
  constructor(
    private readonly credentials: { clientId: string; secret: string },
    private readonly transport: typeof fetch = fetch,
  ) {}
  private async json(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await this.transport(base + path, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(25000),
      });
    } catch {
      throw new SandboxPaymentError("PAYPAL_RESPONSE_UNKNOWN", "unknown");
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new SandboxPaymentError("PAYPAL_RESPONSE_INVALID", "unknown");
    }
    if (!response.ok) {
      // 5xx might have occurred after the mutation; query before any retry.
      throw new SandboxPaymentError(
        response.status === 401
          ? "PAYPAL_AUTH_FAILED"
          : "PAYPAL_REQUEST_FAILED",
        response.status >= 500 ? "unknown" : "failed",
      );
    }
    return body;
  }
  private async accessToken(): Promise<string> {
    if (this.#token && Date.now() < this.#expires) return this.#token;
    if (!this.#pendingToken)
      this.#pendingToken = (async () => {
        const data = z
          .object({
            access_token: z.string().min(1),
            token_type: z.literal("Bearer"),
            expires_in: z.number().positive(),
          })
          .safeParse(
            await this.json("/v1/oauth2/token", {
              method: "POST",
              headers: {
                Authorization:
                  "Basic " +
                  Buffer.from(
                    this.credentials.clientId + ":" + this.credentials.secret,
                  ).toString("base64"),
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: "grant_type=client_credentials",
            }),
          );
        if (!data.success) throw new SandboxPaymentError("PAYPAL_AUTH_INVALID");
        this.#token = data.data.access_token;
        this.#expires =
          Date.now() + Math.max(0, data.data.expires_in - 60) * 1000;
        return this.#token;
      })().finally(() => {
        this.#pendingToken = undefined;
      });
    return this.#pendingToken;
  }
  private id(value: string): string {
    if (!/^[A-Z0-9]{1,64}$/.test(value))
      throw new SandboxPaymentError("PAYPAL_ID_INVALID");
    return value;
  }
  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    body?: object,
    requestId?: string,
  ): Promise<T> {
    if (body && !requestId?.match(/^[0-9a-f-]{36}$/))
      throw new SandboxPaymentError("PAYPAL_REQUEST_ID_INVALID");
    const token = await this.accessToken();
    const raw = await this.json(path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const parsed = schema.safeParse(raw);
    if (!parsed.success)
      throw new SandboxPaymentError("PAYPAL_RESPONSE_INVALID", "unknown");
    return parsed.data;
  }
  create(key: string) {
    return this.request(
      "/v2/checkout/orders",
      order,
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            description: "Sandbox refundable connection intent — no real fees",
            amount: { currency_code: "USD", value: "500.00" },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              shipping_preference: "NO_SHIPPING",
              user_action: "PAY_NOW",
            },
          },
        },
      },
      key,
    );
  }
  order(id: string) {
    return this.request("/v2/checkout/orders/" + this.id(id), order);
  }
  capture(id: string, key: string) {
    return this.request(
      "/v2/checkout/orders/" + this.id(id) + "/capture",
      order,
      {},
      key,
    );
  }
  refund(id: string, key: string) {
    return this.request(
      "/v2/payments/captures/" + this.id(id) + "/refund",
      refund,
      { amount: { currency_code: "USD", value: "500.00" } },
      key,
    );
  }
  refundStatus(id: string) {
    return this.request("/v2/payments/refunds/" + this.id(id), refund);
  }
}
export function exactCapture(value: PayPalOrder): PayPalCapture | undefined {
  const units = value.purchase_units;
  if (
    units?.length !== 1 ||
    units[0]?.amount?.currency_code !== "USD" ||
    units[0]?.amount?.value !== "500.00"
  )
    throw new SandboxPaymentError("PAYPAL_AMOUNT_MISMATCH", "unknown");
  const captures = units[0].payments?.captures ?? [];
  if (captures.length > 1)
    throw new SandboxPaymentError("PAYPAL_CAPTURE_MISMATCH", "unknown");
  const captured = captures[0];
  if (
    captured &&
    (captured.amount.currency_code !== "USD" ||
      captured.amount.value !== "500.00")
  )
    throw new SandboxPaymentError("PAYPAL_AMOUNT_MISMATCH", "unknown");
  return captured;
}

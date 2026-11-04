import { z } from "zod";
export const Id = z.uuid();
export const RequestKey = z.uuid();
export const TenantKind = z.enum(["requester", "provider"]);
export const TenantRole = z.enum(["principal", "member"]);
export const ErrorCode = z.enum([
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "CHALLENGE_INVALID",
  "MAIL_UNAVAILABLE",
  "NOT_IMPLEMENTED",
  "INTERNAL_ERROR",
  "NOT_READY",
]);
export const ApiError = z.strictObject({
  error: z.strictObject({
    code: ErrorCode,
    message: z.string(),
    requestId: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;
export const Health = z.strictObject({
  status: z.enum(["ok", "ready"]),
  service: z.literal("ally-ahead-api"),
});

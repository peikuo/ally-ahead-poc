export interface ReceptionPaymentConfig {
  clientId: string;
  secret: string;
}
// Optional deployment reader, called by the unified config owner. No live option.
export function loadReceptionPaymentConfig(
  env: NodeJS.ProcessEnv = process.env,
): ReceptionPaymentConfig | undefined {
  const id = env.PAYPAL_CLIENT_ID?.trim(),
    secret = env.PAYPAL_CLIENT_SECRET?.trim();
  if (!id && !secret) return undefined;
  if (!id || !secret || /REPLACE_WITH|FILL_/i.test(id + secret))
    throw Error("PAYPAL_CONFIG_INVALID");
  return { clientId: id, secret };
}

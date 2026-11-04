import { useEffect, useRef, useState } from 'react';
import { loadPayPalSandbox } from './paypal-sdk';
import type { PayPalButtons } from './paypal-sdk';

export interface PayPalSandboxButtonProps {
  /** Public Sandbox client ID only. Never pass a secret or access token. */
  clientId?: string;
  /** Must match the server-validated order currency. No business default. */
  currency: string;
  /** Mount only after the parent has confirmed the exact payment terms. */
  enabled: boolean;
  language?: 'zh' | 'en';
  /** Server creates and binds the order to the confirmed requirement/terms. */
  createOrder(): Promise<string>;
  /** Server captures/reconciles the order. Approval alone is not payment success. */
  onApprove(orderId: string): Promise<void>;
  onCancel?(): void;
  onError?(error: unknown): void;
}

export function PayPalSandboxButton(props: PayPalSandboxButtonProps) {
  const { clientId, currency, enabled, language = 'zh' } = props;
  const container = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  // Callback identity changes must not recreate the SDK iframe during checkout.
  useEffect(() => { latest.current = props; });
  useEffect(() => {
    if (!clientId || !enabled) return;
    let disposed = false;
    let buttons: PayPalButtons | undefined;
    const close = () => { void buttons?.close().catch(() => {}); };
    const fail = (error: unknown) => {
      if (disposed) return;
      setStatus('error');
      latest.current.onError?.(error);
    };
    setStatus('loading');
    void loadPayPalSandbox(clientId, currency).then(async sdk => {
      if (disposed || !container.current) return;
      buttons = sdk.Buttons({
        fundingSource: 'paypal',
        createOrder: async () => {
          if (disposed || !latest.current.enabled) throw new Error('PAYPAL_CHECKOUT_DISABLED');
          const orderId = await latest.current.createOrder();
          if (disposed || !latest.current.enabled) throw new Error('PAYPAL_CHECKOUT_DISABLED');
          if (!orderId.trim()) throw new Error('PAYPAL_ORDER_INVALID');
          return orderId;
        },
        onApprove: async ({ orderID }) => {
          if (disposed) throw new Error('PAYPAL_CHECKOUT_CLOSED');
          await latest.current.onApprove(orderID);
        },
        onCancel: () => { if (!disposed) latest.current.onCancel?.(); },
        onError: fail,
      });
      if (!buttons.isEligible()) throw new Error('PAYPAL_NOT_ELIGIBLE');
      await buttons.render(container.current);
      if (disposed) { close(); return; }
      setStatus('ready');
    }).catch(fail);
    return () => { disposed = true; close(); };
  }, [clientId, currency, enabled]);

  const zh = language === 'zh';
  return <section aria-label={zh ? 'PayPal 沙盒付款' : 'PayPal sandbox checkout'}>
    <p>{zh ? 'Sandbox 测试，不涉及真实资金。' : 'Sandbox test. No real money moves.'}</p>
    {!clientId ? <p role="status">{zh ? 'PayPal 测试凭据待配置。' : 'PayPal test credentials are not configured.'}</p>
      : !enabled ? <p role="status">{zh ? '请先确认付款金额和退款条件。' : 'Confirm the amount and refund terms first.'}</p>
      : status === 'error' ? <p role="alert">{zh ? '付款组件暂不可用；付款状态须向服务端核对。' : 'Checkout is unavailable. Verify payment status with the server.'}</p>
      : status === 'loading' ? <p role="status">{zh ? '正在加载 PayPal…' : 'Loading PayPal…'}</p> : null}
    <div ref={container} hidden={!clientId || !enabled || status === 'error'} />
  </section>;
}

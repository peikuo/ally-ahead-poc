// PayPal JS SDK v5, loaded from PayPal only when the checkout is mounted.
export interface PayPalButtons {
  render(container: HTMLElement): Promise<void>;
  close(): Promise<void>;
  isEligible(): boolean;
}

export interface PayPalSdk {
  Buttons(options: {
    fundingSource: 'paypal';
    createOrder(): Promise<string>;
    onApprove(data: { orderID: string }): Promise<void>;
    onCancel(): void;
    onError(error: unknown): void;
  }): PayPalButtons;
}

let pending: { key: string; promise: Promise<PayPalSdk> } | undefined;

export function loadPayPalSandbox(clientId: string, currency: string): Promise<PayPalSdk> {
  if (!clientId.trim() || !/^[A-Z]{3}$/.test(currency)) {
    return Promise.reject(new Error('PAYPAL_CONFIG_INVALID'));
  }
  const key = JSON.stringify([clientId, currency]);
  if (pending) {
    return pending.key === key ? pending.promise : Promise.reject(new Error('PAYPAL_SDK_CONFIG_CONFLICT'));
  }
  const promise = new Promise<PayPalSdk>((resolve, reject) => {
    const script = document.createElement('script');
    const params = new URLSearchParams({
      'client-id': clientId, currency, components: 'buttons', intent: 'capture',
      'enable-funding': 'paypal',
    });
    script.src = `https://www.paypal.com/sdk/js?${params}`;
    script.async = true;
    script.setAttribute('data-namespace', 'allyPayPalSandbox');
    const fail = () => {
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      script.remove();
      pending = undefined;
      reject(new Error('PAYPAL_SDK_UNAVAILABLE'));
    };
    const timer = setTimeout(fail, 20000);
    script.onerror = fail;
    script.onload = () => {
      const sdk = (window as unknown as { allyPayPalSandbox?: PayPalSdk }).allyPayPalSandbox;
      if (!sdk?.Buttons) { fail(); return; }
      clearTimeout(timer);
      resolve(sdk);
    };
    document.head.append(script);
  });
  pending = { key, promise };
  return promise;
}

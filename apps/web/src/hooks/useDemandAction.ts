import { useEffect, useRef, useState } from "react";
import { isAborted } from "../api/client";

// Each route scope owns its mutations. Leaving it cannot redirect or update a later page.
export function useDemandAction() {
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  async function run<T>(
    action: (signal: AbortSignal) => Promise<T>,
    done: (value: T) => void,
  ) {
    if (controller.current) return;
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setError(null);
    try {
      const result = await action(current.signal);
      if (mounted.current && !current.signal.aborted) done(result);
    } catch (error) {
      if (mounted.current && !current.signal.aborted && !isAborted(error))
        setError(error);
    } finally {
      if (controller.current === current) controller.current = null;
      if (mounted.current && !current.signal.aborted) setBusy(false);
    }
  }
  function cancel() {
    const current = controller.current;
    controller.current = null;
    current?.abort();
    if (mounted.current) {
      setBusy(false);
      setError(null);
    }
  }
  return { busy, error, run, cancel };
}

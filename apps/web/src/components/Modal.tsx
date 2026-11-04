import { useEffect, useRef, type ReactNode } from "react";
import { useLocale } from "../locales/context";
export function Modal({
  title,
  children,
  onClose,
  busy = false,
  className,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useLocale();
  useEffect(() => {
    const node = ref.current;
    const previous = document.activeElement;
    node?.showModal();
    return () => {
      node?.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={className}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <button
        className="modal-close"
        type="button"
        disabled={busy}
        onClick={onClose}
        aria-label={t("关闭", "Close")}
      >
        ×
      </button>
      <h2>{title}</h2>
      {children}
    </dialog>
  );
}

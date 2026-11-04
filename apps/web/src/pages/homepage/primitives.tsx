import { Fragment, type ReactNode } from "react";

export function Lines({ text }: { text: string }) {
  return text.split(/<br\s*\/?\s*>/i).map((line, index) => (
    <Fragment key={index}>
      {index > 0 ? <br /> : null}
      {line}
    </Fragment>
  ));
}

export function Wordmark({ src, onHome }: { src: string; onHome: () => void }) {
  return (
    <a
      className="wordmark"
      href="#home"
      aria-label="Ally Ahead"
      onClick={(event) => {
        event.preventDefault();
        onHome();
      }}
    >
      <span className="brand-art">
        <img src={src} alt="Ally Ahead" width="2172" height="724" />
      </span>
    </a>
  );
}

export function Action({
  children,
  onClick,
  className = "cta",
}: {
  children: ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button type="button" className={className} onClick={onClick}>
      <span>{children}</span>
      <span
        className={className === "cta" ? "arrow" : undefined}
        aria-hidden="true"
      >
        ↗
      </span>
    </button>
  );
}

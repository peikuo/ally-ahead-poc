import { useEffect, useLayoutEffect, useRef, useState } from "react";

export function ReceptionTypingText({
  text,
  animate = true,
  onTypingChange,
}: {
  text: string;
  animate?: boolean;
  onTypingChange?: (typing: boolean) => void;
}) {
  // Existing content is immediately readable on mount, including after refresh.
  const [shown, setShown] = useState({ target: text, value: text });
  if (shown.target !== text) {
    setShown({
      target: text,
      value: text.startsWith(shown.value) ? shown.value : "",
    });
  }
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let previous = performance.now();
    const letters = Array.from(text);
    let length = Array.from(shown.value).length;
    const finish = () => setShown({ target: text, value: text });
    const preferenceChanged = () => {
      if (preference.matches) {
        cancelAnimationFrame(frame);
        finish();
      }
    };
    preference.addEventListener("change", preferenceChanged);
    if (preference.matches || !animate) finish();
    else if (shown.value !== text) {
      const step = (now: number) => {
        if (now - previous >= 22) {
          const count = Math.max(1, Math.floor((now - previous) / 22));
          previous = now;
          length = Math.min(letters.length, length + count);
          setShown({ target: text, value: letters.slice(0, length).join("") });
        }
        if (length < letters.length) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    }
    return () => {
      cancelAnimationFrame(frame);
      preference.removeEventListener("change", preferenceChanged);
    };
  }, [text, animate]);
  const typing = shown.target === text && shown.value !== text;
  useEffect(() => {
    onTypingChange?.(typing && animate);
    return () => onTypingChange?.(false);
  }, [typing, animate, onTypingChange]);
  const viewport = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const node = viewport.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [shown.value, text]);
  return (
    <span className="reception-typing-text" data-typing={typing}>
      <span className="reception-sr-only">{text}</span>
      <span className="reception-typing-reserve" aria-hidden="true">
        {text}
      </span>
      <span
        ref={viewport}
        className="reception-typing-visible"
        aria-hidden="true"
      >
        {shown.target === text ? shown.value : ""}
        {typing ? <span className="reception-typing-caret" /> : null}
      </span>
    </span>
  );
}

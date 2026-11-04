import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { scenes, type HomepageAssets } from "./model";

function indexFromHash() {
  if (typeof window === "undefined") return 0;
  const index = scenes.findIndex(
    (scene) => "#" + scene.id === window.location.hash,
  );
  return index < 0 ? 0 : index;
}

export function useExperience(
  assets: HomepageAssets,
  blocked: boolean,
  onSceneChange: () => void,
  onLeave: () => void,
) {
  const [activeIndex, setActiveIndex] = useState(indexFromHash);
  const [visited, setVisited] = useState(() => new Set([indexFromHash()]));
  const [loading, setLoading] = useState(false);
  const [imageError, setImageError] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const promises = useRef(new Map<string, Promise<void>>());
  const requestId = useRef(0);
  const transitionUntil = useRef(0);
  const pending = useRef(false);
  const latest = useRef({ activeIndex, blocked, onSceneChange, onLeave });
  useLayoutEffect(() => {
    latest.current = { activeIndex, blocked, onSceneChange, onLeave };
  }, [activeIndex, blocked, onSceneChange, onLeave]);
  useEffect(
    () => () => {
      requestId.current += 1;
    },
    [],
  );

  const reducedMotion = useCallback(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  const ensureImage = useCallback(
    (index: number) => {
      const scene = scenes[index];
      if (!Number.isInteger(index) || !scene) return Promise.reject(new RangeError('Invalid scene index'));
      const url = assets[scene.asset];
      let promise = promises.current.get(url);
      if (!promise) {
        promise = new Promise<void>((resolve, reject) => {
          const image = new Image();
          image.decoding = "async";
          image.fetchPriority = "low";
          image.onload = () => {
            image
              .decode()
              .catch(() => {})
              .then(resolve);
          };
          image.onerror = () => {
            promises.current.delete(url);
            reject(new Error("Scene image unavailable"));
          };
          image.src = url;
        });
        promises.current.set(url, promise);
      }
      return promise;
    },
    [assets],
  );

  const goTo = useCallback(
    async (index: number, syncHash = true) => {
      const scene = scenes[index];
      if (!Number.isInteger(index) || !scene) return;
      const token = ++requestId.current;
      setImageError(false);
      if (index === latest.current.activeIndex) {
        pending.current = false;
        setLoading(false);
      }
      if (index !== latest.current.activeIndex) {
        pending.current = true;
        setLoading(true);
        try {
          await ensureImage(index);
          if (token !== requestId.current) return;
          latest.current.onSceneChange();
          setVisited((previous) => new Set(previous).add(index));
          setActiveIndex(index);
          transitionUntil.current =
            performance.now() + (reducedMotion() ? 220 : 700);
        } catch {
          if (token === requestId.current) setImageError(true);
          return;
        } finally {
          if (token === requestId.current) {
            pending.current = false;
            setLoading(false);
          }
        }
      }
      if (token === requestId.current && syncHash)
        window.history.replaceState(null, "", "#" + scene.id);
    },
    [ensureImage, reducedMotion],
  );

  const scrollToStage = useCallback(() => {
    const stage = stageRef.current;
    if (stage)
      window.scrollTo({
        top: window.scrollY + stage.getBoundingClientRect().top,
        behavior: reducedMotion() ? "instant" : "smooth",
      });
  }, [reducedMotion]);

  const leave = useCallback(() => {
    latest.current.onSceneChange();
    latest.current.onLeave();
    document.getElementById("starting")?.scrollIntoView({
      behavior: reducedMotion() ? "instant" : "smooth",
      block: "start",
    });
    window.history.replaceState(null, "", "#starting");
  }, [reducedMotion]);

  const advance = useCallback(
    (direction: number) => {
      if (pending.current || performance.now() < transitionUntil.current)
        return;
      const index = latest.current.activeIndex;
      if (direction > 0 && index === scenes.length - 1) leave();
      else void goTo(index + direction);
    },
    [goTo, leave],
  );

  useEffect(() => {
    const next = activeIndex + 1;
    if (next >= scenes.length) return;
    const timer = window.setTimeout(() => {
      void ensureImage(next).catch(() => {});
    }, 350);
    return () => window.clearTimeout(timer);
  }, [activeIndex, ensureImage]);

  useEffect(() => {
    let lastWheel = -Infinity;
    let distance = 0;
    let consumed = false;
    let touch: { x: number; y: number } | null = null;
    const stage = stageRef.current;
    if (!stage) return;
    const inView = () => {
      const rect = stage.getBoundingClientRect();
      return Math.abs(rect.top) < 4 && rect.bottom >= window.innerHeight - 100;
    };
    const available = (target: EventTarget | null) =>
      !latest.current.blocked &&
      !document.querySelector("dialog[open]") &&
      target instanceof Element &&
      !target.closest(
        "textarea,input,select,[contenteditable=true],.description",
      );
    const wheel = (event: WheelEvent) => {
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        !inView() ||
        !available(event.target) ||
        Math.abs(event.deltaX) > Math.abs(event.deltaY) ||
        !event.deltaY
      )
        return;
      event.preventDefault();
      const now = performance.now();
      if (now - lastWheel > 180) {
        consumed = false;
        distance = 0;
      }
      lastWheel = now;
      if (consumed || pending.current || now < transitionUntil.current) return;
      const factor =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? window.innerHeight
            : 1;
      if (distance && Math.sign(distance) !== Math.sign(event.deltaY))
        distance = 0;
      distance += event.deltaY * factor;
      if (Math.abs(distance) < 35) return;
      consumed = true;
      advance(distance > 0 ? 1 : -1);
    };
    const key = (event: KeyboardEvent) => {
      if (
        !inView() ||
        !available(event.target) ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return;
      if (
        !["ArrowDown", "PageDown", "ArrowUp", "PageUp", "Home", "End"].includes(
          event.key,
        )
      )
        return;
      event.preventDefault();
      if (event.key === "Home") void goTo(0);
      else if (event.key === "End") void goTo(scenes.length - 1);
      else advance(["ArrowDown", "PageDown"].includes(event.key) ? 1 : -1);
    };
    const touchStart = (event: TouchEvent) => {
      if (
        event.touches.length !== 1 ||
        !available(event.target) ||
        (event.target as Element).closest("button,a")
      ) {
        touch = null;
        return;
      }
      const point = event.touches.item(0);
      touch = point ? { x: point.clientX, y: point.clientY } : null;
    };
    const touchEnd = (event: TouchEvent) => {
      const point = event.changedTouches.item(0);
      if (!touch || !point) return;
      const dx = point.clientX - touch.x;
      const dy = point.clientY - touch.y;
      touch = null;
      if (Math.abs(dy) > 55 && Math.abs(dy) > Math.abs(dx) * 1.3)
        advance(dy < 0 ? 1 : -1);
    };
    const cancelTouch = () => {
      touch = null;
    };
    const hash = () => {
      const index = scenes.findIndex(
        (scene) => "#" + scene.id === window.location.hash,
      );
      if (index >= 0) {
        void goTo(index, false);
        scrollToStage();
      }
    };
    window.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", key);
    window.addEventListener("hashchange", hash);
    stage.addEventListener("touchstart", touchStart, { passive: true });
    stage.addEventListener("touchend", touchEnd, { passive: true });
    stage.addEventListener("touchcancel", cancelTouch, { passive: true });
    return () => {
      window.removeEventListener("wheel", wheel);
      window.removeEventListener("keydown", key);
      window.removeEventListener("hashchange", hash);
      stage.removeEventListener("touchstart", touchStart);
      stage.removeEventListener("touchend", touchEnd);
      stage.removeEventListener("touchcancel", cancelTouch);
    };
  }, [advance, goTo, scrollToStage]);

  return {
    activeIndex,
    visited,
    loading,
    imageError,
    stageRef,
    goTo,
    advance,
    scrollToStage,
    leave,
  };
}

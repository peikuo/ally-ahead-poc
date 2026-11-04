import { useEffect, useRef, type RefObject } from "react";
import type { Copy, Locale } from "./content";
import {
  scenes,
  sceneAt,
  type HomepageAssets,
  type SceneId,
  type StartContext,
} from "./model";
import { Action, Lines } from "./primitives";

type Expansion = { id: SceneId; pinned: boolean } | null;
interface ExperienceProps {
  t: Copy;
  locale: Locale;
  assets: HomepageAssets;
  activeIndex: number;
  visited: Set<number>;
  loading: boolean;
  imageError: boolean;
  stageRef: RefObject<HTMLDivElement | null>;
  expanded: Expansion;
  onExpand: (value: Expansion) => void;
  onNavigate: (index: number) => void;
  onAdvance: (direction: number) => void;
  onStart: (context: StartContext) => void;
}

function SceneHeading({
  id,
  title,
  detail,
  active,
  expanded,
  onExpand,
}: {
  id: SceneId;
  title: string;
  detail: string;
  active: boolean;
  expanded: Expansion;
  onExpand: (value: Expansion) => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!active && timer.current) clearTimeout(timer.current);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [active]);
  const open = expanded?.id === id;
  const pinned = open && expanded.pinned;
  const Heading = id === "home" ? "h1" : "h2";
  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
  };
  return (
    <div
      className="explain"
      data-explain-id={id}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse" && !pinned) {
          clearTimer();
          timer.current = setTimeout(
            () => onExpand({ id, pinned: false }),
            200,
          );
        }
      }}
      onPointerLeave={(event) => {
        clearTimer();
        if (!pinned && !event.currentTarget.contains(document.activeElement))
          onExpand(null);
      }}
      onBlur={(event) => {
        if (!pinned && !event.currentTarget.contains(event.relatedTarget))
          onExpand(null);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          clearTimer();
          onExpand(null);
          event.stopPropagation();
        }
      }}
    >
      <Heading id={`title-${id}`}>
        <button
          type="button"
          className="headline"
          aria-expanded={open}
          aria-controls={`detail-${id}`}
          onFocus={() => {
            if (!pinned && matchMedia("(hover:hover)").matches)
              onExpand({ id, pinned: false });
          }}
          onClick={() => {
            clearTimer();
            onExpand(pinned ? null : { id, pinned: true });
          }}
        >
          <Lines text={title} />
        </button>
      </Heading>
      <p id={`detail-${id}`} className="description" hidden={!open}>
        {detail}
      </p>
    </div>
  );
}

export function SceneExperience({
  t,
  locale,
  assets,
  activeIndex,
  visited,
  loading,
  imageError,
  stageRef,
  expanded,
  onExpand,
  onNavigate,
  onAdvance,
  onStart,
}: ExperienceProps) {
  const last = activeIndex === scenes.length - 1;
  return (
    <div
      ref={stageRef}
      id="road"
      className="experience"
      role="region"
      aria-label={t.sceneRegion}
      aria-busy={loading}
      data-active-scene={activeIndex}
    >
      {scenes.map((scene, index) => {
        const active = index === activeIndex;
        const cta = "cta" in scene ? scene.cta : null;
        return (
          <section
            key={scene.id}
            id={scene.id}
            className={`scene ${scene.className}${active ? " is-active" : ""}`}
            aria-labelledby={`title-${scene.id}`}
            aria-hidden={!active}
            inert={!active}
          >
            <div
              className="visual"
              aria-hidden="true"
              style={
                visited.has(index)
                  ? { backgroundImage: `url("${assets[scene.asset]}")` }
                  : undefined
              }
            />
            <div className="scene-content">
              <SceneHeading
                id={scene.id}
                title={t[scene.heading]}
                detail={t[scene.detail]}
                active={active}
                expanded={active ? expanded : null}
                onExpand={onExpand}
              />
              {cta ? (
                <Action onClick={() => onStart({ source: scene.id, locale })}>
                  {t[cta]}
                </Action>
              ) : null}
            </div>
          </section>
        );
      })}
      <nav className="experience-dots" aria-label={t.sceneNavigation}>
        {scenes.map((scene, index) => (
          <button
            type="button"
            key={scene.id}
            data-scene={index}
            aria-label={t[scene.label]}
            aria-current={index === activeIndex ? "step" : undefined}
            disabled={loading}
            onClick={() => onNavigate(index)}
          >
            <span>{t[scene.label]}</span>
          </button>
        ))}
      </nav>
      <div className="experience-controls">
        <div className="experience-status">
          <span className="experience-count">
            {String(activeIndex + 1).padStart(2, "0")} /{" "}
            {String(scenes.length).padStart(2, "0")}
          </span>
          <span className="experience-name">
            {t[sceneAt(activeIndex).label]}
          </span>
        </div>
        <div className="experience-actions">
          <span className="experience-hint">{t.scrollScenes}</span>
          <button
            type="button"
            className="previous-scene"
            disabled={activeIndex === 0 || loading}
            aria-label={t.previousScene}
            onClick={() => onAdvance(-1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="next-scene"
            disabled={loading}
            aria-label={last ? t.exploreBusiness : t.nextScene}
            onClick={() => onAdvance(1)}
          >
            <span className="experience-next-label">
              {last ? t.exploreBusiness : t.nextScene}
            </span>
            <span className="experience-next-arrow" aria-hidden="true">
              ↓
            </span>
          </button>
        </div>
      </div>
      <div className="experience-announcer" aria-live="polite">
        {imageError
          ? t.imageLoadHint
          : `${activeIndex + 1} / ${scenes.length} · ${t[sceneAt(activeIndex).label]}`}
      </div>
      {imageError ? (
        <p className="scene-load-error" role="alert">
          {t.imageLoadError}
        </p>
      ) : null}
    </div>
  );
}

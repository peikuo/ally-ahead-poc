import { useEffect, useRef, useState } from "react";
import listening from "../../assets/reception/listening.webp";
import body from "../../assets/reception/typing-body.webp";
import left from "../../assets/reception/forearm-left.webp";
import right from "../../assets/reception/forearm-right.webp";
import laptop from "../../assets/reception/laptop-front.webp";
import small from "../../assets/reception/mouth-small.webp";
import open from "../../assets/reception/mouth-open.webp";
import okForearm from "../../assets/reception/ok-forearm-v1.png";

export type Motion =
  "welcome" | "listening" | "thinking" | "typing" | "speaking" | "ready";

// Reuse the approved illustration at a fixed scale. Only the upper portrait,
// eyelids, mouth and forearms move; the computer and scene remain anchored.
export function ReceptionCharacter({
  mode,
  label,
  acknowledgement,
  onAcknowledgementHandled,
}: {
  mode: Motion;
  label: string;
  acknowledgement?: string | null;
  onAcknowledgementHandled?: (id: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef({ mode, since: 0 });
  const wakeAnimation = useRef<(() => void) | null>(null);
  const [ready, setReady] = useState(false);
  const [gesturing, setGesturing] = useState(false);
  const acknowledge = useRef<(() => void) | null>(null);
  const lastAcknowledgement = useRef<string | null>(null);

  useEffect(() => {
    current.current = { mode, since: performance.now() };
    wakeAnimation.current?.();
  }, [mode]);

  useEffect(() => {
    let disposed = false;
    let frame = 0;
    let loaded = false;
    let lastFrame = 0;
    let angle = 0;
    let lift = 0;
    let workBlend = 0;
    let leftTap = 0;
    let rightTap = 0;
    let mouthBlend = 0;
    const sceneSince = performance.now();
    let nextBlink = sceneSince + 1800 + Math.random() * 1600;
    let blinkSince = -Infinity;
    let gestureSince: number | null = null;
    let showingGesture = false;
    const preferences = matchMedia("(prefers-reduced-motion: reduce)");
    const images: Record<string, HTMLImageElement> = {};
    const urls = { listening, body, left, right, laptop, small, open };
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const context = ctx;
    const portrait = document.createElement("canvas");
    portrait.width = portrait.height = 654;
    const blend = portrait.getContext("2d")!;
    const eyeBackgrounds: Record<string, { top: string; bottom: string }[]> =
      {};

    function arm(
      image: HTMLImageElement,
      x: number,
      y: number,
      px: number,
      py: number,
      rotation: number,
      rise: number,
    ) {
      context.save();
      context.translate(px, py - rise);
      context.rotate(rotation);
      context.drawImage(image, x - px, y - py);
      context.restore();
    }
    function nod(time: number, duration: number) {
      return time < duration
        ? Math.sin((Math.max(0, time) / duration) * Math.PI) ** 2
        : 0;
    }
    function blink(
      image: CanvasImageSource,
      working: boolean,
      closure: number,
    ) {
      if (closure <= 0) return;
      const y = working ? 206 : 192;
      const colors = eyeBackgrounds[working ? "body" : "listening"]!;
      for (const [index, x] of [287, 355].entries()) {
        context.save();
        context.beginPath();
        context.ellipse(x, y, 22, 10, 0, 0, Math.PI * 2);
        context.clip();
        const skin = context.createLinearGradient(x, y - 10, x, y + 10);
        skin.addColorStop(0, colors[index]!.top);
        skin.addColorStop(1, colors[index]!.bottom);
        context.fillStyle = skin;
        context.fillRect(x - 22, y - 10, 44, 20);
        const height = Math.max(0.5, 20 * (1 - closure));
        context.drawImage(
          image,
          x - 22,
          y - 10,
          44,
          20,
          x - 22,
          y - height / 2,
          44,
          height,
        );
        if (closure > 0.85) {
          context.strokeStyle = "#493328";
          context.lineWidth = 1.5;
          context.beginPath();
          context.moveTo(x - 15, y);
          context.quadraticCurveTo(x, y + 4, x + 15, y);
          context.stroke();
        }
        context.restore();
      }
    }
    function draw(now: number) {
      if (disposed || !loaded) return;
      const state = current.current;
      const elapsed = Math.max(0, (now - state.since) / 1000);
      const still = preferences.matches || document.hidden;
      if (still) gestureSince = null;
      const gestureElapsed =
        gestureSince === null ? 0 : (now - gestureSince) / 1000;
      const gesture =
        gestureSince !== null && Boolean(images.ok) && gestureElapsed < 2.6;
      if (gesture !== showingGesture) {
        showingGesture = gesture;
        setGesturing(gesture);
      }
      if (!gesture && images.ok) gestureSince = null;
      // Processing includes short pauses to look back up, rather than a loop
      // of continuous keystrokes. Blend the two approved poses at transitions.
      const working =
        !gesture &&
        (state.mode === "typing" ||
          (state.mode === "thinking" &&
            elapsed % 10 > 2.3 &&
            elapsed % 10 < 8.9));
      const delta = Math.min(Math.max((now - lastFrame) / 1000, 0), 0.1);
      const ease = (speed: number) =>
        still ? 1 : 1 - Math.exp(-delta * speed);
      workBlend += ((working ? 1 : 0) - workBlend) * ease(8);
      // Add premultiplied layers offscreen so the face stays opaque while
      // looking down/up; ordinary alpha-over would briefly wash it out.
      blend.globalCompositeOperation = "copy";
      blend.globalAlpha = 1 - workBlend;
      blend.drawImage(images.listening!, 0, 0);
      blend.globalCompositeOperation = "lighter";
      blend.globalAlpha = workBlend;
      blend.drawImage(images.body!, 0, 0);
      const sceneTime = (now - sceneSince) / 1000;
      const breathing = Math.sin((sceneTime * Math.PI * 2) / 4.8);
      let targetAngle = 0;
      let targetLift = 0;
      if (!still) {
        targetLift = breathing * 0.65;
        if (state.mode === "welcome") {
          targetAngle = -0.009 * nod(elapsed, 1.8);
          targetLift += 3 * nod(elapsed, 1.8);
        } else if (state.mode === "listening") {
          targetAngle = 0.006 * Math.sin(elapsed * 0.65);
          targetLift += 2.4 * nod((elapsed + 1.9) % 8.7, 1.15);
        } else if (state.mode === "thinking" && !working) {
          targetAngle = 0.016 * Math.min(elapsed / 1.2, 1);
          targetLift += 1;
        } else if (state.mode === "speaking") {
          targetAngle = 0.005 * Math.sin(elapsed * 1.25);
          targetLift += 1.5 * nod(elapsed % 4.3, 1.1);
        } else if (state.mode === "ready") {
          targetLift += 3.5 * nod(elapsed, 1.4);
        }
      }
      const easing = ease(9);
      angle += (targetAngle - angle) * easing;
      lift += (targetLift - lift) * easing;
      lastFrame = now;
      context.clearRect(0, 0, 654, 654);
      if (workBlend > 0.001) {
        const phrase = elapsed % 6.8;
        const burst = Math.max(
          nod(phrase - 0.25, 1.8),
          nod(phrase - 2.45, 1.6),
          nod(phrase - 4.65, 1.2),
        );
        const rhythm =
          sceneTime * Math.PI * 2 * 3.4 + Math.sin(sceneTime * 1.7) * 0.5;
        const a = !still ? ((Math.sin(rhythm) + 1) / 2) * burst : 0;
        const b = !still
          ? ((Math.sin(rhythm * 0.93 + 2.6) + 1) / 2) * burst
          : 0;
        leftTap += (a - leftTap) * ease(24);
        rightTap += (b - rightTap) * ease(24);
        context.save();
        context.globalAlpha = workBlend;
        arm(images.left!, 45, 480, 91, 541, -leftTap * 0.055, leftTap * 5);
        arm(images.right!, 475, 480, 573, 545, rightTap * 0.055, rightTap * 5);
        context.restore();
      }
      if (now >= nextBlink) {
        blinkSince = now;
        nextBlink = now + 3300 + Math.random() * 2900;
      }
      const blinkTime = (now - blinkSince) / 1000;
      const closure = still
        ? 0
        : blinkTime < 0.07
          ? blinkTime / 0.07
          : blinkTime < 0.1
            ? 1
            : blinkTime < 0.23
              ? 1 - (blinkTime - 0.1) / 0.13
              : 0;
      const speaking = state.mode === "speaking" && !still;
      const syllable =
        Math.floor((elapsed + Math.sin(elapsed * 1.3) * 0.06) * 9) % 11;
      const shape =
        speaking && elapsed % 3.1 < 2.55
          ? [0, 1, 2, 1, 0, 1, 2, 0, 1, 1, 0][syllable]!
          : 0;
      mouthBlend += ((shape ? 1 : 0) - mouthBlend) * ease(32);
      // The seam falls behind the laptop. The lower illustration never moves.
      context.drawImage(portrait, 0, 434, 654, 220, 0, 434, 654, 220);
      context.save();
      context.beginPath();
      context.rect(0, 0, 654, 434);
      context.clip();
      context.translate(326, 430 + lift);
      context.rotate(angle);
      context.translate(-326, -430);
      context.drawImage(portrait, 0, 0);
      blink(portrait, workBlend > 0.5, closure);
      if (mouthBlend > 0.01) {
        context.globalAlpha = (1 - workBlend) * mouthBlend;
        context.drawImage(shape === 2 ? images.open! : images.small!, 293, 231);
      }
      context.restore();
      if (gesture) {
        const smooth = (value: number) => {
          const p = Math.max(0, Math.min(1, value));
          return p * p * (3 - 2 * p);
        };
        const raised =
          gestureElapsed < 0.65
            ? smooth(gestureElapsed / 0.65)
            : gestureElapsed < 1.85
              ? 1
              : 1 - smooth((gestureElapsed - 1.85) / 0.75);
        context.save();
        // Keep the fixed desk and computer in front of the moving forearm.
        context.beginPath();
        context.rect(0, 0, 654, 565);
        context.clip();
        context.globalAlpha = Math.min(1, raised * 5);
        context.translate((1 - raised) * 70, (1 - raised) * 260);
        const tilt = raised * Math.sin(gestureElapsed * 2.4) * 0.008;
        context.translate(102, 535);
        context.rotate(tilt);
        context.drawImage(
          images.ok!,
          -490 * 0.4,
          -1080 * 0.4,
          1254 * 0.4,
          1254 * 0.4,
        );
        context.restore();
      }
      // The old laptop crop includes a few surrounding resting-hand pixels.
      // Clip to the computer itself so they cannot create an extra hand.
      context.save();
      context.beginPath();
      context.moveTo(154, 434);
      context.lineTo(497, 434);
      context.quadraticCurveTo(506, 434, 505, 445);
      context.lineTo(491, 594);
      context.quadraticCurveTo(490, 606, 480, 606);
      context.lineTo(173, 606);
      context.quadraticCurveTo(162, 606, 161, 594);
      context.lineTo(146, 445);
      context.quadraticCurveTo(145, 434, 154, 434);
      context.closePath();
      context.clip();
      context.drawImage(images.laptop!, 146, 434);
      context.restore();
      if (!still) frame = requestAnimationFrame(draw);
    }
    function wake() {
      cancelAnimationFrame(frame);
      lastFrame = performance.now();
      draw(lastFrame);
    }
    wakeAnimation.current = wake;
    acknowledge.current = () => {
      if (preferences.matches || document.hidden) return;
      gestureSince = performance.now();
      wake();
    };
    // Optional gesture art must not block the existing character animations.
    const ok = new Image();
    ok.src = okForearm;
    void ok
      .decode()
      .then(() => {
        if (disposed) return;
        images.ok = ok;
        if (gestureSince !== null) gestureSince = performance.now();
        wake();
      })
      .catch(() => {
        gestureSince = null;
      });
    void Promise.all(
      Object.entries(urls).map(async ([name, url]) => {
        const image = new Image();
        image.src = url;
        await image.decode();
        images[name] = image;
      }),
    )
      .then(() => {
        if (disposed) return;
        // Sample the existing face colors; avoid a differently colored eyelid patch.
        const palette = document.createElement("canvas");
        palette.width = palette.height = 654;
        const sample = palette.getContext("2d", { willReadFrequently: true })!;
        const color = (x: number, y: number) => {
          const pixel = sample.getImageData(x, y, 1, 1).data;
          return `rgb(${pixel[0]} ${pixel[1]} ${pixel[2]})`;
        };
        for (const key of ["listening", "body"] as const) {
          sample.clearRect(0, 0, 654, 654);
          sample.drawImage(images[key]!, 0, 0);
          const y = key === "body" ? 206 : 192;
          eyeBackgrounds[key] = [263, 379].map((x) => ({
            top: color(x, y - 7),
            bottom: color(x, y + 7),
          }));
        }
        loaded = true;
        setReady(true);
        wake();
      })
      .catch(() => {
        if (!disposed) setReady(false);
      });
    document.addEventListener("visibilitychange", wake);
    preferences.addEventListener("change", wake);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      wakeAnimation.current = null;
      acknowledge.current = null;
      // React StrictMode replays mount effects in development. The replacement
      // renderer must be allowed to receive an event before assets have loaded.
      lastAcknowledgement.current = null;
      document.removeEventListener("visibilitychange", wake);
      preferences.removeEventListener("change", wake);
    };
  }, []);

  useEffect(() => {
    if (!acknowledgement || acknowledgement === lastAcknowledgement.current)
      return;
    lastAcknowledgement.current = acknowledgement;
    acknowledge.current?.();
    // Consume the transient event so reconnect/remount cannot replay it. A new
    // scene may still receive an as-yet-unhandled event after its run loads.
    onAcknowledgementHandled?.(acknowledgement);
  }, [acknowledgement, onAcknowledgementHandled]);

  return (
    <div
      className="reception-character"
      data-testid="reception-character"
      data-motion={mode}
      data-gesture={gesturing ? "ok" : "none"}
    >
      <div className="reception-canvas">
        <img src={listening} alt={label} hidden={ready} />
        <canvas
          width={654}
          height={654}
          ref={canvas}
          hidden={!ready}
          aria-label={label}
          role="img"
        />
      </div>
    </div>
  );
}

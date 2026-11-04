import { useCallback, useEffect, useRef, useState } from "react";
import { RequestError, isAborted } from "../../api/client";
import { useLocale } from "../../locales/context";
import { receptionSpeech } from "./ReceptionMessage";
import { finalReceptionReply } from "./reception-deliveries";
import {
  chooseReplyVoice,
  isGoogleMainlandVoice,
  replyLanguage,
} from "./browserVoice";

type VoiceProps = {
  messageId?: string;
  text?: string;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onPlaying: (playing: boolean) => void;
  onAccessError: () => void;
  disabled?: boolean;
};

export function BrowserReplySpeech({
  messageId,
  text = "",
  enabled,
  onEnabledChange,
  onPlaying,
  onAccessError,
  loadReply,
  disabled = false,
}: VoiceProps & { loadReply: (signal: AbortSignal) => Promise<string> }) {
  const { t, locale } = useLocale();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [supported, setSupported] = useState(true);
  const [phase, setPhase] = useState<"idle" | "checking" | "playing">("idle");
  const [notice, setNotice] = useState(false);
  const lastSpoken = useRef<string | null>(null);
  const language = replyLanguage(receptionSpeech(text), locale);
  const voice = chooseReplyVoice(voices, language);
  const voiceId = voice?.voiceURI;

  useEffect(() => {
    if (
      !("speechSynthesis" in window) ||
      !("SpeechSynthesisUtterance" in window)
    ) {
      setSupported(false);
      setLoading(false);
      return;
    }
    const synth = window.speechSynthesis;
    const update = () => {
      const available = synth.getVoices();
      setVoices(available);
      if (available.length) setLoading(false);
    };
    update();
    synth.addEventListener("voiceschanged", update);
    const timer = setTimeout(() => setLoading(false), 3500);
    return () => {
      clearTimeout(timer);
      synth.removeEventListener("voiceschanged", update);
    };
  }, []);

  useEffect(() => {
    setPhase("idle");
    if (!enabled) {
      lastSpoken.current = null;
      return;
    }
    if (disabled || loading) return;
    const fallback = () => {
      setNotice(true);
      onEnabledChange(false);
      onPlaying(false);
    };
    if (!supported || !voiceId) {
      fallback();
      return;
    }
    if (!messageId || !text || lastSpoken.current === messageId) return;

    const controller = new AbortController();
    const synth = window.speechSynthesis;
    let speech: SpeechSynthesisUtterance | null = null;
    setPhase("checking");
    void (async () => {
      try {
        const savedText = receptionSpeech(await loadReply(controller.signal));
        controller.signal.throwIfAborted();
        if (!savedText) throw new RequestError(409, "CONFLICT");
        const currentVoice = chooseReplyVoice(
          synth.getVoices(),
          replyLanguage(savedText, locale),
        );
        if (!currentVoice) {
          fallback();
          return;
        }
        speech = new SpeechSynthesisUtterance(savedText);
        speech.voice = currentVoice;
        speech.lang = currentVoice.lang;
        speech.onstart = () => {
          if (controller.signal.aborted) return;
          setPhase("playing");
          onPlaying(true);
        };
        speech.onend = () => {
          if (controller.signal.aborted) return;
          setPhase("idle");
          onPlaying(false);
        };
        speech.onerror = () => {
          if (!controller.signal.aborted) fallback();
        };
        // Set only after the async access check, so StrictMode cleanup cannot
        // consume a reply before its surviving effect has queued the utterance.
        lastSpoken.current = messageId;
        synth.speak(speech);
      } catch (fault) {
        if (controller.signal.aborted || isAborted(fault)) return;
        fallback();
        if (
          fault instanceof RequestError &&
          [401, 403, 404, 409].includes(fault.status)
        )
          onAccessError();
      }
    })();
    return () => {
      controller.abort();
      if (speech) {
        speech.onstart = null;
        speech.onend = null;
        speech.onerror = null;
        synth.cancel();
      }
      onPlaying(false);
    };
  }, [
    enabled,
    disabled,
    loading,
    supported,
    voiceId,
    messageId,
    text,
    locale,
    loadReply,
    onEnabledChange,
    onPlaying,
    onAccessError,
  ]);

  return (
    <div className="reception-voice-control" data-testid="reply-speech">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={t("语音播报", "Voice narration")}
        className="text-link reception-voice-toggle"
        data-testid="reception-voice-toggle"
        title={
          enabled && voice
            ? `${voice.name} · ${voice.lang}`
            : t(
                "开启后自动朗读每次回复",
                "Read each reply automatically when enabled",
              )
        }
        onClick={() => {
          setNotice(false);
          onEnabledChange(!enabled);
        }}
      >
        <span className="reception-switch-track" aria-hidden="true">
          <i />
        </span>
        {t("语音", "Voice")} {enabled ? t("开", "on") : t("关", "off")}
      </button>
      {enabled && language === "zh" && voice ? (
        <span
          className="reception-voice-source"
          data-testid="reception-voice-source"
          data-voice-name={voice.name}
        >
          {isGoogleMainlandVoice(voice)
            ? t(`当前：${voice.name}`, `Current: ${voice.name}`)
            : t(
                `Google 未提供，当前回退：${voice.name}`,
                `Google is unavailable; using ${voice.name}`,
              )}
        </span>
      ) : null}
      <span
        className="reception-sr-only"
        role="status"
        data-testid="reply-speech-state"
        data-state={enabled ? phase : "off"}
      >
        {enabled
          ? phase === "playing"
            ? t("正在朗读回复", "Reading the reply")
            : t("自动语音已开启", "Automatic voice is on")
          : t("语音已关闭", "Voice is off")}
      </span>
      {notice ? (
        <p className="reception-voice-notice" role="alert">
          {t(
            "语音未能播放，已改为显示文字。可重新打开语音重试。",
            "Voice playback failed. Text is shown instead. Turn voice on to retry.",
          )}
        </p>
      ) : null}
    </div>
  );
}

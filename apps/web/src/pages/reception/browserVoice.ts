// Select only entries actually returned by getVoices. Chrome may separate the
// localized Google name with ordinary spaces, NBSPs, or full-width characters.
export function isGoogleMainlandVoice(voice: SpeechSynthesisVoice) {
  const name = voice.name.normalize("NFKC").replace(/\s+/gu, "");
  return (
    /^(zh|cmn)[-_]CN$/i.test(voice.lang.trim()) &&
    /^google(?:普通话|普通話|mandarin|chinese)/i.test(name)
  );
}

// The explicitly requested Google voice takes precedence over the existing
// female-name fallback list; SpeechSynthesis itself has no gender field.
export function chooseChineseVoice(voices: SpeechSynthesisVoice[]) {
  const google = voices.find(isGoogleMainlandVoice);
  if (google) return google;
  const candidates = voices.filter((v) => /^(zh|cmn)(-|_)/i.test(v.lang));
  const quality = (v: SpeechSynthesisVoice) =>
    /natural|premium|enhanced|neural/i.test(v.name) ? 0 : 1;
  const female = (v: SpeechSynthesisVoice) =>
    /xiaoxiao|xiaoyi|tingting|meijia|hsiaochen|hsiaoyu/i.test(v.name);
  return (
    candidates
      .filter(female)
      .sort(
        (a, b) =>
          quality(a) - quality(b) ||
          Number(!/^(zh[-_]CN|cmn[-_]CN)/i.test(a.lang)) -
            Number(!/^(zh[-_]CN|cmn[-_]CN)/i.test(b.lang)) ||
          Number(!/tingting/i.test(a.name)) - Number(!/tingting/i.test(b.name)),
      )[0] ?? null
  );
}

export function replyLanguage(text: string, locale: "zh" | "en"): "zh" | "en" {
  if (/\p{Script=Han}/u.test(text)) return "zh";
  if (/[A-Za-z]/.test(text)) return "en";
  return locale;
}
export function chooseReplyVoice(
  voices: SpeechSynthesisVoice[],
  language: "zh" | "en",
) {
  if (language === "zh") return chooseChineseVoice(voices);
  const names = ["Samantha", "Karen", "Moira", "Tessa"];
  return (
    voices
      .filter(
        (v) =>
          /^en(?:-|_)/i.test(v.lang) &&
          names.some((name) =>
            v.name.toLowerCase().includes(name.toLowerCase()),
          ),
      )
      .sort(
        (a, b) =>
          names.findIndex((name) =>
            a.name.toLowerCase().includes(name.toLowerCase()),
          ) -
          names.findIndex((name) =>
            b.name.toLowerCase().includes(name.toLowerCase()),
          ),
      )[0] ?? null
  );
}

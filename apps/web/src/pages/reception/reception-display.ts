import {
  decodeReceptionPresentation,
  isReceptionPresentationText,
  type ReceptionInteraction,
} from "@ally-ahead/contracts";
import { markdownToSpeech } from "./markdown";

export function receptionSpeechText(text: string): string {
  const parsed = decodeReceptionPresentation(text);
  const body =
    parsed?.speech ?? (isReceptionPresentationText(text) ? "" : text);
  return markdownToSpeech(body).replace(/\s+/gu, " ").trim();
}

export function receptionContentLabel(
  interaction: ReceptionInteraction | null | undefined,
  t: (zh: string, en: string) => string,
): string {
  switch (interaction?.type) {
    case "direction_comparison":
      return t("已比较", "Approaches compared");
    case "sample_request":
      return t("需要一条脱敏样例", "An anonymized example would help");
    case "sample_result":
      return t("小样已整理", "Example prepared");
    case "demand_review":
      return t("请核对这份理解", "Check our understanding");
    case "requirements_document":
      return t("完整文档已整理", "Document prepared");
    case "requirements_document_offer":
      return t("也可以继续交流", "We can keep discussing");
    case "single_choice":
    case "multiple_choice":
      return t("想听听你的选择", "Your choice would help");
    default:
      return t("接待回复", "Reception response");
  }
}

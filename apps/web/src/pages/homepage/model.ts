import type { Copy, Locale } from "./content";

export const scenes = [
  {
    id: "home",
    asset: "entrance",
    className: "entrance",
    heading: "hero",
    detail: "heroDetail",
    label: "sceneIntro",
    cta: "start",
  },
  {
    id: "clarify",
    asset: "clarify",
    className: "clarify",
    heading: "clarify",
    detail: "clarifyDetail",
    label: "sceneClarify",
  },
  {
    id: "compare",
    asset: "compare",
    className: "compare",
    heading: "compare",
    detail: "compareDetail",
    label: "sceneCompare",
  },
  {
    id: "agree",
    asset: "agree",
    className: "agree",
    heading: "agree",
    detail: "agreeDetail",
    label: "sceneAgree",
  },
  {
    id: "success",
    asset: "success",
    className: "success",
    heading: "success",
    detail: "successDetail",
    label: "sceneSuccess",
    cta: "startSuccess",
  },
] as const satisfies ReadonlyArray<{
  id: string;
  asset: string;
  className: string;
  heading: keyof Copy;
  detail: keyof Copy;
  label: keyof Copy;
  cta?: keyof Copy;
}>;

export type SceneId = (typeof scenes)[number]["id"];
// The tuple is non-empty. Rendering an invalid/stale index safely returns the entrance.
export function sceneAt(index: number) { return scenes[index] ?? scenes[0]; }
export type ContentTab = "business" | "questions" | "providers";
export type SceneAsset = (typeof scenes)[number]["asset"];
export type HomepageAssets = Record<SceneAsset | "wordmark", string>;
export type StartContext = {
  source:
    SceneId | "business-case" | "own-need" | "closing" | "footer" | "header";
  locale: Locale;
  example?: string;
};
export interface HomepageProps {
  poc?: boolean;
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  onStart: (context: StartContext) => void;
  onLogin: () => void;
  loginLabel?: string;
  onProvider: () => void;
  interactionBlocked?: boolean;
  assets?: HomepageAssets;
}

export const businessCases = [
  {
    id: "support",
    title: "supportTitle",
    description: "supportCopy",
    example: "supportExample",
  },
  {
    id: "knowledge",
    title: "knowledgeTitle",
    description: "knowledgeCopy",
    example: "knowledgeExample",
  },
  {
    id: "sales",
    title: "salesTitle",
    description: "salesCopy",
    example: "salesExample",
  },
] as const;

export const questions = [
  { id: "experience", question: "qExperience", answer: "aExperience" },
  { id: "proposals", question: "qProposals", answer: "aProposals" },
  { id: "choice", question: "qChoice", answer: "aChoice" },
  { id: "private", question: "qPrivate", answer: "aPrivate" },
  { id: "delivery", question: "qDelivery", answer: "aDelivery" },
] as const;

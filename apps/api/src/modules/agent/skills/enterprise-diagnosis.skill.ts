import type { ReceptionSkill } from "./skill.types.js";

export const enterpriseDiagnosisSkill: ReceptionSkill = {
  id: "enterprise-diagnosis",
  description: "根据企业实际做法判断业务症状背后的可能难点，指出先验证或解决什么。",
  validate: () => {},
};
